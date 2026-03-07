# ThreadAtlas Backend Spec

## Context, Normalization, and Relation Model

Version: 0.1
Status: Draft
Companion:
- [BE-PRD.md](./BE-PRD.md)
- [BE-SPEC.md](./BE-SPEC.md)
- [FE-SPEC.md](../FE-SPEC.md)

---

## 1. Purpose

본 문서는 backend가 FE semantic input을 어떻게 수용하고 planner 입력으로 normalize하는지 정의한다.

핵심 결정:

- `SemanticSnapshot`이 canonical truth다
- FE가 보낸 `ContextPack`은 optional hint다
- planner는 raw snapshot이나 FE pack이 아니라 `NormalizedContextPack`을 본다

해커톤 범위 적용 원칙:

- 본 문서는 full context model과 upgrade-ready 타입까지 함께 담는다
- 하지만 [BE-PRD-HACKATHON.md](./BE-PRD-HACKATHON.md) 기준 구현에서는 current-page subset만 사용한다
- cross-tab / shared working set / relation edge의 실제 운용은 해커톤 비적용이다

---

## 2. Canonical Input Policy

### 2.1 SemanticSnapshot Is Source of Truth

backend는 shared contract의 `SemanticSnapshot`을 canonical input truth로 사용한다.

SoT 의미:
- 현재 페이지 identity의 기준
- 현재 focus semantic node의 기준
- 주변 semantic context의 기준
- provenance와 capture metadata의 기준

### 2.2 ContextPack Is Derived Input

backend는 shared contract의 `ContextPack`을 optional derived input으로 수용할 수 있다.

규칙:
- FE `ContextPack`은 planner authority가 아니다
- canonical pack은 backend가 snapshot으로부터 재생성할 수 있어야 한다
- FE `ContextPack`은 최적화 힌트나 디버그 비교 용도로만 사용 가능하다

### 2.3 Planner Input Rule

planner는 다음 계층을 본다.

```text
SemanticSnapshot
-> Validation
-> Canonical ContextPack Build
-> NormalizedContextPack
-> Planner
```

---

## 3. Context Ingestion Pipeline

### 3.1 Step 1. Snapshot Validation

validation 단계는 malformed input이 planner를 오염시키지 않도록 차단한다.

최소 검증 항목:
- `page`, `focus`, `context`, `meta` 필수 필드 존재
- `focus.nodeId === focus.node.id`
- `context.distance >= 1`
- relation 값이 shared contract 허용 목록인지 확인
- `coverage` 값이 있으면 범위 정합성 확인

### 3.2 Step 2. Canonical ContextPack Build

backend는 shared `buildContextPack(snapshot)` 계열 builder를 사용해 canonical pack을 재구성한다.

규칙:
- planner는 FE가 보낸 pack을 그대로 쓰지 않는다
- canonical pack 생성 실패 시 planner는 진행하지 않는다

### 3.3 Step 3. Context Normalization

backend는 canonical pack을 planner-friendly shape로 한 번 더 정규화한다.

normalize 결과는 다음을 제공해야 한다.

- mode
- retrieval hints
- risk/confidence hints
- semantic unit candidates

---

## 4. Normalized Context Model

### 4.1 Normalized Modes

```ts
export type NormalizedMode =
  | "discussion"
  | "authored"
  | "interactive"
  | "generic"
```

### 4.2 Scope Kinds

```ts
export type NormalizedScopeKind = "focus-branch" | "focus-section"
```

### 4.3 Retrieval Hints

```ts
export type RetrievalIntentHint =
  | "local-analysis"
  | "cross-tab-compare"
  | "memory-recall"
  | "navigation"
  | "interactive-explain"
```

해커톤 적용 규칙:

- `cross-tab-compare`는 예약 값으로 남기되, 해커톤 구현에서는 생성하지 않는다

### 4.4 Risk Flags

```ts
export type RiskFlag =
  | "low-coverage"
  | "stale-likely"
  | "interactive-restricted"
  | "weak-structure"
  | "cross-tab-required"
```

해커톤 적용 규칙:

- `cross-tab-required`는 예약 값으로 남기되, 해커톤 구현에서는 사용하지 않는다

### 4.5 Semantic Unit Candidates

```ts
export interface NormalizedSemanticUnitCandidate {
  id: string
  kind:
    | "focus-unit"
    | "branch"
    | "section"
    | "sibling-cluster"
    | "evidence-set"
    | "control-cluster"
  nodeIds: string[]
  summaryText: string
  confidence: number
  sourceGroup: "focus" | "ancestors" | "descendants" | "siblings" | "containers"
}
```

### 4.6 NormalizedContextPack

