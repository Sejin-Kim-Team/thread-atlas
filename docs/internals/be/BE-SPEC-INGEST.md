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

### 1.1 `feature/be-rag-persistence` 브랜치 범위 고정

이번 브랜치에서 HTTP companion endpoint 기준으로 실제 구현하는 범위:

- `/api/analyze` 호출 결과의 `analysis_runs` 최소 DB 기록
- `/api/ingest/memory`의 실제 DB write (`memory_records`, `memory_record_embeddings`)
- owner isolation 기반 read/write 규칙 강제

이번 브랜치 비범위:

- analyze real LLM generation 품질 완성
- WS turn runtime 연동
- enrich sub-loop 연동
- recall-card projection 연동

---

## 2. Endpoint Roles

공통 인증 모델:

- canonical identity chain은 `dev-bootstrap subject 또는 google identity -> /api/token -> opaque app session token -> auth_sessions 조회 -> local users.id principal`이다
- `/api/analyze`, `/api/ingest/memory`는 검증된 bearer token을 `auth_sessions.session_token_hash`로 조회해 principal을 해석한다
- token 검증 실패, revoked/expired session, 또는 principal 해석 실패 시 `401 UNAUTHORIZED`로 거부한다

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
- 요청 principal은 bearer token을 `auth_sessions`로 조회해 해석한 local `users.id`로 고정한다

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
- `visual-summary`의 각 summary는 최소 `kind`, `summaryText`, `extractedLabels`를 포함해야 하며 `extractedText`는 optional이다
- backend는 focus/page 문맥을 기준으로 `chart-summary | diagram-summary | ui-visual-summary` 중 하나를 결정해 canonical visual summary를 반환해야 한다
- visual kind keyword inference는 standalone term 기준으로 동작해야 하며 `toolbar`/`sidebar` 같은 substring 오탐으로 `chart-summary`를 만들면 안 된다
- response는 raw snapshot을 다시 에코하지 않는다
- analyze는 public contract 차원에서 session cache 동작을 노출하지 않는다

## 3.3 Behavior Rules

- backend는 내부적으로 `validateSemanticSnapshot -> buildCanonicalContextPack -> normalizeContextPack` 순서를 사용해야 한다
- `mode=visual-summary`라도 raw visual-only 결과만 반환하지 않는다
- summary candidate는 허용된 canonical memory kind만 반환한다
- 이번 브랜치에서 `/api/analyze`는 `analysis_runs`에 최소 감사 로그를 남겨야 한다
  - 필수 컬럼: `id`, `owner_user_id`, `tab_id`, `mode`, `snapshot_page_id`, `snapshot_url`, `normalized_mode`
  - `summary_candidates`, `visual_summaries`는 빈 배열 저장을 허용한다

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
- 현재 authenticated principal은 검증된 bearer token을 `auth_sessions`에서 조회해 해석한 local `users.id`다

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

## 4.4 Persistence Rules (구현 강제)

- `/api/ingest/memory`는 record 단위 트랜잭션을 사용한다
- 트랜잭션 순서:
  1. `memory_records` insert
  2. canonical `retrieval_text` 생성
  3. embedding 생성
  4. `memory_record_embeddings` insert
- embedding 생성 또는 embedding insert가 실패하면 해당 record write를 rollback하고 `rejected`에 포함한다
- 한 record 실패가 전체 batch 실패를 강제하지는 않는다

## 4.5 Owner Isolation Rules (구현 강제)

- principal은 bearer token -> `auth_sessions` -> `users.id` 체인으로 해석한다
- 요청 body의 `ownerUserId`를 신뢰하지 않는다. principal과 불일치하면 reject한다
- persistence read/query 계층은 owner 조건 없는 조회 API를 제공하지 않는다
- owner 조건 없는 SQL 실행은 금지한다

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

- `UNAUTHORIZED`
- `INVALID_SNAPSHOT`
- `NORMALIZATION_FAILED`
- `ANALYZE_FAILED`

## 7.2 `/api/ingest/memory`

실패 코드 예시:

- `UNAUTHORIZED`
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

---

## 10. `feature/be-rag-persistence` 완료 조건

다음을 모두 만족하면 이번 브랜치 관점에서 ingest/analyze persistence는 완료다.

- `/api/analyze` 호출이 `analysis_runs`에 owner-scoped row를 기록한다.
- `/api/ingest/memory`가 `memory_records`와 `memory_record_embeddings`를 실제로 기록한다.
- owner mismatch record는 저장되지 않고 `rejected`로 반환된다.
- owner 조건 없는 read/write 경로가 존재하지 않는다.
- WS turn runtime, enrich, recall-card 연결은 미구현이어도 완료 판정을 유지한다.
