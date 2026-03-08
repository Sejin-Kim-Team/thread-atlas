# ThreadAtlas Backend Spec

## Hackathon WebSocket Protocol Contract

Version: 0.1-hackathon
Status: Draft
Companion:
- [BE-PRD-HACKATHON.md](./BE-PRD-HACKATHON.md)
- [BE-SPEC-HACKATHON.md](./BE-SPEC-HACKATHON.md)
- [BE-SPEC-PROTOCOL.md](./BE-SPEC-PROTOCOL.md)

---

## 1. Purpose

본 문서는 해커톤 범위에서 실제 구현 대상으로 삼는 WebSocket protocol subset을 정의한다.

이 문서는 full protocol을 다시 쓰는 문서가 아니라, 다음을 고정한다.

- current-page only event subset
- turn-oriented execution 기준 payload
- enrich sub-loop에 필요한 최소 계약
- 해커톤 구현에서 무시해도 되는 full-scope protocol 요소

---

## 2. Scope Rule

해커톤 protocol의 canonical scope는 다음이다.

- single primary tab only
- current-page snapshot only
- active turn 1개만 허용
- enrich는 current primary tab / current turn 안에서만 허용
- recall은 output metadata 수준으로만 노출
- `/api/evaluate` legacy compatibility route는 FE migration 완료 전까지 별도로 유지

해커톤에서 비적용:

- cross-tab retrieval event semantics
- shared working set 외부 노출
- multi-tab state patch
- memory patch streaming

호환성 규칙:

- canonical transport는 WebSocket session이다.
- canonical endpoint는 `/ws/session`이다.
- 단, 기존 extension 호환을 위해 `/api/evaluate`는 별도 legacy compatibility route로 유지한다.
- `/api/evaluate`는 본 문서의 protocol subset 확장 경로가 아니다.

### 2.1 Canonical `/ws/session` Connection and Auth Model

연결 모델:

- FE runtime은 `wss://<api-host>/ws/session`로 연결한다.
- 해커톤 절충안으로, WebSocket 연결 수립 시 `token` query parameter로 opaque app session token을 전달한다.
- 이 token은 `/api/token`에서 발급한 값이어야 한다.
- 이 방식은 해커톤 기간의 FE/BE 연결 단순화를 위한 임시 계약이며, 장기적으로는 header 또는 subprotocol 기반 인증으로 대체할 수 있다.

인증 모델:

- 서버는 반드시 `upgrade` 단계에서 token을 `auth_sessions.session_token_hash` 조회로 검증한다.
- 검증 성공 시 principal(`local users.id`)을 connection context에 고정한다.
- 검증 실패, 만료, revoked session이면 `handleUpgrade` 이전에 연결을 거부하고 session을 생성하지 않는다.
- 동일 `(principalUserId, clientSessionId)` 재연결은 허용하되, principal이 다르면 거부한다.

오류 처리:

- 인증 실패 handshake는 `UNAUTHORIZED` 의미로 처리한다.
- 이벤트 처리 중 principal/session 불일치도 `UNAUTHORIZED`로 처리한다.

보안 하드닝 규칙:

- 서버는 `Origin` header가 존재하는 환경에서는 `upgrade` 단계에서 허용된 `Origin`만 수락해야 한다.
- Chrome extension runtime처럼 `Origin`을 안정적으로 강제하기 어려운 환경에서는, `Origin` 검증 부재만으로 연결을 거부하지 않는다.
- `/ws/session`이 아닌 path로 들어온 upgrade socket은 즉시 종료해야 한다.
- query token은 opaque app session token만 허용하며, Google identity token이나 외부 provider token을 직접 query에 싣지 않는다.
- query token은 로그에 남기지 않아야 하며, 디버그 로그에도 마스킹 없이 출력하면 안 된다.

### 2.2 WebSocket vs HTTP Event Ingress Role

- `/ws/session`:
  - FE와 실제 런타임이 사용하는 canonical transport 경로
  - server push(`progress`, `projection`, `turn.done`)를 지원하는 경로
- `/ws/session/events`:
  - 테스트/디버그용 HTTP ingress adapter
  - canonical transport가 아니다
  - FE 실서비스 경로로 사용하지 않는다

