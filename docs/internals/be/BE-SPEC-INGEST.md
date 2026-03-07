# ThreadAtlas Backend Spec

## Analyze and Ingest Endpoint Contract

Version: 0.1
Status: Draft
Companion:
- [BE-PRD.md](./BE-PRD.md)
- [BE-SPEC.md](./BE-SPEC.md)
- [BE-SPEC-CONTEXT.md](./BE-SPEC-CONTEXT.md)
- [BE-SPEC-MEMORY.md](./BE-SPEC-MEMORY.md)

---

## 1. Purpose

본 문서는 WebSocket canonical path 외에 남는 HTTP companion endpoint의 역할과 최소 계약을 정의한다.

v0.1에서 고정하는 HTTP endpoint:

- `/api/analyze`
- `/api/ingest/memory`

핵심 분리:

- `/api/analyze`
  - semantic snapshot을 분석해 summary seed와 memory candidate를 만든다
- `/api/ingest/memory`
  - 승인된 memory record를 영속화한다

---

## 2. Endpoint Roles

## 2.1 `/api/analyze`

역할:

- conversational turn과 분리된 분석 endpoint
- snapshot/context를 받아 정적 분석 결과를 생성
- summary seed, visual summary, memory candidate를 만들기 위한 사전 분석 경로

하지 않는 일:

- user-facing conversational response 생성
- turn lifecycle 관리
- WS session 대체

대표 사용 시점:

- page/tab snapshot이 안정화된 직후
- memory write 전 pre-analysis
- visual-derived summary 생성
- session warm-up 또는 seed generation

## 2.2 `/api/ingest/memory`

역할:

- approved memory record를 long-term memory store에 기록
- memory record metadata, provenance, visual-derived summary를 함께 저장

하지 않는 일:

- raw snapshot 장기 저장
- candidate relation 자체를 무차별 저장
- WS turn 결과 생성

대표 사용 시점:

- `/api/analyze` 결과 중 승인된 record 저장
- turn 종료 후 accepted/promoted record 저장
- batch re-ingest 또는 repair

---

## 3. `/api/analyze` Contract

## 3.1 Request

```ts
import type { ContextPack, SemanticSnapshot } from "@threadatlas/shared"

export interface AnalyzeRequest {
  tabId: number
  snapshot: SemanticSnapshot
  providedPack?: ContextPack
  mode?: "seed" | "memory-candidate" | "visual-summary"
}
```

규칙:

- `snapshot`은 필수다
- `providedPack`은 optional hint다
- canonical truth는 항상 `snapshot`
- `mode`가 없으면 기본값은 `seed`

## 3.2 Response

```ts
import type { MemoryRecordKind, VisualDerivedSummary } from "./be-spec-memory"

export type AnalyzeResponse =
  | {
      mode: "seed"
      analysisId: string
      normalizedMode: "discussion" | "authored" | "interactive" | "generic"
      summaryCandidates: Array<{
        kind: MemoryRecordKind
        summary: string
        rootNodeIds: string[]
        confidence: number
      }>
      visualSummaries?: VisualDerivedSummary[]
    }
  | {
      mode: "memory-candidate"
      analysisId: string
      normalizedMode: "discussion" | "authored" | "interactive" | "generic"
      summaryCandidates: Array<{
        kind: MemoryRecordKind
        summary: string
        rootNodeIds: string[]
        confidence: number
      }>
      visualSummaries?: VisualDerivedSummary[]
    }
  | {
      mode: "visual-summary"
      analysisId: string
      normalizedMode: "discussion" | "authored" | "interactive" | "generic"
      visualSummaries: VisualDerivedSummary[]
      summaryCandidates?: Array<{
        kind: MemoryRecordKind
        summary: string
        rootNodeIds: string[]
        confidence: number
      }>
    }
```

규칙:

- 모든 mode는 `analysisId`, `normalizedMode`를 반드시 반환한다
- `seed`는 `summaryCandidates`를 반드시 반환하고 `visualSummaries`는 optional이다
- `memory-candidate`는 `summaryCandidates`를 반드시 반환하고 저장 후보 수준의 결과만 포함한다
- `visual-summary`는 `visualSummaries`를 반드시 반환하고 `summaryCandidates`는 optional이다
- `summaryCandidates`는 memory write 후보군이지, 자동 저장 결과가 아니다
- `visualSummaries`는 현재 snapshot에서 도출된 visual-derived summary다
- response는 raw snapshot을 다시 에코하지 않는다
- analyze는 public contract 차원에서 session cache 동작을 노출하지 않는다

