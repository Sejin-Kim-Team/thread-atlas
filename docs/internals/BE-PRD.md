# ThreadAtlas Backend PRD

## Sessionful Intent-Grounded Semantic Navigation Backend

Version: 0.1
Owner: Backend Team
Target: Gemini Live Agent Challenge
Status: Draft

---

## 1. Problem

사용자는 웹을 읽는 동안 단순히 "요약"만 원하지 않는다.

실제로는 다음과 같은 작업을 원한다.

- 지금 보고 있는 주장과 연결된 근거 찾기
- 현재 노드와 반대되는 논지 찾기
- 방금 본 원문과 토론을 비교하기
- 예전에 읽었던 유사한 사례를 회상하기
- 필요한 위치로 즉시 이동하기

기존 웹 환경에서는 이 작업이 사용자에게 과도하게 수동적이다.

1. 사용자가 직접 스크롤해야 한다
2. 여러 탭을 오가며 맥락을 유지해야 한다
3. 과거에 본 자료를 스스로 떠올려야 한다
4. 같은 주제의 관련 근거를 페이지와 세션을 넘어서 연결하기 어렵다

ThreadAtlas Backend는 이를 해결하기 위해,

- 현재 세션의 semantic context
- 사용자의 intent
- 현재/과거 semantic knowledge

를 결합하여

- analysis
- evidence
- navigation
- memory recall

를 실시간으로 제공하는 backend다.

---

## 2. Product Goal

사용자가 sidepanel 기반 탐색 세션 안에서 질문하면, backend는 다음을 수행해야 한다.

1. 현재 세션의 primary tab context를 이해한다
2. 필요하면 reference tab context를 함께 읽는다
3. 필요하면 long-term memory에서 유사한 semantic unit을 찾는다
4. semantic unit 사이의 관계를 해석한다
5. 사용자가 이해 가능한 설명을 만든다
6. 필요 시 이동 가능한 target과 projection을 생성한다

즉 backend의 핵심 흐름은 다음과 같다.

```text
Session Context
-> Intent Routing
-> Retrieval Planning
-> Session RAG / Long-term RAG
-> Relation Analysis
-> Response / Projection Planning
-> Client Delivery
```

---

## 3. Product Definition

ThreadAtlas Backend는 단순한 LLM 호출 서버가 아니다.

이 backend는

**Sessionful Intent-Grounded Semantic Navigation Backend**

이며,

사용자의 질문을

**현재 semantic context와 관련된 근거를 찾고, 관계를 분석하고, 필요한 경우 이동 가능한 대상으로 연결하는 문제**

로 해석하는 시스템이다.

---

## 4. Non-Goals (v0.1)

다음은 v0.1에서 목표로 두지 않는다.

1. 범용 크롤러 구축
2. 대규모 knowledge graph 완성
3. 완전한 autonomous browsing
4. 웹 전체 인덱싱
5. 모든 시각 자료에 대한 완전한 멀티모달 이해
6. 분산형 대규모 벡터 인프라 최적화

---

## 5. Core Principles

### 5.1 Session First

backend의 1급 단위는 request가 아니라 session이다.

- session의 주인은 sidepanel이다
- 탭은 session 안의 context unit이다
- turn, interruption, retrieval, memory write는 모두 session 안에서 이어진다

### 5.2 Semantic Snapshot Is the Input Ground Truth

FE가 보내는 semantic snapshot이 현재 웹 상태의 기준점이다.

- backend는 raw DOM을 기준으로 판단하지 않는다
- backend는 FE의 semantic extraction 결과를 받아 reasoning한다
- context pack은 snapshot에서 파생된 LLM-friendly IR로 취급한다

### 5.3 Tab Isolation by Default

세션이 하나여도 데이터는 기본적으로 탭별로 격리된다.

- primary tab이 기본 retrieval scope다
- 다른 탭은 명시적 relation이 있을 때만 참조한다
- 과거 memory hit는 바로 현재 사실로 쓰지 않는다
- shared working set에는 raw context를 올리지 않고 승격된 사실만 올린다

### 5.4 Retrieval Before Generation

생성보다 retrieval과 relation analysis가 우선이다.

