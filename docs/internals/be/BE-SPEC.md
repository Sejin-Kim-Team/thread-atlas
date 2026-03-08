# ThreadAtlas Backend Spec

## Overview and Runtime Architecture

Version: 0.1
Status: Draft

> Note: 이 문서는 해커톤 이후 업그레이드 타깃까지 포함한 full spec overview에 가깝다.
> 2026-03-16 제출 기준의 구현 우선순위는 [BE-SPEC-HACKATHON.md](./BE-SPEC-HACKATHON.md)를 먼저 따른다.
> `feature/be-rag-persistence` 브랜치 구현 범위는 [BE-SPEC-RAG-HACKATHON.md](./BE-SPEC-RAG-HACKATHON.md)의 브랜치 범위/완료 조건을 우선 적용한다.
> `feature/be-enrich-subloop` 브랜치에서는 enrich sub-loop(runtime state transition, request/result, fallback) 연결 규칙과 trigger mode(`rule | hybrid-simple | hybrid-complex`) 정책을 우선 적용한다.
> `feature/be-enrich-subloop`에서 `requestKind`는 `node-screenshot | visible-region | node-detail`만 허용하며, `page-entity`는 `targetRef`로만 표현한다. `ENRICH_TRIGGER_MODE` 미설정 시 기본값은 `hybrid-complex`이며, 오설정은 fail-fast 대상이다.
> 해커톤 RAG embedding canonical path는 `Vertex AI(gemini-embedding-001, output_dimensionality=768)`이며, pseudo embedding 대체는 허용하지 않는다.
> 해커톤 current-page answer canonical path는 `@google/genai` + Vertex `models.generateContent`이며, stub/placeholder answer 대체는 허용하지 않는다.

Companion:
- [BE-SPEC-HACKATHON.md](./BE-SPEC-HACKATHON.md)
- [BE-SPEC-UPGRADE.md](./BE-SPEC-UPGRADE.md)
- [BE-PRD.md](./BE-PRD.md)
- [BE-SPEC-IMPLEMENTATION-RULES.md](./BE-SPEC-IMPLEMENTATION-RULES.md)
- [BE-SPEC-CONTEXT.md](./BE-SPEC-CONTEXT.md)
- [BE-SPEC-PLANNER.md](./BE-SPEC-PLANNER.md)
- [BE-SPEC-PROTOCOL.md](./BE-SPEC-PROTOCOL.md)
- [BE-SPEC-MEMORY.md](./BE-SPEC-MEMORY.md)
- [BE-SPEC-AUTH-HACKATHON.md](./BE-SPEC-AUTH-HACKATHON.md)
- [BE-SPEC-RAG-HACKATHON.md](./BE-SPEC-RAG-HACKATHON.md)
- [BE-SPEC-INGEST.md](./BE-SPEC-INGEST.md)
- [BE-SPEC-INFRA.md](./BE-SPEC-INFRA.md)

---

## 1. Purpose

본 문서는 ThreadAtlas backend의 canonical runtime 구조를 정의한다.

이 문서는 다음을 고정한다.

- backend의 1급 실행 단위는 request가 아니라 `sidepanel session`
- canonical transport는 `WebSocket`
- canonical input truth는 `SemanticSnapshot`
- planner architecture는 `Deterministic Planner + LLM Reasoner`
- retrieval은 `Session RAG + Long-term RAG` 2계층으로 동작

세부 컨텍스트 모델과 planner 규칙은 companion spec으로 분리한다.

구현 경계 규칙(SQL 배치, Express 레이어 경계, 한글 주석 원칙)은
[BE-SPEC-IMPLEMENTATION-RULES.md](./BE-SPEC-IMPLEMENTATION-RULES.md)를 반드시 따른다.

---

## 2. Canonical Runtime Definition

ThreadAtlas backend는 다음으로 정의한다.

**Sessionful Intent-Grounded Semantic Navigation Backend**

이 backend는 sidepanel session 안에서 semantic context를 수용하고, retrieval과 relation analysis를 통해 설명, 근거, 이동 계획을 생성한다.

---

## 3. Canonical Architecture

