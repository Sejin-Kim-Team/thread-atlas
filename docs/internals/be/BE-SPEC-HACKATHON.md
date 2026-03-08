# ThreadAtlas Backend Spec

## Hackathon Delivery Spec

Version: 0.1-hackathon
Status: Draft
Companion:
- [BE-PRD-HACKATHON.md](./BE-PRD-HACKATHON.md)
- [BE-SPEC-AUTH-HACKATHON.md](./BE-SPEC-AUTH-HACKATHON.md)
- [BE-SPEC-IMPLEMENTATION-RULES.md](./BE-SPEC-IMPLEMENTATION-RULES.md)
- [BE-SPEC-INFRA.md](./BE-SPEC-INFRA.md)
- [BE-SPEC-RAG-HACKATHON.md](./BE-SPEC-RAG-HACKATHON.md)
- [BE-SPEC-PROTOCOL-HACKATHON.md](./BE-SPEC-PROTOCOL-HACKATHON.md)
- [BE-SPEC-UPGRADE.md](./BE-SPEC-UPGRADE.md)

---

## 1. Purpose

본 문서는 2026-03-16 해커톤 제출까지 구현할 backend의 최소 spec을 정의한다.

이 문서가 고정하는 범위:

- current-page 중심 session model
- turn orchestration model
- 최소 WebSocket event flow
- current-page retrieval policy
- on-demand enrich request policy
- visual explanation 범위
- 제한적 과거 회상 범위
- 해커톤 RAG 저장/검색 최소 스키마

추가 제출 조건:

- Gemini 계열 모델 연동은 최종적으로 `Google GenAI SDK` 또는 `ADK`를 사용해야 한다.
- current-page answer generation canonical path는 `@google/genai` 기반 `models.generateContent`로 고정한다.

---

## 2. Canonical Scope

해커톤 spec의 canonical scope는 다음이다.

- `WebSocket session` 유지
- `SemanticSnapshot` input 유지
- `single-primary-tab` 중심 turn 동작
- current-page retrieval 중심
- current-page scoped enrich request 지원
- selected-scenario visual explanation 지원
- 제한적 long-term memory recall
- `@google/genai` + Vertex 기반 current-page answer generation
- `/api/evaluate` legacy compatibility route 유지 (FE migration 완료 전까지)
- 운영 엔드포인트 `/health`(liveness), `/ready`(DB readiness) 유지
- 로컬 direct DB 연결과 Cloud Run용 Cloud SQL Connector 프로파일을 함께 유지

제외:

- cross-tab retrieval orchestration
- multi-tab workspace state
- complex memory-link acceptance flow

주의:

- canonical path는 WebSocket session이다.
- canonical endpoint는 `/ws/session`이다.
- 다만 FE migration이 완료되기 전까지 `/api/evaluate`는 legacy compatibility route로 유지한다.
- `/api/evaluate`는 신규 기능 추가 대상이 아니라, 기존 extension 호출 호환 목적의 유지 경로다.

해커톤 구현 중 코드 구조와 주석 작성은
[BE-SPEC-IMPLEMENTATION-RULES.md](./BE-SPEC-IMPLEMENTATION-RULES.md)를 필수 계약으로 따른다.

### 2.1 현재 구현 브랜치(`feature/be-enrich-subloop`) 범위 고정

본 문서의 해커톤 전체 목표와 별개로, 현재 구현 브랜치의 고정 범위는 아래로 제한한다.

- evidence gap detection
- `context.enrich.request` 생성
- turn 상태 전이(`running -> waiting-enrich -> resumed`)와 완료 표현(`turn.done + activeTurn clear`)
- `context.enrich.result` 병합
- timeout/failed/unsupported fallback
- `/ws/session` canonical flow 내 enrich 연계

현재 브랜치 비범위:

- multi-tab retrieval orchestration
- full production prompt tuning
- Google OAuth verify
- Live API integration