- 답변은 retrieval 없이 임의로 구성하지 않는다
- 근거가 약하면 clarify/suggest로 후퇴한다
- provenance와 confidence를 명시적으로 관리한다

### 5.5 Navigation Is Part of Reasoning

navigation은 별도의 부가 기능이 아니라 reasoning의 결과물이다.

- same page focus
- same thread navigation
- cross-page reference

는 retrieval과 relation analysis의 부산물이어야 한다.

### 5.6 Deterministic Planner + LLM Reasoner

v0.1의 canonical architecture는 다음과 같다.

- deterministic:
  - intent routing
  - retrieval planning
  - response/projection planning
- LLM:
  - relation analysis
  - explanation generation

즉 planner 전체를 LLM에 위임하지 않는다.
backend는 예측 가능한 흐름 제어를 유지하고, LLM은 해석과 생성에 집중한다.

---

## 6. Minimum Contract Definitions

v0.1 PRD는 상세 type schema를 모두 고정하지는 않지만, FE/BE 경계와 planner 구현을 위해 다음 최소 계약은 명시한다.

### 6.1 SemanticSnapshot

backend가 수용하는 canonical input ground truth.

최소 의미:

- current page identity
- focus semantic node
- nearby semantic context
- provenance / capture metadata

규칙:

- backend는 `SemanticSnapshot`을 SoT로 취급한다
- raw DOM을 직접 기준으로 reasoning하지 않는다

### 6.2 ContextPack

`SemanticSnapshot`에서 파생되는 LLM-friendly context view.

최소 의미:

- focus-centered grouping
- nearby context
- referenced context
- summaries
- provenance

규칙:

- backend는 `ContextPack`을 optional derived input으로 수용할 수 있다
- 필요 시 backend가 `SemanticSnapshot`으로부터 재구성할 수 있어야 한다
- `ContextPack`은 `SemanticSnapshot`을 대체하지 않는다
- FE가 `ContextPack`을 보내더라도 planner authority는 backend가 재구성하거나 정규화한 내부 pack에 있다

### 6.3 SemanticUnit

retrieval, relation, memory의 canonical reasoning 단위.

대표 예시:

- focus branch
- focus section
- discussion subtree
- claim + evidence set
- article section
- interactive control cluster

규칙:

- `SemanticUnit`은 FE raw node와 반드시 1:1일 필요는 없다
- backend는 여러 semantic node를 묶어 하나의 unit으로 다룰 수 있다

### 6.4 NavigationTarget

사용자를 이동시킬 수 있는 의미 위치.

최소 의미:

- destination identity
- target semantic anchor
- action intent

예시:

- same page focus
- same page branch jump
- cross page open
- sidepanel evidence preview

### 6.5 Projection

client가 실행하는 출력/행동 단위.

최소 계열:

- focus
- navigate
- present
- notify
- answer / suggest / clarify에 대응하는 설명성 projection

### 6.6 SessionState

backend가 유지해야 하는 canonical session state.

최소 의미:

- primary tab
- tab contexts
- shared working set
- turn history
- interruption / clarification state

---

## 7. Core Concepts

### 7.1 Sidepanel Session

하나의 sidepanel 인스턴스가 하나의 backend session에 대응한다.

이 session은

- active tab
- recent referenced tabs
- current turn state
- session-scoped retrieval cache
- session memory

를 가진다.

### 7.2 Tab Context

세션 안에서 각 탭은 독립적인 semantic context를 가진다.

각 tab context는 최소한 다음을 가진다.

- latest semantic snapshot
- latest context pack
- local facts
- local summaries
- local relation graph

### 7.3 Semantic Unit

backend가 retrieval, relation, memory의 기본 단위로 사용하는 의미 단위.

예:

- focus branch
- focus section
- discussion subtree
- claim + evidence set
- article section
- interactive control cluster

### 7.4 Relation Edge

semantic context 간 연결을 나타내는 관계 객체.

상위 개념은 relation edge 하나로 두되, 하위 의미는 구분한다.

- `cross-tab`
  - 현재 session 안의 탭 관계
- `memory-link`
  - 과거 memory와 현재 context의 유사성 관계