```text
WebSocket Session Gateway
  -> Session Store
    -> Conversation State
    -> Primary Tab Context
    -> Referenced Tab Contexts
    -> Shared Working Set
    -> Session Retrieval Cache
  -> Context Ingestion Pipeline
    -> Snapshot Validation
    -> Canonical ContextPack Build
    -> Context Normalization
  -> Intent Router
  -> Retrieval Planner
  -> Session RAG
  -> Long-term RAG
  -> Relation Analyzer
  -> Evidence Promotion
  -> Response / Projection Planner
  -> Client Delivery
```

### 3.1 Deterministic Planner + LLM Reasoner

v0.1은 planner 전체를 LLM에 위임하지 않는다.

Deterministic responsibility:
- session state transition
- intent routing
- retrieval scope planning
- evidence promotion policy
- response/projection planning

LLM responsibility:
- relation classification
- explanation generation
- grounded comparison phrasing

### 3.2 Canonical Input Rule

- backend는 raw DOM을 reasoning truth로 사용하지 않는다
- backend는 `SemanticSnapshot`을 canonical input truth로 사용한다
- `ContextPack`은 snapshot-derived input이며 authoritative source가 아니다
- 입력 계약 타입은 `@threadatlas/shared`를 canonical source로 사용한다
- BE는 입력 계약 타입을 자체 축약/재정의하지 않고, 내부 모델은 `NormalizedContextPack`으로 분리한다

---

## 4. Session Model

### 4.1 Session Ownership

backend session의 주인은 `sidepanel`이다.

- 하나의 sidepanel 인스턴스는 하나의 backend session에 대응한다
- 탭 전환은 세션 전환이 아니라 `context.update`다
- turn, interruption, retrieval, memory write는 모두 session 안에서 이어진다

### 4.2 Session State

최소 session state는 다음을 포함한다.

- `primaryTabId`
- `tabContexts`
- `sharedWorkingSet`
- `turnHistory`
- `activeTurn`
- `pendingClarification`
- `interruptedTurn`

### 4.3 Tab Isolation Rule

세션이 하나여도 raw context는 기본적으로 탭별로 격리한다.

- primary tab이 기본 retrieval scope다
- 다른 탭은 relation이 있을 때만 retrieval 후보가 된다
- long-term memory hit는 바로 현재 사실로 간주하지 않는다
- shared working set에는 raw snapshot이 아니라 승격된 사실만 저장한다

---

## 5. Transport and Event Model

### 5.1 Canonical Transport

backend의 canonical evaluation path는 `WebSocket session`이다.

canonical endpoint는 `/ws/session`이다.

`POST /api/evaluate + SSE`는 v0.1 canonical path가 아니다.

`/ws/session/events`는 테스트/디버그용 HTTP ingress adapter로 유지할 수 있지만 canonical path가 아니다.

### 5.2 Remaining HTTP Surface

v0.1에서 HTTP는 다음 범위로 제한한다.

- `/api/token`
- `/api/analyze`
- `/api/ingest/memory`
- `/health`
- `/ready`

운영 체크 의미:

- `/health`: process liveness
- `/ready`: DB readiness(`select 1`) 기반 준비 상태

DB 연결 규칙:

- 로컬 개발의 canonical path는 `DATABASE_URL` direct connection이다
- Cloud Run 배포의 canonical path는 `@google-cloud/cloud-sql-connector` 기반 connector profile이다
- 두 프로파일은 동일한 `pg` pool 인터페이스를 공유해야 하며 repository/query 계층 계약을 변경하지 않아야 한다

### 5.3 Client -> Server Events

client는 최소한 다음 이벤트를 전송해야 한다.

- `session.open`
- `session.close`
- `context.update`
- `snapshot.push`
- `selection.update`
- `user.intent`
- `interrupt`
- `projection.ack`

### 5.4 Server -> Client Events

server는 최소한 다음 이벤트를 전송해야 한다.

- `session.ready`
- `progress`
- `retrieval.result`
- `projection`
- `state.patch`
- `memory.patch`
- `turn.done`
- `error`

### 5.5 Event Handling Rules

- `user.intent`는 반드시 active turn binding을 가진다
- `snapshot.push`는 항상 특정 `tabId`에 귀속된다
- `turn.done`은 사용된 provenance와 referenced tabs를 명시해야 한다
- `interrupt`는 현재 active turn을 중단 가능한 상태로 전이시켜야 한다
- navigation/projection 관련 실제 UX 실행은 client가 결정하고, backend는 target과 hint를 제안한다
- WebSocket handshake 인증과 HTTP ingress 인증은 동일 principal 해석 규약을 따라야 한다