따라서 4장 이후의 WS/event/turn 내용은 `해커톤 최종 목표 계약`이며, 본 브랜치의 완료 판정 기준은 [BE-SPEC-RAG-HACKATHON.md](./BE-SPEC-RAG-HACKATHON.md)의 브랜치 완료 조건을 따른다.

### 2.4 Real WebSocket Transport Scope Clarification

해커톤 다음 구현 범위에서 transport는 아래로 고정한다.

- canonical runtime transport: `/ws/session` (WebSocket)
- test/debug adapter: `/ws/session/events` (HTTP)
- 해커톤 절충안으로 인증 전달은 `?token=<opaque-app-session-token>` query를 사용하되, 검증은 반드시 `upgrade` 단계에서 완료해야 한다.
- `/ws/session` 이외의 upgrade path는 연결 전에 종료해야 한다.
- `Origin` 검증은 header가 안정적으로 제공되는 환경에서는 적용하되, Chrome extension runtime처럼 강제하기 어려운 환경에서는 release-blocking 필수 조건으로 두지 않는다.

역할 차이:

- `/ws/session`은 FE runtime이 실제로 사용하는 경로다.
- `/ws/session/events`는 테스트/디버그 ingress이며 canonical이 아니다.
- 두 경로는 동일 runtime manager/event semantics를 재사용해야 한다.

### 2.2 RAG Embedding Canonical Path

해커톤 RAG의 embedding path는 아래로 고정한다.

- provider: `Vertex AI`
- model: `gemini-embedding-001`
- output dimensionality: `768`
- required env: `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`
- auth path: 로컬 `ADC`, 배포 `Cloud Run service account`

금지 규칙:

- deterministic pseudo embedding을 최종 구현으로 사용하지 않는다
- provider failure 시 placeholder/pseudo vector로 대체하지 않는다

ingest/retrieval 공통 규칙:

- ingest는 실제 provider embedding을 저장해야 한다
- retrieval은 실제 provider query embedding을 사용해야 한다

### 2.3 Current-Page Answer Generation Canonical Path

해커톤 current-page answer generation path는 아래로 고정한다.

- SDK: `@google/genai`
- 호출 API: `models.generateContent`
- 실행 백엔드: `Vertex AI`
- 필수 env: `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`

초기화 규칙:

- Vertex 초기화는 `project + location` 기반으로만 수행한다
- 로컬은 ADC, 배포는 Cloud Run service account를 사용한다

grounding input 최소 규칙:

- `SemanticSnapshot`의 `focus text`
- 현재 turn의 `user intent text`
- optional: current-page retrieval evidence summary

오류/폴백 규칙:

- `GOOGLE_CLOUD_PROJECT` 또는 `GOOGLE_CLOUD_LOCATION` 누락 시 `MODEL_CONFIG_MISSING` 오류를 명시적으로 반환해야 한다
- 모델 호출 자체 실패(네트워크/응답 파싱/empty response 포함)는 `GENERATION_FAILED` 오류를 명시적으로 반환해야 한다
- optional fallback 모드에서는 `clarify` 또는 근거 제한 `answer`를 반환할 수 있다
- fallback 응답은 retrieval evidence에만 기반해야 하며, 모델 생성 문장처럼 가장하면 안 된다

금지 규칙:

- placeholder/stub answer text를 사용자 응답으로 반환하지 않는다
- 모델 호출 실패 시 fabricated answer를 반환하지 않는다

### 2.5 Database Connection Canonical Rule

해커톤 DB 연결 규칙은 아래로 고정한다.

- 로컬 개발/테스트 canonical path:
  - `DB_CONNECTION_MODE=database-url`
  - `DATABASE_URL`
- Cloud Run 배포 canonical path:
  - `DB_CONNECTION_MODE=cloudsql-connector`
  - `@google-cloud/cloud-sql-connector`

부트 규칙:

- `database-url` 모드에서 `DATABASE_URL`이 없으면 `BOOT_CONFIG_ERROR`
- `cloudsql-connector` 모드에서 필수 env(`CLOUD_SQL_INSTANCE_CONNECTION_NAME`, `DB_NAME`, `DB_USER`)가 없으면 `BOOT_CONFIG_ERROR`

---

## 3. Runtime Model

### 3.1 Session Ownership

- transport 단위는 여전히 sidepanel session이다
- 하지만 sidepanel 내부의 local workspace memory와 페이지 이동간 semantic graph의 1차 소유권은 FE에 있다
- backend session은 FE workspace를 대상으로 한 reasoning/execution channel로 본다
- session 내부에서 실질적 reasoning scope는 `현재 primary tab 1개`로 제한한다
- backend의 canonical WS session ownership key는 `(principalUserId, clientSessionId)`다
- 동일 `clientSessionId`라도 `principalUserId`가 다르면 기존 session 재사용을 허용하지 않고 `401 UNAUTHORIZED`로 거부한다

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

명시적으로 FE가 1차 보관하는 상태:

- page transition history
- local semantic graph
- local selected-node continuity

### 3.3 Turn State

해커톤 구현의 실제 중심 상태는 `activeTurn`이다.

최소 turn 상태:

- `turnId`
- `intentText`
- `boundSnapshotCapturedAt`
- `status`
- `normalizedContext`
- `retrievalSummary`
- `enrichRequest?`
- `enrichResult?`
- `memoryHints`

상태 전이:

- `running`
- `waiting-enrich`
- `resumed`
- `failed`

완료 표현:

- 해커톤 런타임에서 turn 완료는 `status=completed`를 별도 저장하지 않는다.
- 완료는 `turn.done` 이벤트 발행 후 `activeTurn` 제거(`clearActiveTurn`)로 표현한다.

### 3.4 Non-Required State

해커톤 범위에서 필수 아님:

- referenced tab contexts
- shared working set
- cross-tab relation graph
- reconnect recovery buffer

### 3.5 Identity and Ownership

- session ownership과 memory ownership의 기준은 session cache가 아니라 authenticated user principal이다
- WebSocket session과 HTTP companion endpoint는 동일한 auth principal을 사용해야 한다
- 해커톤 canonical identity chain은 `dev-bootstrap subject 또는 google identity -> /api/token -> opaque app session token -> auth_sessions 조회 -> local users.id principal`이다
- 해커톤 구현의 canonical user identity는 token claim이 아니라 local `users.id` principal이다
- long-term memory record는 모두 해당 principal에 귀속된다
- `/api/token` 응답은 최소 `token`, `expiresAt(epoch seconds number)`, `user.id`를 반환한다
- FE legacy 호출 호환을 위해 해커톤 기간에는 `{ userId }` 입력을 임시 허용한다
- HTTP principal 해석은 `Authorization: Bearer <opaque-app-token>`를 `auth_sessions.session_token_hash`로 조회하는 방식으로 동작해야 한다
- WebSocket principal 해석은 `/ws/session?token=<opaque-app-token>`를 `auth_sessions.session_token_hash`로 조회하는 방식으로 동작해야 한다
- token 검증 실패, revoked/expired session, 또는 session owner principal 불일치 시 `401 UNAUTHORIZED`를 반환한다

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
- `context.enrich.result`

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
- `context.enrich.request`

### 4.5 WebSocket Connection/Auth Contract

- FE는 `/ws/session` 연결 시 `token` query parameter로 opaque app session token을 전달한다.
- 서버는 handshake 단계에서 token을 `auth_sessions.session_token_hash` 조회로 검증한다.
- 검증 실패/만료/revoked session은 `UNAUTHORIZED`로 거부하고 session을 생성하지 않는다.
- principal이 다른 `clientSessionId` 재사용은 허용하지 않는다.
- 이벤트 처리 중 principal/session 불일치도 `UNAUTHORIZED`로 처리한다.

### 4.6 Real WebSocket Transport Done Criteria