```ts
import type { PageKind, SemanticNodeKind, SemanticSnapshot } from "@threadatlas/shared"

export interface NormalizedContextPack {
  version: 1
  source: {
    pageId: string
    url: string
    pageKind: PageKind
    snapshotCapturedAt: string
    extractorId: string
    skeletonVersion: number
  }
  focus: {
    nodeId: string
    nodeKind: SemanticNodeKind
    text: string
    label?: string
    contentType?: string
    controlType?: string
    action?: string
    depth?: number
    parentId?: string
  }
  scope: {
    kind: NormalizedScopeKind
    rootNodeId: string
    omittedNodeCount: number
    omittedRootCount: number
  }
  mode: NormalizedMode
  retrieval: {
    intentHints: RetrievalIntentHint[]
    primaryKeywords: string[]
    structuralHints: string[]
    localOnlyPreferred: boolean
    crossTabAllowed: boolean
    memoryAllowed: boolean
  }
  flags: {
    values: RiskFlag[]
    lowCoverage: boolean
    staleLikely: boolean
    interactiveRestricted: boolean
    weakStructure: boolean
  }
  units: NormalizedSemanticUnitCandidate[]
}
```

규칙:
- `units`는 최대 5개만 생성한다
- planner는 `NormalizedContextPack`만 사용한다
- raw `ContextPack.groups`에 planner가 직접 결합되면 안 된다

---

## 5. Derivation Rules

### 5.1 Mode Inference

v0.1은 focus-first 규칙을 사용한다.

1. `focus.node.kind === "comment"` -> `discussion`
2. `focus.node.kind === "interactive"` -> `interactive`
3. `snapshot.page.kind === "article"` -> `authored`
4. 그 외 -> `generic`

보정 규칙:
- `page.kind === "thread"` 이고 discussion context가 명확하면 `discussion` 유지
- interactive descendants가 많아도 focus가 interactive가 아니면 mode를 자동 전환하지 않는다

### 5.2 Retrieval Policy Derivation

기본 policy:

- `discussion`
  - `localOnlyPreferred = true`
  - `crossTabAllowed = true`
  - `memoryAllowed = true`
- `authored`
  - `localOnlyPreferred = true`
  - `crossTabAllowed = true`
  - `memoryAllowed = true`
- `interactive`
  - `localOnlyPreferred = true`
  - `crossTabAllowed = false`
  - `memoryAllowed = false`
- `generic`
  - `localOnlyPreferred = true`
  - `crossTabAllowed = false`
  - `memoryAllowed = true`

최종 retrieval policy는 normalize 기본값 위에 planner가 intent를 반영해 override한다.

해커톤 적용 규칙:

- 해커톤 current-page 구현에서는 모든 mode에 대해 `crossTabAllowed = false`로 강제한다
- 즉 full model의 field는 유지하되, runtime policy는 current-page only로 축소한다

### 5.3 Primary Keyword Derivation

v0.1 keyword extraction은 단순 규칙으로 유지한다.

- focus text에서 토큰 추출
- stopword 제거
- 길이 2 이상
- 최대 8개
- interactive focus는 `label`, `action`, `role`을 우선 반영

### 5.4 Structural Hint Derivation

허용 structural hint 예시:

- `has-parent`
- `has-children`
- `has-siblings`
- `deep-thread`
- `interactive-control`
- `section-like`
- `limited-coverage`

### 5.5 Risk Flag Derivation

`lowCoverage`:
- `omittedNodeCount >= 20`
- 또는 `omittedNodeCount > capturedNodeCount`

`staleLikely`:
- v0.1에서는 공격적으로 켜지지 않도록 보수적으로 계산
- stale signal이 약하면 기본값 `false`

`interactiveRestricted`:
- `mode === "interactive"`

`weakStructure`:
- unit candidate가 지나치게 적음
- focus text가 너무 짧음
- 주변 context가 거의 없음

### 5.6 Semantic Unit Candidate Derivation

항상 생성:
- `focus-unit`

discussion 모드:
- `branch`
- `sibling-cluster`
- `evidence-set`

authored 모드:
- `section`
- `sibling-cluster`

interactive 모드:
- `control-cluster`

generic 모드:
- `section` 또는 `branch` 중 하나

규칙:
- candidate는 최대 5개
- `focus-unit` confidence는 `1.0`
- 나머지 candidate는 deterministic heuristic으로 confidence를 계산한다

---

## 6. Relation Model

본 절은 full-scope / upgrade-ready relation model을 정의한다.

해커톤 current-page 구현에서는:

- `CrossTabEdge`를 생성하지 않는다
- `MemoryLink` 복잡한 승격 플로우를 사용하지 않는다
- relation model은 장기 upgrade 대비 정의로만 유지한다

### 6.1 Base Relation Edge

```ts
export interface BaseRelationEdge {
  id: string
  fromTabId: number
  fromSnapshotId: string
  score: number
  evidence: string
  createdAt: number
}
```

### 6.2 CrossTabEdge