---

## 6. Execution Pipeline

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

### 6.1 Session Event

세션 이벤트는 상태 전이의 시작점이다.

예:
- 새 snapshot 수용
- user intent 도착
- interrupt 수신

### 6.2 Intent Router

입력을 intent family로 분류하고 planner 기본 policy를 설정한다.

### 6.3 Retrieval Planner

retrieval scope, expansion, fallback을 결정한다.

### 6.4 Candidate Retrieval

primary tab, referenced tabs, shared working set, long-term memory에서 semantic unit 후보를 수집한다.

### 6.5 Relation Analysis

후보 semantic unit과 current focus 사이의 관계를 해석한다.

### 6.6 Evidence Promotion

약한 유사성이나 memory recall hit를 답변 근거로 승격할지 판단한다.

### 6.7 Response / Projection Planning

answer, suggest, clarify와 focus, navigate, present, notify 조합을 결정한다.

### 6.8 Current-Page Answer Generation

current-page answer generation canonical 규칙:

- SDK: `@google/genai`
- API: `models.generateContent`
- Vertex 초기화: `GOOGLE_CLOUD_PROJECT` + `GOOGLE_CLOUD_LOCATION`
- grounding input 최소 구성: `snapshot focus text + user intent text`
- config 누락 시: 명시적 오류(`MODEL_CONFIG_MISSING`) 또는 conservative fallback
- 모델 호출 자체 실패 시: 명시적 오류(`GENERATION_FAILED`) 또는 conservative fallback
- 금지: stub/placeholder answer output

---

## 7. Module Responsibilities

### 7.1 Session Gateway

- WebSocket 연결 수립
- session lifecycle 관리
- event dispatch

### 7.2 Session Store

- session state 저장
- tab context 보관
- shared working set 보관

### 7.3 Context Ingestion Pipeline

- snapshot validation
- canonical pack build
- normalized planner input 생성

### 7.4 Session RAG

- 현재 세션 내부의 초저지연 retrieval
- cross-tab relation을 반영한 제한적 확장

### 7.5 Long-term RAG

- 과거 세션과 저장된 semantic memory 검색
- recall 및 similarity retrieval 수행

### 7.6 Relation Analyzer

- supports / contradicts / elaborates / references / similar 판별
- LLM reasoner 호출
- current-page answer generation은 `@google/genai` `models.generateContent` 경로를 사용

### 7.7 Response / Projection Planner

- answer/suggest/clarify 결정
- navigation target 및 projection 조합

---

## 8. MVP Implementation Boundary

v0.1의 canonical flow는 `text-first semantic navigation`이다.

포함:
- sidepanel session model
- WebSocket transport
- semantic snapshot ingestion
- primary tab + cross-tab retrieval
- 최소 long-term memory retrieval
- relation analysis
- answer / suggest / clarify + navigation planning
- current-page answer의 Google GenAI SDK canonical 호출 경로

제외:
- 완전한 visual retrieval pipeline
- distributed session handling
- full claim graph persistence
- autonomous browsing executor

---

## 9. Companion Specs

세부 명세는 다음 문서에서 정의한다.

- [BE-SPEC-CONTEXT.md](./BE-SPEC-CONTEXT.md)
  - snapshot/context ingestion
  - normalized context model
  - relation edge model
  - builder/normalizer function signatures
- [BE-SPEC-PLANNER.md](./BE-SPEC-PLANNER.md)
  - intent router
  - retrieval planner
  - relation analysis
  - memory/evidence promotion
  - response/projection planning
- [BE-SPEC-PROTOCOL.md](./BE-SPEC-PROTOCOL.md)
  - WebSocket event contract
  - session lifecycle
  - event payload schemas
  - delivery / ack / error rules
- [BE-SPEC-MEMORY.md](./BE-SPEC-MEMORY.md)
  - long-term memory record schema
  - visual-derived summary schema
  - memory write / read policy
  - memory helper function signatures
- [BE-SPEC-INGEST.md](./BE-SPEC-INGEST.md)
  - `/api/analyze` 역할과 schema
  - `/api/ingest/memory` 역할과 schema
  - analyze/ingest lifecycle
