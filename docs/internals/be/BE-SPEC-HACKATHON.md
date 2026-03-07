# ThreadAtlas Backend Spec

## Hackathon Delivery Spec

Version: 0.1-hackathon
Status: Draft
Companion:
- [BE-PRD-HACKATHON.md](./BE-PRD-HACKATHON.md)
- [BE-SPEC-INFRA.md](./BE-SPEC-INFRA.md)
- [BE-SPEC-UPGRADE.md](./BE-SPEC-UPGRADE.md)

---

## 1. Purpose

본 문서는 2026-03-16 해커톤 제출까지 구현할 backend의 최소 spec을 정의한다.

이 문서가 고정하는 범위:

- current-page 중심 session model
- 최소 WebSocket event flow
- current-page retrieval policy
- visual explanation 범위
- 제한적 과거 회상 범위

---

## 2. Canonical Scope

해커톤 spec의 canonical scope는 다음이다.

- `WebSocket session` 유지
- `SemanticSnapshot` input 유지
- `single-primary-tab` 중심 동작
- current-page retrieval 중심
- selected-scenario visual explanation 지원
- 제한적 long-term memory recall

제외:

- cross-tab retrieval orchestration
- multi-tab workspace state
- complex memory-link acceptance flow

---

## 3. Runtime Model

### 3.1 Session Ownership

- transport 단위는 여전히 sidepanel session이다
- 하지만 session 내부에서 실질적 reasoning scope는 `현재 primary tab 1개`로 제한한다

### 3.2 State Shape

최소 상태:

- `sessionId`
- `primaryTabId`
- `latestSnapshot`
- `latestNormalizedContext`
- `activeTurn`

선택 상태:

- `recentVisualSummary`
- `recentMemoryHints`

### 3.3 Non-Required State

해커톤 범위에서 필수 아님:

- referenced tab contexts
- shared working set
- cross-tab relation graph
- reconnect recovery buffer

---

## 4. Minimal Event Contract

### 4.1 Required Client Events

- `session.open`
- `context.update`
- `snapshot.push`
- `user.intent`
- `interrupt`

### 4.2 Optional Client Events

- `selection.update`
- `projection.ack`
- `session.close`

### 4.3 Required Server Events

- `session.ready`
- `progress`
- `projection`
- `turn.done`
- `error`

### 4.4 Optional Server Events

- `retrieval.result`
- `memory.patch`
- `state.patch`

---

## 5. Input Policy

### 5.1 SemanticSnapshot

- canonical input truth
- 반드시 required

### 5.2 ContextPack

- optional input
- FE가 보내면 수용 가능
- backend는 snapshot 기준으로 canonical pack을 재구성 가능해야 함

### 5.3 Planner Input

planner는 raw snapshot이나 FE pack 대신 `NormalizedContextPack`을 사용한다.

---

## 6. Execution Flow

```text
session.open
-> context.update
-> snapshot.push
-> user.intent
-> normalize
-> current-page retrieval
-> explanation / summary / visual interpretation
-> optional recall metadata attach
-> turn.done
```

### 6.1 Current-Page Retrieval

retrieval 기본 규칙:

1. 현재 focus unit
2. 현재 페이지의 nearby semantic units
3. 현재 페이지의 local evidence candidates
4. optional memory recall candidates

### 6.2 Response Families

필수 지원:

- `explain`
- `summarize`
- `clarify`
- `local-compare`

선택 지원:

- `memory-hint`
- `past-similar-case`

---

## 7. Visual Handling

### 7.1 In Scope

허용 visual 대상:

- `chart`
- `diagram`
- `visible UI region`

### 7.2 Rules

- 현재 페이지에서 본 visual context만 사용
- raw visual-only 결과를 final evidence로 직접 쓰지 않음
- visual result는 text summary 또는 structured semantic summary로 변환 후 사용

### 7.3 Typical Questions

- “이 차트가 뭘 말해?”
- “이 다이어그램 구조를 설명해줘”
- “이 화면에서 중요한 영역이 뭐야?”

---

## 8. Memory Handling

### 8.1 Scope

memory는 해커톤에서 보조 기능이지만, 데모 가능한 범위로 포함한다.

### 8.2 Allowed

- long-term memory record lookup
- 현재 페이지와 유사한 record를 recall candidate로 제시
- accepted 수준이 높지 않더라도 “예전에 본 유사 사례” 표현으로 보조 제시
- 가능한 경우 recall 결과에 브라우징 가능한 link / anchor 메타를 함께 제시

### 8.3 Recall Rules

- current-page explanation이 항상 우선이다
- recall은 current-page 답변을 보강하는 방식으로만 사용한다
- memory-only answer를 primary answer로 쓰지 않는다
- recall 결과는 provenance가 분명한 record만 사용한다
- response phrasing은 “예전에 본 유사 사례”, “이전에 저장된 관련 사례” 수준을 기본으로 한다
- recall 결과는 가능하면 `canonicalUrl`과 `nodeAnchor`를 포함해 다시 열어볼 수 있게 한다
- `openMode`는 권장 힌트일 뿐이며, 실제 실행은 FE가 결정한다

### 8.4 Recall Output Recommendation

해커톤 데모 기준 권장 출력:

- 짧은 유사 사례 설명
- 원문 링크 또는 permalink
- comment / section / quote 수준의 위치 힌트
- optional open hint (`same-tab` / `new-tab` / `sidepanel-preview`)

예:

- related page URL
- thread comment permalink
- section heading text
- text quote anchor

### 8.3 Deferred

- aggressive memory-link acceptance
- recall/comparison 중심 multi-step orchestration
- memory-only answer planning

---

## 9. Planner Simplification

해커톤 버전 planner는 다음처럼 단순화한다.

- intent routing은 유지
- retrieval은 current-page first로 고정
- cross-tab planning은 제거
- evidence promotion은 conservative
- memory는 conservative recall layer로 사용 가능

---

## 10. Infra Binding

해커톤 구현은 [BE-SPEC-INFRA.md](./BE-SPEC-INFRA.md)의 최소 GCP 스택을 따른다.

즉:

- `Cloud Run`
- `Cloud SQL + pgvector`
- `Vertex AI`
- `Secret Manager`

---

## 11. Upgrade Boundary

다음 항목은 해커톤 이후 spec으로 미룬다.

- multi-tab session state
- cross-tab retrieval
- `CrossTabEdge`
- richer `memory-link` policy
- visual recall generalization

자세한 업그레이드 목표는 [BE-SPEC-UPGRADE.md](./BE-SPEC-UPGRADE.md)를 따른다.