동등성 원칙:

- 두 경로는 동일 runtime manager/event semantics를 재사용해야 한다.
- 즉 transport만 다르고, 이벤트 계약/검증/오류 규약은 같아야 한다.

---

## 3. Envelope

모든 메시지는 full protocol의 envelope을 그대로 사용한다.

```ts
export interface WsEnvelope<TType extends string, TPayload> {
  type: TType
  requestId?: string
  sessionId?: string
  turnId?: string
  timestamp: string
  payload: TPayload
}
```

---

## 4. Required Event Set

### 4.1 Client -> Server

필수:

- `session.open`
- `context.update`
- `snapshot.push`
- `user.intent`
- `interrupt`

선택:

- `context.enrich.result`
- `projection.ack`
- `session.close`

### 4.2 Server -> Client

필수:

- `session.ready`
- `progress`
- `projection`
- `turn.done`
- `error`

선택:

- `context.enrich.request`
- `retrieval.result`

---

## 5. Current-Page Rules

### 5.0 User Principal

- session ownership과 memory ownership의 기준은 authenticated user principal이다
- canonical identity chain은 `dev-bootstrap subject 또는 google identity -> /api/token -> opaque app session token -> auth_sessions 조회 -> local users.id principal`이다
- 해커톤 구현의 canonical user identity는 token claim이 아니라 local `users.id` principal이다
- 같은 principal만 자신의 long-term memory record를 조회하고 저장할 수 있다
- `/api/token` 응답은 `token`, `expiresAt(epoch seconds number)`, `user`를 반환한다
- FE legacy 호출 호환을 위해 해커톤 기간에는 `{ userId }` 입력을 임시 허용한다
- HTTP principal 해석은 `Authorization: Bearer <opaque-app-token>`를 `auth_sessions.session_token_hash`로 조회하는 방식으로 동작해야 한다
- WebSocket principal 해석은 `/ws/session?token=<opaque-app-token>`를 `auth_sessions.session_token_hash`로 조회하는 방식으로 동작해야 한다
- token 검증 실패, revoked/expired session, 또는 principal 불일치 시 WS 연결과 HTTP companion 요청은 `UNAUTHORIZED`로 거부한다

### 5.0.1 Session Reuse Guard

- WS session ownership key는 `(principalUserId, clientSessionId)`다
- 기존 session이 같은 `clientSessionId`로 존재해도 principal이 다르면 session 재사용을 허용하지 않는다
- 이 경우 서버는 반드시 `401 UNAUTHORIZED`를 반환하고 새 session을 암묵적으로 생성하지 않는다

### 5.1 Primary Tab

- 한 session 안에서 primary tab은 항상 1개다
- `user.intent.primaryTabId`는 항상 현재 primary tab과 일치해야 한다
- current-page reasoning은 이 primary tab의 latest snapshot만 기준으로 한다

### 5.2 Snapshot Binding

- `snapshot.push`는 항상 primary tab의 latest snapshot을 갱신한다
- `user.intent.boundSnapshotCapturedAt`은 실제 latest snapshot과 검증 가능해야 한다
- mismatch, malformed snapshot, binding failure는 모두 `INVALID_SNAPSHOT`으로 반환한다
- `INVALID_SNAPSHOT`는 항상 recoverable error로 취급한다

### 5.3 Turn Binding

- active turn은 동시에 1개만 허용한다
- 새 `user.intent`가 오면 기존 active turn을 먼저 `interrupt` 처리하고 새 turn을 시작한다
- `TURN_CONFLICT`는 정상 경로가 아니라 내부 보호용 예외 케이스에서만 사용한다

---

## 6. Enrich Subset

### 6.1 Request

해커톤에서는 full protocol의 `ContextEnrichRequestPayload`를 그대로 사용하되, 다음 제약을 둔다.

- `targetRef`는 아래 3종만 허용한다
  - current primary tab의 semantic node
  - current page의 `url:entity-id`
  - current primary tab의 region
