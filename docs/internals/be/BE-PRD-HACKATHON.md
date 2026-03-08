# ThreadAtlas Backend PRD

## Hackathon Scope

Version: 0.1-hackathon
Owner: Backend Team
Target Deadline: 2026-03-16 23:59:59
Status: Draft
Companion:
- [BE-SPEC-HACKATHON.md](./BE-SPEC-HACKATHON.md)
- [BE-PRD-UPGRADE.md](./BE-PRD-UPGRADE.md)

---

## 1. Product Goal

해커톤 제출용 backend의 목표는 다음 하나로 줄인다.

**현재 사용자가 보고 있는 페이지를 semantic context로 이해하고, turn 단위로 근거를 수집하며, 필요 시 FE enrich를 거쳐 설명/요약/비교/시각 설명을 제공하는 current-page semantic assistant**

즉, v0.1-hackathon은:

- 현재 페이지 이해
- 현재 페이지 기반 대화
- 현재 페이지에서 본 시각 자료 설명
- 필요 시 저장된 memory record의 제한적 과거 회상

까지만 책임진다.

---

## 2. Why Narrow the Scope

현재 일정에서는 범위를 넓히면 다음 리스크가 커진다.

- cross-tab workspace 구현
- memory-link orchestration 고도화
- session recovery / distributed state
- visual recall generalization

해커톤에서는 breadth보다 **설명 가능한 데모 흐름**이 중요하다.

따라서 이번 제출 범위는 `page-centered semantic conversation`으로 제한한다.

---

## 3. User Value

사용자는 현재 페이지를 보면서 다음 질문을 자연스럽게 할 수 있어야 한다.

- “지금 보고 있는 부분이 무슨 뜻이야?”
- “이 댓글/문단의 핵심을 설명해줘”
- “방금 선택한 내용 기준으로 주변 맥락을 요약해줘”
- “이 차트나 다이어그램이 뭘 말하는지 설명해줘”
- “이 페이지 안에서 반대되거나 보강되는 근거가 있어?”

선택적으로:

- “전에 본 비슷한 사례가 있었어?”

이 마지막 질문은 이번 범위에서 완전히 빼지 않고, **제한적 but visible feature**로 포함한다.

---

## 4. Product Definition

v0.1-hackathon backend는 다음으로 정의한다.

**Turn-Oriented Current-Page Evidence Orchestrator**

이 backend는 FE가 소유한 local workspace memory에서 파생된 `SemanticSnapshot`을 입력으로 받아:

- 현재 turn의 질문을 현재 페이지 기준으로 해석하고
- 현재 페이지 중심 retrieval을 수행하고
- 근거가 부족하면 FE에 targeted enrich를 요청하고
- 설명/요약/제한적 비교/시각 설명을 생성하며
- 필요 시 recall과 projection 결과를 반환한다

---

## 5. In Scope

### 5.1 Core

1. `WebSocket` 기반 session
2. `SemanticSnapshot` 기반 입력
3. `ContextPack` optional input 수용
4. 현재 primary tab 1개 기준 turn orchestration
5. 현재 페이지 중심 retrieval
6. evidence gap detection
7. deterministic orchestrator + LLM reasoner
8. explain / summarize / local-compare / clarify
9. 필요 시 FE에 screenshot / visible region / semantic detail을 재요청하는 on-demand enrich flow

### 5.2 Visual

1. 현재 페이지에서 보이는 `chart`, `diagram`, `visible UI region` 설명
2. visual 결과를 summary-bearing semantic result로 변환 후 사용

### 5.3 Memory

1. long-term memory record 저장 가능
2. 현재 페이지와 유사한 memory record를 제한적으로 recall 가능
3. recall 결과는 “예전에 본 유사 사례” 수준의 보조 근거로 제시
4. 가능한 경우 recall 결과에 링크/anchor 같은 browse metadata를 함께 제시
5. 단, memory는 current-page explanation을 대체하지 않고 보강한다

### 5.4 Authentication

1. canonical auth path는 `Google OAuth -> BE verify -> app session token`이다
2. FE는 실사용 경로에서 Google `id_token`을 BE에 전달한다
3. BE는 Google `sub`를 기준으로 local user/session ownership을 결정한다
4. `dev-bootstrap`는 local/test 전용 전환 경로로만 허용한다
5. FE의 `{ userId }` 단독 입력은 canonical contract가 아니며 제거 대상이다

---

## 6. Explicit Out of Scope

다음은 해커톤 범위에서 제외한다.

1. cross-tab workspace
2. `CrossTabEdge` 중심 orchestration
3. 복잡한 `memory-link` 승격 플로우
4. current session 안의 multi-tab compare
5. reconnect 후 full session recovery
6. distributed session state
7. visual / hybrid retrieval generalization
8. 외부 웹 탐색 기반 자료 탐색
9. cross-tab 기반 enrich orchestration

즉 제외되는 것은 “과거 회상 자체”가 아니라,
복잡한 session-aware memory orchestration과 aggressive recall 자동화다.

---

## 7. Core Principles

### 7.1 FE Owns Local Workspace Memory

