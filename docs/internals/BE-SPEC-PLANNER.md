# ThreadAtlas Backend Spec

## Planner, Retrieval, and Response Policy

Version: 0.1
Status: Draft
Companion:
- [BE-PRD.md](/Users/spark/workspace/thread-atlas/docs/internals/BE-PRD.md)
- [BE-SPEC.md](/Users/spark/workspace/thread-atlas/docs/internals/BE-SPEC.md)
- [BE-SPEC-CONTEXT.md](/Users/spark/workspace/thread-atlas/docs/internals/BE-SPEC-CONTEXT.md)

---

## 1. Purpose

본 문서는 backend planner 계층의 deterministic policy와 LLM reasoner의 책임 경계를 정의한다.

핵심 원칙:

- retrieval이 generation보다 먼저다
- planner는 deterministic하다
- relation analysis와 explanation은 LLM이 담당한다
- weak evidence는 answer가 아니라 suggest/clarify로 후퇴한다

---

## 2. Planner Composition

```text
Intent Router
-> Retrieval Planner
-> Candidate Retrieval
-> Relation Analyzer
-> Evidence Promotion
-> Response / Projection Planner
```

### 2.1 Deterministic Responsibilities

- intent family classification
- retrieval scope 결정
- relation candidate gating
- evidence promotion policy
- response mode 결정
- projection 조합 결정

### 2.2 LLM Responsibilities

- retrieved candidate 간 semantic relation 해석
- grounded comparison/explanation 생성
- provenance-aware phrasing

---

## 3. Intent Router

### 3.1 Intent Families

v0.1 router는 다음 family를 지원한다.

- `analysis-request`
- `evidence-request`
- `navigation-request`
- `comparison-request`
- `memory-recall-request`
- `clarification-response`

### 3.2 Routing Inputs

router는 다음 입력을 사용한다.

- `user.intent` 텍스트
- active `NormalizedContextPack`
- previous turn state
- pending clarification state

### 3.3 Routing Outputs

router는 다음 최소 출력을 생성한다.

```ts
export interface RoutedIntent {
  family:
    | "analysis-request"
    | "evidence-request"
    | "navigation-request"
    | "comparison-request"
    | "memory-recall-request"
    | "clarification-response"
  requiresCrossTab: boolean
  allowsMemoryRecall: boolean
  prefersClarification: boolean
}
```

---

## 4. Retrieval Planner

### 4.1 Retrieval Order

planner의 기본 retrieval 순서는 다음과 같다.

1. primary tab
2. current session의 cross-tab references
3. shared working set
4. long-term memory

### 4.2 Retrieval Policy Table

| Intent family | Primary scope | Expansion | Weak evidence fallback |
| --- | --- | --- | --- |
| analysis / evidence | primary tab first | same-session cross-tab optional | suggest / clarify |
| comparison | primary tab + referenced tabs | cross-tab required | clarify |
| recall | primary tab + long-term memory | memory search enabled | suggest / clarify |
| navigation | primary tab first | referenced tab if target not local | suggest |
| clarification response | previous turn context | no broad expansion by default | narrower follow-up |

### 4.3 Retrieval Rules

- primary tab retrieval은 항상 1순위다
- cross-tab expansion은 explicit relation 또는 comparison intent가 있을 때만 허용한다
- long-term memory는 recall intent 또는 planner 판단이 있을 때만 검색한다
- `interactiveRestricted`가 true면 cross-tab과 memory retrieval을 기본적으로 비활성화한다

### 4.4 Candidate Retrieval Output

retrieval 단계는 semantic unit 후보와 provenance를 반환해야 한다.

예:
- active tab focus branch
- referenced article section
- accepted promoted fact
- memory similarity hit

---

## 5. Relation Analyzer

### 5.1 Target Relations

v0.1 relation analyzer는 최소한 다음 relation을 다룬다.

- `supports`
- `contradicts`
- `elaborates`
- `references`
- `similar`
- `same_topic`

### 5.2 Candidate Generation

relation candidate는 다음 신호를 조합해 생성한다.

- retrieval score
- metadata overlap
- session relation signals
- normalized unit kind compatibility

### 5.3 Relation Judgment