## 3.3 Behavior Rules

- backend는 내부적으로 `validateSemanticSnapshot -> buildCanonicalContextPack -> normalizeContextPack` 순서를 사용해야 한다
- `mode=visual-summary`라도 raw visual-only 결과만 반환하지 않는다
- summary candidate는 허용된 canonical memory kind만 반환한다

---

## 4. `/api/ingest/memory` Contract

## 4.1 Request

```ts
import type { MemoryRecord } from "./be-spec-memory"

export interface IngestMemoryRequest {
  records: MemoryRecord[]
  source:
    | "analyze"
    | "turn-completion"
    | "batch-repair"
}
```

규칙:

- `records`는 모두 approved/storable record여야 한다
- candidate 상태 relation이나 raw snapshot-derived payload는 허용하지 않는다
- empty `records`는 허용 가능하나 no-op 처리한다
- 각 record의 `ownerUserId`는 현재 authenticated principal과 일치해야 한다

## 4.2 Response

```ts
export interface IngestMemoryResponse {
  acceptedIds: string[]
  rejected: Array<{
    id: string
    reason:
      | "invalid-kind"
      | "missing-provenance"
      | "visual-only"
      | "not-storable"
  }>
}
```

규칙:

- 부분 성공 허용
- reject는 record 단위로 명시한다

## 4.3 Validation Rules

ingest 전 검증:

- 허용된 `MemoryRecordKind`인지
- `ownerUserId`가 현재 principal과 일치하는지
- `summary`가 비어 있지 않은지
- provenance가 충분한지
- visual-only record가 아닌지
- 민감값이 포함되지 않았는지

write 허용 규칙:

- `summary`가 비어 있지 않아야 한다
- `ownerUserId`가 존재하고 현재 principal과 일치해야 한다
- provenance가 완전해야 한다
- visual-only 결과는 저장할 수 없다

---

## 5. Analyze -> Ingest Lifecycle

```text
snapshot
-> /api/analyze
-> summaryCandidates / visualSummaries
-> acceptance / storable 판단
-> /api/ingest/memory
-> long-term memory store
```

규칙:

- `/api/analyze`는 후보를 만든다
- `/api/ingest/memory`는 승인된 결과만 저장한다
- 두 endpoint를 합쳐서 쓰더라도 역할은 분리 유지한다

---

## 6. Interaction with WS Session

### 6.1 Analyze with Session

WS session이 살아 있어도 `/api/analyze`는 사용할 수 있다.

예:

- session warm-up
- stable page pre-analysis
- visual summary candidate generation

### 6.2 Ingest with Session

turn 완료 후 accepted/promoted 사실을 `/api/ingest/memory`로 넘길 수 있다.

규칙:

- ingest는 turn response를 막지 않는 후행 단계로 둘 수 있다
- ingest 실패가 user-facing answer를 무효화하지는 않는다

---

## 7. Error Policy

## 7.1 `/api/analyze`

실패 코드 예시:

- `INVALID_SNAPSHOT`
- `NORMALIZATION_FAILED`
- `ANALYZE_FAILED`

## 7.2 `/api/ingest/memory`

실패 코드 예시:

- `INVALID_RECORD`
- `STORAGE_FAILED`
- `INTERNAL_ERROR`

규칙:

- analyze는 invalid input이면 4xx
- ingest는 record validation 실패 시 부분 성공 응답을 우선 고려

---

## 8. Helper Signatures

```ts
import type { ContextPack, SemanticSnapshot } from "@threadatlas/shared"

export interface AnalyzeArtifacts {
  normalized: NormalizedContextPack
  summaryCandidates: Array<{
    kind: MemoryRecordKind
    summary: string
    rootNodeIds: string[]
    confidence: number
  }>
  visualSummaries: VisualDerivedSummary[]
}

export function analyzeSnapshot(
  input: {
    tabId: number
    snapshot: SemanticSnapshot
    providedPack?: ContextPack
    mode?: "seed" | "memory-candidate" | "visual-summary"
  }
): AnalyzeArtifacts

export function ingestMemoryRecords(
  input: {
    records: MemoryRecord[]
    source: "analyze" | "turn-completion" | "batch-repair"
  }
): Promise<IngestMemoryResponse>
```

---

## 9. File Layout Recommendation

- `apps/api/src/routes/analyze.ts`
- `apps/api/src/routes/ingest-memory.ts`
- `apps/api/src/session/analyze/analyze-snapshot.ts`
- `apps/api/src/session/memory/ingest-records.ts`