- 페이지 이동간 semantic graph, snapshot history, local browsing continuity의 1차 책임은 FE에 있다
- backend는 FE가 보낸 현재 snapshot과 선택적 local hint를 받아 reasoning한다
- backend는 current turn 처리 상태와 long-term memory를 책임진다

### 7.2 Turn Is the Primary Execution Unit

- 해커톤 버전의 backend는 session보다 turn을 중심으로 동작한다
- session은 transport와 latest snapshot 보관 역할로 최소화한다
- 실제 근거 수집, enrich, reasoning, recall 결정은 모두 active turn 안에서 일어난다

### 7.3 Page First

해커톤 버전은 sidepanel transport를 유지하더라도, 제품 범위는 **현재 페이지 중심**으로 제한한다.

### 7.4 SemanticSnapshot Is the SoT

- backend는 `SemanticSnapshot`을 ground truth로 사용한다
- raw DOM을 직접 기준으로 reasoning하지 않는다

### 7.5 ContextPack Is Helpful but Not Authoritative

- FE `ContextPack`은 수용 가능하다
- 하지만 planner authority는 backend normalized context에 있다

### 7.6 Retrieval Before Generation

- 답변은 현재 페이지 semantic context를 먼저 본다
- 근거가 약하면 `clarify` 또는 `suggest`로 후퇴한다

### 7.7 Evidence Gap Can Trigger Enrichment

- backend는 1차 retrieval과 reasoning만으로 충분하지 않을 때 enrich를 요청할 수 있다
- enrich는 별도 feature가 아니라 turn 안의 evidence-gathering sub-loop다
- enrich 실패는 turn 실패가 아니라 fallback 조건으로 다룬다

### 7.8 Memory Recall Is Allowed but Conservative

- 과거 회상은 허용한다
- 하지만 current-page grounding보다 앞서지 않는다
- recall 결과는 기본적으로 유사 사례 또는 보조 근거로 표현한다
- recall 결과에는 가능하면 URL, permalink, heading, quote 같은 browse metadata를 함께 준다
- browse metadata의 실제 실행 방식은 FE가 결정하고, BE는 권장 open hint만 제공한다

### 7.9 BE Can Request Targeted Enrichment

- canonical path는 여전히 FE가 push한 snapshot 기준이다
- 하지만 해커톤 범위에서도 backend는 필요 시 FE에 targeted enrichment를 요청할 수 있다
- backend는 `SemanticSnapshot`과 현재 turn 맥락을 바탕으로 무엇을 더 캡처해야 하는지 결정한다
- 허용 enrich 종류는 screenshot, visible region recapture, semantic node detail이다
- enrich request는 current-page reasoning을 보강하기 위한 보조 수단으로만 사용한다
- 실제 캡처 방식과 DOM 접근 방식은 FE가 결정한다

### 7.10 Visual Is Allowed, but Grounded

- visual result는 허용한다
- 하지만 raw visual-only 결과를 곧바로 final evidence로 쓰지 않는다

---

## 8. Simplified Interaction Model

```text
FE Local Workspace
-> Current Page Snapshot
-> Normalize
-> Current-Page Retrieval
-> Initial Reasoning
-> Optional Enrich Request / Result
-> Final Reasoning
-> Optional Memory Hint + Browse Metadata
-> Client Delivery
```

turn 관점으로 보면 다음과 같다.

```text
user.intent
-> normalize
-> retrieve
-> detect evidence gap
-> optional enrich
-> respond
-> optional recall attach
-> turn.done
```

---

## 9. Required User Experience

데모에서 반드시 보여줄 수 있어야 하는 흐름:

1. sidepanel 연결
2. snapshot push
3. 사용자 질문
4. 진행 상태 표시
5. 필요 시 screenshot/detail 재요청
6. grounded explanation 또는 summary 응답
7. 필요 시 chart/diagram explanation
8. 필요 시 “예전에 본 유사 사례”와 다시 열 수 있는 link/anchor 힌트 제시

보여주면 좋은 흐름:

1. 현재 페이지 내 비교
2. 현재 페이지 설명 뒤에 이어지는 제한적 과거 회상

---

## 10. Success Criteria

해커톤 성공 기준은 다음이다.

1. WebSocket 기반 대화가 안정적으로 동작한다
2. 현재 페이지 semantic snapshot을 기준으로 답변한다
3. 현재 페이지의 chart/diagram 설명이 가능하다
4. 필요 시 screenshot/detail enrich를 요청하고 반영할 수 있다
5. enrich 실패 시에도 graceful fallback이 가능하다
6. 답변이 현재 focus와 주변 맥락에 grounded 되어 있다
7. 제한적 과거 회상이 current-page 답변을 보강할 수 있다
8. FE와의 handoff가 현재 페이지 기준에서 일관된다

---

## 11. Deferred Upgrade Themes

해커톤 이후 다음을 업그레이드 대상으로 둔다.

1. sidepanel workspace 중심 multi-tab session
2. cross-tab retrieval
3. stronger memory-link policy
4. visual recall generalization
5. distributed session state
6. cross-tab enrich orchestration

자세한 내용은 [BE-PRD-UPGRADE.md](./BE-PRD-UPGRADE.md)를 따른다.
