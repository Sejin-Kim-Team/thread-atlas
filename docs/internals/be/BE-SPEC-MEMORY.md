# ThreadAtlas Backend Spec

## Memory Record and Visual-Derived Summary Schema

Version: 0.1
Status: Draft
Companion:
- [BE-PRD.md](./BE-PRD.md)
- [BE-SPEC.md](./BE-SPEC.md)
- [BE-SPEC-CONTEXT.md](./BE-SPEC-CONTEXT.md)
- [BE-SPEC-PLANNER.md](./BE-SPEC-PLANNER.md)
- [BE-SPEC-RAG-HACKATHON.md](./BE-SPEC-RAG-HACKATHON.md)

---

## 1. Purpose

본 문서는 ThreadAtlas backend의 long-term memory schema를 정의한다.

관계형 저장 스키마와 embedding/retrieval 규칙의 canonical 정의는 [BE-SPEC-RAG-HACKATHON.md](./BE-SPEC-RAG-HACKATHON.md)를 따른다.

고정 범위:

- canonical `MemoryRecord` shape
- `branch-summary`, `section-summary`, `claim-evidence-summary` schema
- visual-derived summary schema
- memory read/write 기준
- memory helper function signatures

---

## 2. Canonical Memory Model

v0.1 long-term memory의 canonical 저장 단위는 `summary-bearing semantic unit`이다.

허용 concrete kind:

- `branch-summary`
- `section-summary`
- `claim-evidence-summary`

v0.1 기본 제외:

- `control-cluster-summary`

규칙:

- raw snapshot은 장기 기억에 저장하지 않는다
- 저장 단위는 summary-first record다
- 모든 memory record는 provenance와 source scope를 가진다
- visual-derived content도 직접 이미지가 아니라 summary-bearing record로 저장한다

---

## 3. MemoryRecord Schema

```ts
export type MemoryRecordKind =
  | "branch-summary"
  | "section-summary"
  | "claim-evidence-summary"

export interface MemoryRecord {
  id: string
  ownerUserId: string
  kind: MemoryRecordKind
  summary: string
  keywords: string[]
  entities: string[]
  provenance: {
    sourceUrl: string
    pageKind: "article" | "thread" | "post" | "generic"
    tabId?: number
    snapshotCapturedAt: string
    extractorId: string
    skeletonVersion: number
  }
  source: {
    pageId: string
    rootNodeIds: string[]
    unitId?: string
  }
  navigation: {
    canonicalUrl: string
    pageTitle?: string
    pageAnchor?: string
    nodeAnchor?: {
      nodeId?: string
      commentId?: string
      headingText?: string
      textQuote?: string
    }
    openMode?: "same-tab" | "new-tab" | "sidepanel-preview"
  }
  evidence: {
    textSpans: string[]
    referencedNodeIds: string[]
    referencedTabIds?: number[]
  }
  visual?: VisualDerivedSummary
  createdAt: string
  lastAccessedAt?: string
}
```

설명:

- `ownerUserId`는 해당 memory record의 소유 auth principal이다
- `summary`는 retrieval과 recall의 기본 검색 대상이다
- `keywords`, `entities`는 lightweight retrieval/filter 보조 필드다
- `provenance`는 memory-link acceptance policy의 핵심 입력이다
- `source.rootNodeIds`는 원본 semantic scope 추적용이다
- `navigation`은 사용자가 과거 사례를 다시 브라우징할 수 있게 하는 메타 정보다
- `evidence`는 summary가 어떤 근거에서 만들어졌는지 남긴다

`navigation`의 의도:

- recall 결과를 말로만 제시하지 않고 다시 열 수 있게 한다
- page 단위 링크와 semantic 위치 힌트를 함께 보관한다
- comment, section, claim scope에 따라 다른 anchor를 줄 수 있다
- `openMode`는 강제값이 아니라 backend 추천 힌트다
- 실제 same-tab / new-tab / sidepanel preview 실행은 FE가 결정한다

ownership 규칙:

- memory record는 항상 단일 `ownerUserId`에 귀속된다
- recall lookup은 현재 authenticated principal의 record 범위 안에서만 수행한다
- 다른 principal의 record를 cross-user recall 대상으로 사용하지 않는다

---

## 4. Concrete Record Shapes

## 4.1 BranchSummaryRecord

```ts
export interface BranchSummaryRecord extends MemoryRecord {
  kind: "branch-summary"
  branch: {
    rootCommentId?: string
    focusCommentId?: string
    depthHint?: number
    participantAuthors?: string[]
  }
}
```

의미:

- discussion page의 댓글 가지 전체를 대표하는 기억 단위

생성 기준:

- discussion mode에서 `branch` candidate가 충분한 구조와 텍스트를 가질 때

권장 navigation 메타:

- `canonicalUrl`: thread URL
- `nodeAnchor.commentId` 또는 `nodeAnchor.nodeId`
- 가능하면 comment permalink 또는 fragment

## 4.2 SectionSummaryRecord

```ts
export interface SectionSummaryRecord extends MemoryRecord {
  kind: "section-summary"
  section: {
    headingText?: string
    levelHint?: number
    containerNodeId?: string
  }
}
```

의미:

- article/docs/authored page의 section 전체를 대표하는 기억 단위

생성 기준:

- authored 또는 generic mode에서 `section` candidate가 충분히 안정적일 때

권장 navigation 메타:

- `canonicalUrl`: article/docs URL
- `nodeAnchor.headingText`
- 가능하면 section fragment 또는 text quote

## 4.3 ClaimEvidenceSummaryRecord

```ts
export interface ClaimEvidenceSummaryRecord extends MemoryRecord {
  kind: "claim-evidence-summary"
  claimEvidence: {
    claim: string
    evidencePoints: string[]
    stance?: "supports" | "contradicts" | "neutral"
  }
}
```

의미:

- cross-page comparison과 recall에 최적화된 주장-근거 요약 단위

생성 기준:

- relation analysis 또는 evidence promotion 이후, claim/evidence 구조가 충분히 명확할 때

권장 navigation 메타:

- `canonicalUrl`: source page URL
- `nodeAnchor.nodeId` 또는 `textQuote`
- claim 자체와 연결되는 evidence span 힌트

---

## 5. Visual-Derived Summary Schema

`VisualDerivedSummary`는 visual 이해 결과를 raw image가 아니라 summary-bearing memory로 수용하기 위한 부가 필드다.

```ts
export type VisualSummaryKind =
  | "chart-summary"
  | "diagram-summary"
  | "ui-visual-summary"

export interface VisualDerivedSummary {
  kind: VisualSummaryKind
  summaryText: string
  extractedLabels: string[]
  extractedText?: string[]
  chart?: {
    chartType?: "line" | "bar" | "pie" | "scatter" | "table-like" | "unknown"
    trend?: "up" | "down" | "flat" | "mixed" | "unknown"
    comparedSeries?: string[]
  }
  diagram?: {
    entities?: string[]
    relations?: string[]
  }
  uiVisual?: {
    visibleControls?: string[]
    visibleSections?: string[]
  }
}
```

규칙:

- `VisualDerivedSummary`는 `MemoryRecord.visual` 하위 필드로만 들어간다
- visual summary만 단독 저장하지 않는다
- visual summary는 text summary를 보강하는 부가 정보다
- 민감한 값은 포함하지 않는다

---

## 5.1 Recall Browsing Metadata

해커톤 버전에서도 recall 결과에는 가능한 한 브라우징 가능한 메타를 포함하는 것을 권장한다.

최소 권장 항목:

- `navigation.canonicalUrl`
- `navigation.pageTitle`
- `navigation.nodeAnchor`

권장 이유:

- “유사 사례가 있다”는 문장만으로는 데모 인상이 약하다
- 사용자가 실제로 원문/댓글 위치를 다시 열 수 있어야 recall 가치가 커진다
- FE는 이 메타를 사용해 새 탭 열기, 현재 탭 이동, sidepanel preview 등을 구현할 수 있다
- 단, 어떤 UX를 실제로 택할지는 FE가 최종 결정한다