해커톤 범위에서 real WebSocket transport 완료 조건:

- `/ws/session` handshake 인증이 실제로 동작한다.
- `session.open -> context.update -> snapshot.push -> user.intent` 흐름이 WebSocket 경로에서 동작한다.
- `session.ready/progress/projection/turn.done/error`를 push 전달한다.
- session reuse guard를 WebSocket 경로에도 동일하게 강제한다.
- `/ws/session/events`는 canonical path가 아닌 테스트/디버그 adapter로 문서/구현이 일치한다.

---

## 5. Input Policy

### 5.1 SemanticSnapshot

- canonical input truth
- 반드시 required
- FE local workspace memory에서 파생된 최신 snapshot을 기준으로 한다
- 타입 계약은 `@threadatlas/shared`의 `SemanticSnapshot`을 그대로 사용한다
- BE에서 입력 계약을 축약/재정의하지 않는다

### 5.2 ContextPack

- optional input
- FE가 보내면 수용 가능
- backend는 snapshot 기준으로 canonical pack을 재구성 가능해야 함
- 타입 계약은 `@threadatlas/shared`의 `ContextPack`을 그대로 사용한다

### 5.3 Planner Input

planner는 raw snapshot이나 FE pack 대신 `NormalizedContextPack`을 사용한다.
- `NormalizedContextPack`은 planner/reasoner용 BE 내부 모델이며 shared 입력 계약이 아니다.
- 이번 정렬 작업은 shared 승격이 아니라 BE 구현이 기존 shared 입력 계약에 맞추는 작업이다.

---

## 6. Execution Flow

```text
session.open
-> context.update
-> snapshot.push
-> user.intent
-> normalize
-> current-page retrieval
-> initial reasoning
-> optional enrich request / result
-> current-page answer generation (`@google/genai` `models.generateContent`)
-> optional recall metadata attach
-> turn.done
```

### 6.1 Current-Page Retrieval

retrieval 기본 규칙:

1. 현재 focus unit
2. 현재 페이지의 nearby semantic units
3. 현재 페이지의 local evidence candidates
4. optional memory recall candidates

### 6.2 Evidence Gap Detection

backend는 1차 retrieval / reasoning 결과만으로 충분하지 않을 때 evidence gap을 감지해야 한다.

대표 gap:

- visual 질문인데 이미지 근거 부족
- node 설명 질문인데 detail 부족
- OCR/visible-region 정보 부족

### 6.3 On-Demand Enrichment

backend는 current-page reasoning 중 필요한 경우 FE에 추가 컨텍스트를 요청할 수 있다.

허용 요청 종류:

- semantic node screenshot
- visible region recapture
- semantic node detail
- `context.enrich.request.payload.requestKind`는 `node-screenshot | visible-region | node-detail` 3종만 허용한다.
- `page-entity`는 requestKind가 아니라 `targetRef.kind`로만 표현한다.

결정 책임:

- backend는 `SemanticSnapshot`, normalized context, 현재 turn intent를 바탕으로 어떤 enrich가 필요한지 결정한다
- enrich trigger mode는 정확히 다음 3개만 허용한다: `rule`, `hybrid-simple`, `hybrid-complex`
  - `rule`: 규칙 사전만 사용해 enrich/no-enrich와 요청 대상을 결정한다. LLM assist를 호출하지 않는다.
  - `hybrid-simple`: 규칙 사전에 매칭되면 즉시 enrich를 요청하고, 매칭되지 않으면 즉시 LLM assist를 호출한다.
  - `hybrid-complex`: 규칙 사전으로 `명확한 enrich` 또는 `명확한 no-enrich`를 먼저 판정한다. 판정이 애매하거나 `SemanticSnapshot`이 suspicious이면 LLM assist를 호출한다.
- FE는 enrich request를 실행 가능한 캡처/상세조회 동작으로 해석하고 수행한다

규칙 사전 계약:

- 규칙 사전은 한국어+영어를 모두 포함해야 한다.
- 같은 intent category(예: screenshot/detail/region recapture)에 대해 한국어 키워드 집합과 영어 키워드 집합이 모두 정의되어야 한다.
- 한 언어만 정의된 규칙은 유효 규칙으로 간주하지 않는다.
- `rule`/`hybrid-simple`/`hybrid-complex` 모두 동일 규칙 사전을 입력으로 사용한다.
- `ENRICH_TRIGGER_MODE`가 미설정이면 `hybrid-complex`를 기본값으로 사용한다.
- `ENRICH_TRIGGER_MODE`가 허용 집합 밖이면 부팅 단계에서 fail-fast 해야 한다.

`SemanticSnapshot suspicious` 최소 판단 기준:

- snapshot schema validation은 통과했지만 evidence 품질 경고가 있는 상태다.
- 예: focus text 근거 부족/누락, node anchor 대응 불일치, visual 질문 대비 region/OCR 근거 부족.
- `hybrid-complex`에서는 위와 같은 suspicious 상태를 감지하면 LLM assist 경로를 우선 적용한다.

기본 UX 정책:

- 해커톤 기본값은 `status-only`
- enrich는 사용자 승인 없이 자동 진행한다
- 다만 protocol은 향후 `approval-required`로 확장 가능하게 유지한다

규칙:

- enrich request는 current primary tab에만 한정한다
- enrich request는 현재 turn 안에서만 유효하다
- enrich result는 `snapshot.push`를 대체하지 않고 보강한다
- `context.enrich.result`를 수용하려면 active turn의 pending enrich request와 `requestKind`/`targetRef` 바인딩이 모두 일치해야 한다
- pending enrich request 부재 또는 바인딩 불일치 result는 invalid로 폐기하며 turn-local context에 병합하지 않는다
- enrich request는 자연어 prompt가 아니라 구조화된 capture/detail 지시여야 한다
- enrich request는 “무엇을 더 봐야 하는가”를 표현하고, “어떻게 캡처할 것인가”는 FE가 결정한다
- enrich detail은 untrusted current-page evidence로 취급하며, prompt에는 정규화된 허용 필드만 사용한다
- enrich detail의 자유형 원문 문자열을 prompt에 직접 삽입하면 안 된다
- enrich가 실패해도 backend는 graceful fallback을 해야 한다

### 6.4 Response Families

필수 지원:

- `explain`
- `summarize`
- `clarify`
- `local-compare`

선택 지원:

- `memory-hint`
- `past-similar-case`

### 6.5 Hackathon Projection Body

해커톤 구현에서는 projection body를 열린 `Record<string, unknown>`로 두지 않고 다음 union subset으로 고정한다.

```ts
export type HackathonProjectionBody =
  | {
      type: "answer"
      text: string
      responseMode: "answer" | "suggest" | "clarify"
      provenanceSummary: string[]
    }
  | {
      type: "recall-card"
      summary: string
      navigation: {
        canonicalUrl: string
        pageTitle?: string
        nodeAnchor?: {
          commentId?: string
          headingText?: string
          textQuote?: string
        }
        openMode?: "same-tab" | "new-tab" | "sidepanel-preview"
      }
    }
  | {
      type: "status-note"
      text: string
    }
```

규칙:

- `answer`는 current-page grounded answer 전달용이다
- `recall-card`는 current-page answer 이후에만 붙을 수 있는 제한적 과거 회상 카드 전달용이다
- `status-note`는 FE가 보조 상태/메시지를 렌더링할 수 있게 하는 최소 payload다
- 해커톤 current-page 구현에서는 이 union 외 body type을 사용하지 않는다
- `answer.text`는 `models.generateContent` 결과 또는 conservative fallback 규칙 결과여야 한다
- placeholder/stub 문자열은 유효한 `answer.text`로 간주하지 않는다

### 6.6 Turn State Machine

turn 상태 머신:

```text
running
-> waiting-enrich
-> resumed
-> turn.done emit
-> activeTurn clear
```