- `requestKind`는 `node-screenshot | visible-region | node-detail` 3종만 허용한다.
- `page-entity`는 `requestKind`가 아니라 `targetRef.kind`로만 표현한다.
- `visibility` 기본값은 `status-only`
- `approval-required`는 예약 값으로 남기되, 해커톤 구현의 기본 경로는 아니다
- request는 FE가 deterministic하게 처리 가능한 구조화 필드만 사용한다
- `page-entity` target은 FE가 제공하는 `url:entity-id` 기반 screenshot/detail API와 바로 연결되는 canonical target form이다

### 6.2 Result

- `context.enrich.result`는 active turn에만 귀속된다
- enrich result는 primary snapshot을 대체하지 않고 turn-local context를 보강한다
- 수용 전 runtime 유효성 검증을 수행해야 한다
  - active turn 상태가 `waiting-enrich`여야 한다
  - active turn에 pending enrich request가 존재해야 한다
  - `context.enrich.result.payload.requestKind`/`targetRef`는 pending request와 정확히 일치해야 한다
- pending request 부재 또는 `requestKind`/`targetRef` 불일치 result는 invalid로 폐기하고 병합하지 않는다
- enrich detail payload는 untrusted current-page evidence로 취급한다
- prompt 구성에는 정규화된 허용 필드만 사용하고, 자유형 detail 원문 문자열 직접 삽입을 금지한다
- 실패 시 turn 전체를 실패시키지 않고 fallback 경로로 진행한다

### 6.3 Turn Policy

- turn당 enrich는 최대 1회를 기본값으로 둔다
- enrich timeout 시 current-page evidence만으로 제한 답변 또는 clarify로 후퇴한다
- semantic node id와 FE entity id가 항상 동일하다고 가정하지 않는다
- 따라서 BE는 필요 시 semantic node 대신 `page-entity` target을 요청할 수 있다
- `timeoutMs`가 request payload에 없으면 기본값 `3000ms`를 사용한다
- timeout 타이머는 enrich request emit 시 arm 해야 한다
- timeout 타이머 해제는 runtime 유효성 검증 성공 이후에만 허용한다
- invalid `context.enrich.result`는 타이머를 해제하거나 fallback 경로를 건너뛰게 만들면 안 된다
- `context.enrich.result.status = "ok"`일 때만 turn-local context에 적용한다
- `context.enrich.result.status = "failed" | "unsupported"`이면 enrich 결과 적용 없이 fallback 경로로 진행한다
- fallback은 `progress(stage="response-planning") -> projection(answer|status-note) -> turn.done` 순서를 유지해야 한다

### 6.4 Enrich Trigger Decision Policy

- enrich trigger mode는 정확히 `rule | hybrid-simple | hybrid-complex` 3개만 허용한다.
- trigger mode는 backend runtime policy이며 client event payload로 입력받지 않는다.
- 즉 `context.enrich.request`/`context.enrich.result` wire schema는 본 변경으로 확장하지 않는다.
- trigger mode가 미설정이거나 허용 집합 밖이면 배포/부팅 단계에서 fail-fast 해야 하며 runtime 기본값으로 묵살하면 안 된다.

mode semantics:

- `rule`
  - 규칙 사전만 사용해 enrich/no-enrich와 target class를 결정한다.
  - LLM assist를 호출하지 않는다.
- `hybrid-simple`
  - 규칙 매칭 성공 시 즉시 enrich를 요청한다.
  - 규칙 매칭 실패 시 즉시 LLM assist를 호출한다.
- `hybrid-complex`
  - 규칙 사전으로 `명확한 enrich`/`명확한 no-enrich`를 먼저 판정한다.
  - 판정이 애매하거나 `SemanticSnapshot`이 suspicious이면 LLM assist를 호출한다.

규칙 사전 요구사항:

- 규칙 사전은 한국어+영어 키워드를 모두 포함해야 한다.
- intent category 단위로 한국어/영어 매칭 규칙이 모두 있어야 유효하다.

---

## 7. Output Rules

### 7.1 progress

해커톤에서 허용하는 `stage` 값:

- `intent-routed`
- `retrieval-started`
- `retrieval-completed`
- `enrich-requested`
- `enrich-received`
- `response-planning`

### 7.2 projection

