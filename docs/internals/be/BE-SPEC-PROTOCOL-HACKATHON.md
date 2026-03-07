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
- 단, 기존 extension 호환을 위해 `/api/evaluate`는 별도 legacy compatibility route로 유지한다.
- `/api/evaluate`는 본 문서의 protocol subset 확장 경로가 아니다.

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
- HTTP/WS principal 해석은 `Authorization: Bearer <opaque-app-token>`를 `auth_sessions.session_token_hash`로 조회하는 방식으로 동작해야 한다
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
- `visibility` 기본값은 `status-only`
- `approval-required`는 예약 값으로 남기되, 해커톤 구현의 기본 경로는 아니다
- request는 FE가 deterministic하게 처리 가능한 구조화 필드만 사용한다
- `page-entity` target은 FE가 제공하는 `url:entity-id` 기반 screenshot/detail API와 바로 연결되는 canonical target form이다

### 6.2 Result

- `context.enrich.result`는 active turn에만 귀속된다
- enrich result는 primary snapshot을 대체하지 않고 turn-local context를 보강한다
- 실패 시 turn 전체를 실패시키지 않고 fallback 경로로 진행한다

### 6.3 Turn Policy

- turn당 enrich는 최대 1회를 기본값으로 둔다
- enrich timeout 시 current-page evidence만으로 제한 답변 또는 clarify로 후퇴한다
- semantic node id와 FE entity id가 항상 동일하다고 가정하지 않는다
- 따라서 BE는 필요 시 semantic node 대신 `page-entity` target을 요청할 수 있다

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

---

## 8. Explicitly Deferred from This Protocol

다음은 full protocol 문서에 남겨두되, 해커톤 구현에서는 비적용으로 본다.

- `retrieval.result.source.kind = "cross-tab"`
- `state.patch`
- `memory.patch`
- `SessionState.sharedWorkingSet`
- multi-tab `tabContexts` 운용 의미

이 항목들은 [BE-SPEC-PROTOCOL.md](./BE-SPEC-PROTOCOL.md)와 업그레이드 문서에서 계속 관리한다.