fallback 경로:

- enrich timeout -> `running` 복귀 후 제한 답변
- enrich failed -> `clarify` 또는 낮은 confidence answer

규칙:

- 해커톤에서는 turn당 enrich 1회만 허용하는 것을 기본값으로 둔다
- enrich 실패가 turn 전체 실패가 되어서는 안 된다
- enrich timeout 해제는 runtime 유효성 검증 성공 이후에만 가능하다
- runtime 유효성 검증은 active turn 존재, pending enrich request 존재, `requestKind`/`targetRef` 바인딩 일치 검증을 포함한다
- invalid `context.enrich.result`는 timeout fallback 타이머를 해제하거나 무력화하면 안 된다

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
- recall 결과는 `recall-card` projection으로만 노출한다
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

### 8.5 Deferred

- aggressive memory-link acceptance
- recall/comparison 중심 multi-step orchestration
- memory-only answer planning

### 8.6 Recall Runtime Bridge Rules (`feature/be-recall-runtime`)

이번 브랜치에서 고정하는 runtime 규칙:

- `recall-card`는 current-page answer 생성 이후에만 추가 projection으로 붙일 수 있다.
- recall은 primary answer를 대체할 수 없고, answer precedence를 항상 유지해야 한다.
- retrieval hit가 없거나 low-confidence면 `recall-card`를 생성하지 않는다.
- `turn.done`에는 실제로 recall에 사용된 `usedMemoryRecordIds`를 기록해야 한다.
- `recall-card.navigation`에는 `canonicalUrl`, `nodeAnchor`, `openMode`를 그대로 passthrough 해야 한다.
- recall 후보는 항상 owner-scoped memory로만 조회한다.

비범위:

- FE 렌더링/레이아웃/클릭 UX 확정
- `openMode` 실제 실행 정책 결정

---

## 9. Planner Simplification

해커톤 버전 planner는 다음처럼 단순화한다.

- intent routing은 유지
- retrieval은 current-page first로 고정
- turn orchestrator가 enrich/recall/fallback 순서를 제어한다
- cross-tab planning은 제거
- evidence promotion은 conservative
- memory는 conservative recall layer로 사용 가능

---

## 10. Recommended Module Structure

해커톤 구현은 다음 모듈 구조를 권장한다.

- `session-gateway`
  - WS 연결, event dispatch
- `turn-orchestrator`
  - active turn 생성, state transition, timeout/fallback
- `context-normalizer`
  - snapshot validation, canonical pack build, normalized context 생성
- `current-page-retriever`
  - focus / nearby / local evidence retrieval
- `evidence-gap-detector`
  - enrich 필요 여부 판단
- `enrich-planner`
  - `context.enrich.request` 생성
- `enriched-context-merger`
  - enrich result 병합
- `reasoner`
  - `@google/genai` `models.generateContent` 기반 explanation / summary / visual interpretation
- `memory-recall`
  - optional past similar case 조회
- `response-planner`
  - progress / projection / turn.done / error 생성

---

## 11. Infra Binding

해커톤 구현은 [BE-SPEC-INFRA.md](./BE-SPEC-INFRA.md)의 최소 GCP 스택을 따른다.

즉:

- `Cloud Run`
- `Cloud SQL + pgvector`
- `Vertex AI`
- `Secret Manager`

추가 고정:

- embedding canonical path는 [BE-SPEC-RAG-HACKATHON.md](./BE-SPEC-RAG-HACKATHON.md)의 `3.3 Embedding Provider Rule`을 따른다

---

## 12. Upgrade Boundary

다음 항목은 해커톤 이후 spec으로 미룬다.

- multi-tab session state
- cross-tab retrieval
- `CrossTabEdge`
- richer `memory-link` policy
- visual recall generalization

자세한 업그레이드 목표는 [BE-SPEC-UPGRADE.md](./BE-SPEC-UPGRADE.md)를 따른다.