최종 relation 판단은 `deterministic heuristics + LLM classification` 혼합으로 수행한다.

규칙:
- deterministic gating 없이 LLM에 모든 후보를 넘기지 않는다
- provenance가 약한 candidate는 relation judgment 이전에 제외할 수 있다

---

## 6. Cross-Tab and Memory Policy

### 6.1 Cross-Tab Relation

`CrossTabEdge`는 현재 session 안의 구조적 관계다.

의미:
- retrieval expansion의 1급 근거
- direct evidence candidate 생성 가능

예:
- `source-of`
- `opened-from`
- `references`
- `compares-with`

### 6.2 MemoryLink

`MemoryLink`는 과거 memory와 현재 context의 유사성 관계다.

기본 정책:
- memory hit는 기본적으로 `candidate`
- candidate는 바로 answer evidence가 아니다
- 고신뢰 또는 사용자 확인이 있을 때만 `accepted`로 승격한다

### 6.3 Evidence Strength Policy

- strong `cross-tab` relation + fresh snapshot -> direct evidence 가능
- weak `memory-link` -> suggest 또는 clarify 우선
- ambiguous relation -> clarify 우선

---

## 7. Evidence Promotion

### 7.1 Promotion Stages

memory 및 약한 relation candidate는 다음 단계를 따른다.

1. `candidate`
2. `accepted`
3. `rejected`

### 7.2 Promotion Inputs

- relation score
- provenance strength
- user intent family
- current snapshot freshness
- response risk flags

### 7.3 Promotion Rules

- `cross-tab` relation은 accepted candidate로 바로 시작할 수 있다
- `memory-link`는 기본적으로 `candidate`에서 시작한다
- accepted 되지 않은 memory-link는 answer evidence로 사용하지 않는다

---

## 8. Response and Projection Planner

### 8.1 Response Modes

planner는 다음 중 하나 이상을 조합할 수 있다.

- `answer`
- `suggest`
- `clarify`
- `focus`
- `navigate`
- `present`
- `notify`

### 8.2 Response Policy

- evidence가 충분하면 `answer`
- evidence가 약하지만 방향성은 있으면 `suggest`
- ambiguity가 크면 `clarify`
- 이동이 답변 가치에 직접 기여하면 `focus` 또는 `navigate`

### 8.3 Projection Policy

projection은 reasoning의 부산물이어야 한다.

예:
- same page focus
- branch jump
- cross page open
- sidepanel evidence preview

### 8.4 Turn Completion

`turn.done`은 최소한 다음 정보를 포함해야 한다.

- referenced tab ids
- used provenance summary
- promoted fact ids 또는 memory updates
- response mode summary

---

## 9. Session and Memory Retrieval

### 9.1 Session RAG

입력 원천:
- primary tab normalized pack
- referenced tab normalized packs
- shared working set
- session summaries

역할:
- 현재 질문에 대한 초저지연 retrieval
- cross-tab retrieval의 주 경로

### 9.2 Long-term RAG

입력 원천:
- branch summary
- section summary
- claim/evidence summary
- article section summary
- control cluster summary

역할:
- recall
- cross-session similarity retrieval

### 9.3 Long-term Memory Write Policy

저장 가능:
- 충분한 confidence가 있는 summary
- relevance가 확인된 promoted fact
- 비교/회상 가치가 높은 semantic unit summary

저장 불가:
- raw noisy snapshot
- 검증되지 않은 relation candidate
- 민감한 interactive value

---

## 10. Failure and Fallback Policy

### 10.1 Low Coverage

`lowCoverage`가 true면 planner는 answer 강도를 낮춘다.

권장 동작:
- suggest
- clarify
- recapture 유도

### 10.2 Weak Structure

`weakStructure`가 true면 broad comparison이나 aggressive memory recall을 피한다.

### 10.3 Interactive Restriction

`interactiveRestricted`가 true면:
- cross-tab retrieval 비활성화가 기본값
- memory recall 비활성화가 기본값
- control explanation 중심으로 제한

---

## 11. Open Items for Next Spec Revision

- long-term memory canonical record schema
- memory-link acceptance threshold
- visual / hybrid retrieval generalization 시점