### 7.5 Navigation Target

analysis 결과 사용자를 실제로 안내할 수 있는 target.

예:

- same page focus
- same page branch jump
- cross page open
- sidepanel evidence preview

---

## 8. Backend Responsibilities

backend는 최소한 다음 책임을 가진다.

### 8.1 Session Management

- WebSocket session open/close
- active turn 관리
- interruption 처리
- tab context 상태 유지

### 8.2 Semantic Context Ingestion

- semantic snapshot 수용
- context pack 수용 또는 재구성
- tab context 업데이트
- provenance 기록

### 8.3 Retrieval Planning

- 현재 질문이 primary tab만으로 풀리는지 판단
- cross-tab retrieval이 필요한지 판단
- long-term memory retrieval이 필요한지 판단
- retrieval scope를 결정

### 8.4 Relation Analysis

- semantic unit 간 관계 분석
- contradiction / support / elaboration / similarity / reference 판별
- confidence와 evidence 추적

### 8.5 Response and Projection Planning

- answer / suggest / clarify 판단
- focus / navigate / present / notify 계획
- navigation target 결정

### 8.6 Memory Handling

- session memory 유지
- accepted fact 승격
- long-term memory write
- memory-link candidate 관리

---

## 9. Execution Strategy

v0.1 backend의 canonical execution pipeline은 다음과 같다.

```text
Session Event
-> Intent Router
-> Retrieval Planner
-> Candidate Retrieval
-> Relation Analysis
-> Evidence Promotion
-> Response / Projection Planning
-> Client Delivery
```

### 9.1 Intent Router

입력을 질문 유형으로 분류하고, 이후 planner가 사용할 초기 policy를 결정한다.

### 9.2 Retrieval Planner

retrieval scope, depth, expansion 여부를 결정한다.

### 9.3 Candidate Retrieval

primary tab, cross-tab, session working set, long-term memory에서 후보 semantic unit을 가져온다.

### 9.4 Relation Analysis

후보와 현재 focus/intent 사이의 관계를 해석한다.

### 9.5 Evidence Promotion

memory hit나 약한 관계를 바로 사실로 쓰지 않고, 채택 가능한 evidence로 승격할지 결정한다.

### 9.6 Response / Projection Planning

answer/suggest/clarify와 focus/navigate/present/notify 조합을 결정한다.

---

## 10. Session Architecture

```text
WebSocket Session Gateway
  -> Session Store
    -> Conversation State
    -> Primary Tab Context
    -> Referenced Tab Contexts
    -> Shared Working Set
    -> Session Retrieval Cache
  -> Intent Router
  -> Retrieval Planner
  -> Session RAG
  -> Long-term RAG
  -> Relation Analyzer
  -> Response / Projection Planner
```

### 10.1 Session Store

세션 상태의 기준 저장소.

포함 상태:

- active turn
- pending clarification
- interrupted turn
- tab contexts
- shared working set

### 10.2 Shared Working Set

세션 안에서 공유 가능한 소수의 승격된 사실과 relation만 저장한다.

포함 대상:

- promoted facts
- relation edges
- shared hypotheses

비포함 대상:

- raw snapshot 전체
- provenance가 약한 memory candidate

---

## 11. Communication Model

### 11.1 Canonical Path

backend의 canonical 평가 경로는 WebSocket session이다.

`POST /api/evaluate + SSE`는 canonical path가 아니다.

### 11.2 Remaining HTTP Surface

v0.1에서 HTTP는 최소한 다음만 남길 수 있다.

- `/api/token`
- `/api/analyze` 또는 후속 ingest endpoint
- `/api/health`

### 11.3 Session Event Model

client는 최소한 다음 이벤트를 보낸다.

- `session.open`
- `context.update`
- `snapshot.push`
- `selection.update`
- `user.intent`
- `interrupt`
- `projection.ack`

server는 최소한 다음 이벤트를 보낸다.

- `session.ready`
- `progress`
- `retrieval.result`
- `projection`
- `state.patch`
- `memory.patch`
- `turn.done`
- `error`

---

## 12. Retrieval Architecture

### 12.1 Two-Layer RAG