---

## 6. Visual Support Policy

허용 대상:

- chart
- diagram
- visible UI screenshot / visual region

허용 범위:

- 현재 또는 과거에 이미 본 자료만
- Live API 또는 이미지 이해 결과를 summary로 변환한 경우만

비허용:

- raw image bytes 장기 저장
- visual-only 결과를 direct final evidence로 사용
- 새 외부 자료 탐색

---

## 7. Write Policy

## 7.1 Storable Conditions

다음 조건을 만족할 때만 `MemoryRecord`를 쓴다.

- `summary`가 비어 있지 않다
- `ownerUserId`가 존재한다
- provenance가 완전하다
- 허용된 record kind다
- visual-only record가 아니다

## 7.2 Non-Storable Conditions

다음은 저장하지 않는다.

- raw noisy snapshot
- malformed summary
- `ownerUserId` 누락
- provenance가 약한 candidate relation
- 민감한 interactive value
- visual-only 분석 결과

## 7.3 Write Priority

기본 우선순위:

1. `claim-evidence-summary`
2. `branch-summary` 또는 `section-summary`

설명:

- `claim-evidence-summary`는 cross-page recall 가치가 가장 높다
- `branch-summary`, `section-summary`는 원문 구조 맥락 보존에 강하다

---

## 8. Read / Recall Policy

## 8.1 Retrieval Targets

Long-term RAG는 다음을 기준으로 검색한다.

- `summary`
- `keywords`
- `entities`
- `visual.summaryText`
- `visual.extractedLabels`

## 8.2 Recall Output Rule

memory retrieval 결과는 raw record 전체를 바로 노출하지 않는다.

규칙:

- recall은 current-page answer가 먼저 생성된 뒤에만 붙을 수 있다
- recall hit는 primary answer로 승격하지 않는다
- recall 결과는 `recall-card` projection으로만 노출한다

최소 반환:

- record id
- kind
- summary
- provenance summary
- optional visual summary

## 8.3 Visual Recall Rule

다음 질문에 대응 가능해야 한다.

- "지금/방금 본 내용 설명해주는 차트가 있었나?"
- "이전에 본 자료 중 이 주장과 연결되는 다이어그램이 있었나?"

이 경우 planner는:

- visual-derived summary가 있는 memory record를 검색
- current intent와 primary tab 맥락을 기준으로 memory-link를 생성
- acceptance policy를 통과한 경우만 보조 근거로 사용

---

## 9. Helper Function Signatures

```ts
export interface BuildMemoryRecordInput {
  normalized: NormalizedContextPack
  unit: NormalizedSemanticUnitCandidate
  summary: string
  keywords: string[]
  entities: string[]
  visual?: VisualDerivedSummary
}

export function buildMemoryRecord(
  input: BuildMemoryRecordInput
): MemoryRecord | null

export function deriveMemoryRecordKind(
  normalized: NormalizedContextPack,
  unit: NormalizedSemanticUnitCandidate
): MemoryRecordKind | null

export function buildVisualDerivedSummary(
  input: {
    visualKind: VisualSummaryKind
    summaryText: string
    extractedLabels: string[]
    extractedText?: string[]
    chart?: VisualDerivedSummary["chart"]
    diagram?: VisualDerivedSummary["diagram"]
    uiVisual?: VisualDerivedSummary["uiVisual"]
  }
): VisualDerivedSummary

export function isMemoryRecordStorable(
  record: MemoryRecord
): boolean
```

규칙:

- `buildMemoryRecord`는 허용되지 않은 kind면 `null`
- visual summary는 optional이며, visual-only로는 record를 만들지 않는다
- helper는 pure function 원칙을 따른다

---

## 10. File Layout Recommendation

권장 구현 파일:

- `apps/api/src/session/memory/types.ts`
- `apps/api/src/session/memory/build-record.ts`
- `apps/api/src/session/memory/visual-summary.ts`
- `apps/api/src/session/memory/storable.ts`
- `apps/api/src/session/memory/retrieve.ts`