- 해커톤에서 projection은 현재 페이지 설명 결과를 FE에 전달하는 최소 채널로 사용한다
- 해커톤에서는 아래 body union subset을 사용한다

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
- `recall-card`는 current-page answer 이후에만 붙을 수 있는 제한적 recall 결과 전달용이다
- retrieval no-hit 또는 low-confidence면 `recall-card`를 emit하지 않는다
- `recall-card`는 `navigation.canonicalUrl`, `navigation.nodeAnchor`, `navigation.openMode`를 passthrough 해야 한다
- `status-note`는 FE가 보조 상태/메시지를 렌더링할 수 있게 하는 최소 payload다
- 해커톤 구현에서는 projection body를 이 union subset으로 제한한다

### 7.3 turn.done

- `usedMemoryRecordIds`는 optional recall이 실제 사용된 경우 반드시 채워진다
- `referencedTabIds`는 해커톤 기준 현재 primary tab 1개만 포함하는 것을 기본값으로 둔다

### 7.4 error

해커톤 protocol subset에서 `error.payload.code`는 최소 다음 값을 지원해야 한다.

- `INVALID_EVENT`
- `INVALID_SNAPSHOT`
- `UNAUTHORIZED`
- `MODEL_CONFIG_MISSING`
- `GENERATION_FAILED`

규칙:

- `MODEL_CONFIG_MISSING`은 generation 설정(`GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`) 누락일 때만 사용한다
- `GENERATION_FAILED`는 설정은 유효하지만 모델 호출/응답 처리 자체가 실패한 경우에 사용한다
- invalid enrich result(`waiting-enrich` 아님, pending request 없음, `requestKind`/`targetRef` 바인딩 불일치)는 `INVALID_EVENT`로 처리해야 한다
- WebSocket 경로에서는 `error(code="INVALID_EVENT")`를 emit하고 turn을 `waiting-enrich` 상태로 유지한다
- `/ws/session/events` adapter에서도 동일 케이스를 `400 BAD_REQUEST` + `INVALID_EVENT`로 정렬한다

---

## 8. Explicitly Deferred from This Protocol

다음은 full protocol 문서에 남겨두되, 해커톤 구현에서는 비적용으로 본다.

- `retrieval.result.source.kind = "cross-tab"`
- `state.patch`
- `memory.patch`
- `SessionState.sharedWorkingSet`
- multi-tab `tabContexts` 운용 의미

이 항목들은 [BE-SPEC-PROTOCOL.md](./BE-SPEC-PROTOCOL.md)와 업그레이드 문서에서 계속 관리한다.

---

## 9. Done Criteria for Real WebSocket Transport

해커톤 범위에서 `Real WebSocket Transport` 완료로 판정하려면 다음을 충족해야 한다.

- `/ws/session`에서 token handshake 인증이 실제로 동작한다.
- `session.open -> context.update -> snapshot.push -> user.intent` 흐름을 WebSocket 경로로 처리한다.
- `session.ready`, `progress`, `projection`, `turn.done`, `error`를 server push로 전달한다.
- session reuse guard(`(principalUserId, clientSessionId)`)를 WebSocket 경로에서도 동일하게 강제한다.
- `/ws/session/events`는 테스트/디버그 adapter로 유지하되 canonical이 아님을 문서와 구현에서 일치시킨다.

### 9.1 Minimum TDD Contracts

`Real WebSocket Transport` 착수 시 최소 TDD 계약은 다음 5개로 고정한다.

1. handshake 인증 계약
   - 유효 token 연결 성공, 무효/만료/revoked token은 `upgrade` 단계에서 연결 거부(`UNAUTHORIZED`)
2. canonical 이벤트 왕복 계약
   - `session.open -> context.update -> snapshot.push -> user.intent` 처리 후 `progress/projection/turn.done` 수신
3. session reuse guard 계약
   - 동일 `clientSessionId` + 다른 principal 연결 거부
4. snapshot binding 오류 계약
   - bound snapshot mismatch 시 `INVALID_SNAPSHOT` 유지
5. adapter 동등성 계약
   - `/ws/session`과 `/ws/session/events`가 같은 입력에 대해 동일 오류코드/핵심 payload 의미를 유지
6. upgrade hardening 계약
   - 비대상 path upgrade socket은 연결 전에 종료
   - `Origin` header가 존재하는 경우에만 allowlist 검증을 적용
