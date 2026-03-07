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

**현재 사용자가 보고 있는 페이지를 semantic context로 이해하고, WebSocket 기반 대화로 설명/요약/비교/시각 설명을 제공하는 current-page semantic assistant**

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

**Current-Page Semantic Conversation Backend**

이 backend는 FE가 보낸 `SemanticSnapshot`을 입력으로 받아:

- 현재 페이지의 focus와 주변 맥락을 해석하고
- 현재 페이지 중심 retrieval을 수행하고
- 설명/요약/제한적 비교/시각 설명을 생성하며
- 필요 시 간단한 projection 결과를 반환한다

---

## 5. In Scope

### 5.1 Core

1. `WebSocket` 기반 session
2. `SemanticSnapshot` 기반 입력
3. `ContextPack` optional input 수용
4. 현재 primary tab 1개 기준 대화
5. 현재 페이지 중심 retrieval
6. deterministic planner + LLM reasoner
7. explain / summarize / local-compare / clarify

### 5.2 Visual

1. 현재 페이지에서 보이는 `chart`, `diagram`, `visible UI region` 설명
2. visual 결과를 summary-bearing semantic result로 변환 후 사용

### 5.3 Memory

1. long-term memory record 저장 가능
2. 현재 페이지와 유사한 memory record를 제한적으로 recall 가능
3. recall 결과는 “예전에 본 유사 사례” 수준의 보조 근거로 제시
4. 가능한 경우 recall 결과에 링크/anchor 같은 browse metadata를 함께 제시
5. 단, memory는 current-page explanation을 대체하지 않고 보강한다

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

즉 제외되는 것은 “과거 회상 자체”가 아니라,
복잡한 session-aware memory orchestration과 aggressive recall 자동화다.

---

## 7. Core Principles

### 7.1 Page First

해커톤 버전은 sidepanel transport를 유지하더라도, 제품 범위는 **현재 페이지 중심**으로 제한한다.

### 7.2 SemanticSnapshot Is the SoT

- backend는 `SemanticSnapshot`을 ground truth로 사용한다
- raw DOM을 직접 기준으로 reasoning하지 않는다

### 7.3 ContextPack Is Helpful but Not Authoritative

- FE `ContextPack`은 수용 가능하다
- 하지만 planner authority는 backend normalized context에 있다

### 7.4 Retrieval Before Generation

- 답변은 현재 페이지 semantic context를 먼저 본다
- 근거가 약하면 `clarify` 또는 `suggest`로 후퇴한다

### 7.5 Memory Recall Is Allowed but Conservative

- 과거 회상은 허용한다
- 하지만 current-page grounding보다 앞서지 않는다
- recall 결과는 기본적으로 유사 사례 또는 보조 근거로 표현한다
- recall 결과에는 가능하면 URL, permalink, heading, quote 같은 browse metadata를 함께 준다
- browse metadata의 실제 실행 방식은 FE가 결정하고, BE는 권장 open hint만 제공한다

### 7.6 Visual Is Allowed, but Grounded

- visual result는 허용한다
- 하지만 raw visual-only 결과를 곧바로 final evidence로 쓰지 않는다

---

## 8. Simplified Interaction Model

```text
Current Page Snapshot
-> Normalize
-> Current-Page Retrieval
-> Explanation / Summary / Visual Interpretation
-> Optional Memory Hint + Browse Metadata
-> Client Delivery
```

---

## 9. Required User Experience

데모에서 반드시 보여줄 수 있어야 하는 흐름:

1. sidepanel 연결
2. snapshot push
3. 사용자 질문
4. 진행 상태 표시
5. grounded explanation 또는 summary 응답
6. 필요 시 chart/diagram explanation
7. 필요 시 “예전에 본 유사 사례”와 다시 열 수 있는 link/anchor 힌트 제시

보여주면 좋은 흐름:

1. 현재 페이지 내 비교
2. 현재 페이지 설명 뒤에 이어지는 제한적 과거 회상

---

## 10. Success Criteria

해커톤 성공 기준은 다음이다.

1. WebSocket 기반 대화가 안정적으로 동작한다
2. 현재 페이지 semantic snapshot을 기준으로 답변한다
3. 현재 페이지의 chart/diagram 설명이 가능하다
4. 답변이 현재 focus와 주변 맥락에 grounded 되어 있다
5. 제한적 과거 회상이 current-page 답변을 보강할 수 있다
6. FE와의 handoff가 현재 페이지 기준에서 일관된다

---

## 11. Deferred Upgrade Themes

해커톤 이후 다음을 업그레이드 대상으로 둔다.

1. sidepanel workspace 중심 multi-tab session
2. cross-tab retrieval
3. stronger memory-link policy
4. visual recall generalization
5. distributed session state

자세한 내용은 [BE-PRD-UPGRADE.md](./BE-PRD-UPGRADE.md)를 따른다.