backend retrieval은 2계층으로 나눈다.

#### Layer A. Session RAG

현재 session 내부의 초저지연 retrieval.

입력 원천:

- primary tab snapshot
- reference tab snapshots
- context packs
- session summaries
- promoted facts

역할:

- 현재 질문에 필요한 context를 빠르게 회수
- cross-tab relation을 활용한 제한적 확장

#### Layer B. Long-term RAG

과거 세션과 저장된 semantic knowledge에 대한 retrieval.

입력 원천:

- 과거 branch summary
- section summary
- claim/evidence set
- article section
- interactive cluster summary

역할:

- memory recall
- cross-session similarity
- previously visited knowledge 검색

### 12.2 Retrieval Order

retrieval planner의 기본 순서는 다음과 같다.

1. primary tab
2. current session의 cross-tab references
3. shared working set
4. long-term memory

### 12.3 Retrieval Modes

v0.1에서 지원할 retrieval mode:

- semantic text retrieval
- relation-aware retrieval
- memory similarity retrieval

확장 가능 mode:

- visual retrieval
- hybrid retrieval

### 12.4 Retrieval Planner Policy

v0.1에서 planner는 최소한 다음 규칙을 가진다.

| Intent family | Primary scope | Expansion | Weak evidence fallback |
| --- | --- | --- | --- |
| analysis / evidence | primary tab first | same session cross-tab optional | suggest / clarify |
| comparison | primary tab + referenced tabs | cross-tab required | clarify |
| recall | primary tab + long-term memory | memory search enabled | suggest / clarify |
| navigation | primary tab first | referenced tab if target not local | suggest |
| clarification response | previous turn context | no broad expansion by default | ask narrower follow-up |

규칙:

- primary tab retrieval은 항상 1순위다
- cross-tab expansion은 explicit relation 또는 comparison intent가 있을 때만 허용한다
- long-term memory는 recall intent 또는 planner 판단이 있을 때만 검색한다
- stale context는 보수적으로 다룬다

---

## 13. Relation Analysis

backend는 retrieval된 semantic unit과 현재 focus 사이의 관계를 분석한다.

핵심 relation 예시:

- similar
- supports
- contradicts
- elaborates
- references
- same_topic

### 13.1 Cross-Tab Relation

현재 session 안의 탭 관계는 비교적 강한 구조 관계로 취급한다.

예:

- source-of
- opened-from
- compares-with
- references

이 relation은 retrieval expansion의 1급 근거가 된다.

### 13.2 Memory Link

과거 memory와의 연결은 기본적으로 가설이다.

따라서 memory retrieval hit는 바로 answer evidence가 아니라

- candidate
- accepted
- rejected

단계를 가진다.

accepted 되기 전까지는 보수적으로 사용한다.

### 13.3 Relation Analysis Strategy

v0.1의 relation analysis는 다음 혼합 전략을 사용한다.

1. candidate generation
   - retrieval score
   - metadata overlap
   - session relation signals
2. relation judgment
   - deterministic heuristics + LLM classification
3. final evidence policy
   - strong cross-tab relation은 직접 evidence 후보 가능
   - memory-link는 candidate -> accepted / rejected 단계를 거침

즉 relation analysis는 pure embedding similarity만으로 끝나지 않는다.

---

## 14. Planning Policy

### 14.1 Intent Router

intent router는 질문을 다음 계열로 분류한다.

- analysis request
- evidence request
- navigation request
- comparison request
- memory recall request
- clarification response

### 14.2 Retrieval Planner

retrieval planner는 다음을 결정한다.

- primary tab만으로 충분한가
- cross-tab relation이 필요한가
- long-term memory를 검색할 것인가
- 결과 confidence가 충분한가

### 14.3 Response Planner

response planner는 다음 중 무엇을 할지 결정한다.

- answer
- suggest
- clarify
- focus
- navigate
- present

### 14.4 Confidence Policy

planner는 provenance와 confidence를 사용해 답변 강도를 조절한다.

예:

- strong cross-tab relation + fresh snapshot -> 직접 설명 가능
- weak memory similarity -> suggest/clarify 우선
- stale snapshot -> recapture 또는 제한적 응답