```ts
export interface CrossTabEdge extends BaseRelationEdge {
  kind: "cross-tab"
  toTabId: number
  toSnapshotId?: string
  relation:
    | "opened-from"
    | "source-of"
    | "references"
    | "same-topic"
    | "compares-with"
}
```

의미:
- 현재 session 안의 탭 관계
- retrieval expansion의 1급 근거

### 6.3 MemoryLink

```ts
export interface MemoryLink extends BaseRelationEdge {
  kind: "memory-link"
  memoryRecordId: string
  relation:
    | "looks-similar"
    | "same-claim"
    | "same-pattern"
    | "same-source-family"
  status: "candidate" | "accepted" | "rejected"
}
```

의미:
- 과거 memory와 현재 context의 유사성 관계
- 기본적으로 가설이며 바로 evidence로 사용하지 않는다

### 6.4 RelationEdge Union

```ts
export type RelationEdge = CrossTabEdge | MemoryLink
```

---

## 7. Session Context Structures

본 절의 구조는 full session model 기준이다.

해커톤 current-page 구현에서는:

- `TabContext`를 primary tab 1개에 대한 단순 latest snapshot holder로 축소해도 된다
- `SharedWorkingSet`은 구현하지 않아도 된다
- current-page runtime의 canonical state는 [BE-SPEC-HACKATHON.md](./BE-SPEC-HACKATHON.md)의 `activeTurn` 중심 모델을 따른다

### 7.1 TabContext

```ts
import type { ContextPack, SemanticSnapshot } from "@threadatlas/shared"

export interface TabContext {
  tabId: number
  url: string
  pageKind: "thread" | "article" | "post" | "generic"
  latestSnapshot: SemanticSnapshot | null
  latestCanonicalPack: ContextPack | null
  latestNormalizedPack: NormalizedContextPack | null
  lastActiveAt: number
}
```

### 7.2 SharedWorkingSet

```ts
export interface SharedWorkingSet {
  promotedFactIds: string[]
  relationEdges: RelationEdge[]
  sharedHypothesisIds: string[]
}
```

규칙:
- raw snapshot은 shared working set에 올리지 않는다
- 승격된 fact와 accepted relation만 저장한다

---

## 8. Builder and Normalizer Function Signatures

본 절은 v0.1 구현이 따라야 하는 canonical 함수 시그니처를 고정한다.

### 8.1 Validation Result

```ts
export interface SnapshotValidationResult {
  ok: boolean
  errors: string[]
  warnings: string[]
}
```

### 8.2 Normalize Context Input

```ts
import type { ContextPack, SemanticSnapshot } from "@threadatlas/shared"

export interface NormalizeContextPackInput {
  tabId: number
  snapshot: SemanticSnapshot
  providedPack?: ContextPack
  userIntentText?: string
}
```

### 8.3 Canonical Signatures

```ts
import type { ContextPack, SemanticSnapshot } from "@threadatlas/shared"

export function validateSemanticSnapshot(
  snapshot: SemanticSnapshot
): SnapshotValidationResult

export function buildCanonicalContextPack(
  snapshot: SemanticSnapshot
): ContextPack

export function normalizeContextPack(
  input: NormalizeContextPackInput
): NormalizedContextPack
```

### 8.4 Required Helper Signatures

```ts
import type { ContextPack, SemanticSnapshot } from "@threadatlas/shared"

export function inferNormalizedMode(
  snapshot: SemanticSnapshot,
  pack: ContextPack
): NormalizedMode

export function deriveRiskFlags(
  snapshot: SemanticSnapshot,
  pack: ContextPack
): NormalizedContextPack["flags"]

export function deriveRetrievalHints(
  args: {
    snapshot: SemanticSnapshot
    pack: ContextPack
    mode: NormalizedMode
    userIntentText?: string
  }
): NormalizedContextPack["retrieval"]

export function buildSemanticUnitCandidates(
  snapshot: SemanticSnapshot,
  pack: ContextPack,
  mode: NormalizedMode
): NormalizedSemanticUnitCandidate[]
```

### 8.5 Implementation Rules

- `normalizeContextPack`은 내부에서 canonical pack을 사용해야 한다
- `providedPack`이 있더라도 planner는 그 객체를 authority로 취급하지 않는다
- `buildCanonicalContextPack`은 shared builder와 동등한 semantics를 가져야 한다
- helper 함수는 pure function으로 유지하는 것을 기본 원칙으로 한다

---

## 9. File Layout Recommendation

v0.1 backend 구현 시 권장 파일 분리는 다음과 같다.

- `apps/api/src/session/context-pack/validate.ts`
- `apps/api/src/session/context-pack/build.ts`
- `apps/api/src/session/context-pack/normalize.ts`
- `apps/api/src/session/context-pack/units.ts`
- `apps/api/src/session/context-pack/flags.ts`