---

## 15. Output Model

backend의 결과물 철학은 다음 세 축이다.

1. analysis
2. evidence
3. navigation

WS event 관점에서는 다음처럼 분해된다.

- analysis -> answer / suggest / clarify
- evidence -> retrieval result / provenance / promoted fact
- navigation -> focus / navigate / present projection

즉 backend는 단일 문자열을 반환하는 서버가 아니라,

**설명 + 근거 + 이동 계획을 조합해 스트리밍하는 서버**

다.

---

## 16. Memory Model

### 16.1 Session Memory

현재 session 안에서 유지되는 working memory.

포함:

- recent turns
- promoted facts
- accepted memory links
- shared hypotheses

### 16.2 Long-term Memory

세션을 넘어 저장되는 semantic memory.

저장 단위 예시:

- branch summary
- section summary
- claim/evidence summary
- article section summary
- control cluster summary

### 16.3 Write Policy

다음만 장기 기억으로 저장한다.

- 충분한 confidence가 있는 summary
- user intent와 relevance가 확인된 fact
- 비교/회상 가치가 높은 semantic unit

다음은 저장하지 않는다.

- raw noisy snapshot
- 검증되지 않은 candidate relation
- 민감한 interactive value

---

## 17. Storage and Indexing

v0.1에서는 저장소 기술 선택보다 저장 철학이 중요하다.

필요 저장소:

- session state store
- semantic memory store
- vector index
- metadata/provenance store

기술 후보:

- relational DB + vector extension
- dedicated vector store
- cache store for session state

핵심 요구:

- semantic unit 단위 retrieval 가능
- provenance 추적 가능
- session과 long-term memory 구분 가능

---

## 18. MVP Scope

v0.1 MVP에 포함할 것:

1. WebSocket session gateway
2. sidepanel session 기준 state model
3. semantic snapshot/context pack 수용
4. primary tab + cross-tab retrieval
5. long-term memory retrieval의 최소 버전
6. relation analysis
7. answer / clarify / suggest + focus/navigation planning
8. memory-link candidate -> accepted 승격 흐름
9. text-first semantic navigation canonical flow

v0.1 MVP에서 제외할 것:

1. 대규모 자동 knowledge synthesis
2. full claim graph 영속화
3. 완전한 visual retrieval pipeline
4. 고급 chart clustering
5. autonomous browsing executor
6. distributed session handling
7. visual / hybrid retrieval의 전면적 일반화

### 18.1 MVP Boundary Notes

- v0.1의 canonical flow는 text-first semantic navigation이다
- visual / hybrid retrieval은 architecture-compatible하게만 설계하고, 실제 지원은 제한적 시나리오에 한정한다
- session scope는 single-sidepanel 기준으로 정의한다

---

## 19. Success Criteria

시스템은 다음을 만족해야 한다.

### 19.1 Current Context

사용자의 질문에 대해 현재 primary tab context에서 관련 semantic unit을 찾을 수 있다.

### 19.2 Cross-Tab Reasoning

원문 탭과 토론 탭처럼 현재 session 안의 관련 탭을 함께 사용해 설명할 수 있다.

### 19.3 Memory Recall

사용자의 회상 질문에 대해 과거 semantic memory에서 유사한 단위를 찾고, 불확실하면 보수적으로 응답할 수 있다.

### 19.4 Navigation

답변은 필요 시 이동 가능한 target과 함께 제공된다.

### 19.5 Provenance

backend는 어떤 탭/기억/semantic unit을 근거로 답했는지 추적할 수 있다.

---

## 20. Open Questions

1. long-term memory의 canonical 저장 단위를 무엇으로 고정할 것인가
2. memory-link accepted 기준을 어떤 threshold와 policy로 둘 것인가
3. visual / hybrid retrieval을 v0.1 이후 어떤 시점에 일반화할 것인가

---

## 21. One-Sentence Definition

ThreadAtlas Backend는

**사용자의 sidepanel 세션 안에서 semantic context를 수용하고, retrieval과 relation analysis를 통해 설명과 근거와 이동 계획을 생성하는 sessionful semantic navigation backend**

다.
