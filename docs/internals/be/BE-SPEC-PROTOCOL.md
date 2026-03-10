# ThreadAtlas Backend Spec

## WebSocket Protocol and Session State Contract

Version: 0.1
Status: Draft
Companion:
- [BE-PRD.md](./BE-PRD.md)
- [BE-SPEC.md](./BE-SPEC.md)
- [BE-SPEC-CONTEXT.md](./BE-SPEC-CONTEXT.md)
- [BE-SPEC-PLANNER.md](./BE-SPEC-PLANNER.md)

---

## 1. Purpose

본 문서는 ThreadAtlas backend의 WebSocket session protocol을 정의한다.

이 문서가 고정하는 범위:

- session lifecycle
- client/server event envelope
- 각 이벤트의 최소 payload schema
- session state transition rule
- ack / done / error / interrupt 처리 규칙

---

## 2. Canonical Transport

v0.1 canonical evaluation path는 `WebSocket session`이다.

기본 원칙:

- sidepanel 인스턴스 1개당 backend session 1개
- 모든 user intent는 session 위에서 처리
- snapshot/context/selection update는 request가 아니라 event로 전달
- turn 결과는 stream으로 반환

---

## 3. Envelope Contract

모든 WS 메시지는 다음 envelope를 사용한다.

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

규칙:

- `type`은 이벤트 이름이다
- `requestId`는 client 발 이벤트의 추적 키다
- `sessionId`는 `session.open` 이후 모든 메시지에서 유지된다
- `turnId`는 turn-scoped 이벤트에만 포함된다
- `timestamp`는 ISO 8601 UTC string을 사용한다

---

## 4. Session Lifecycle

```text
disconnected
-> session.open
-> session.ready
-> active
-> turn running / interrupted / completed 반복
-> session.close
-> disconnected
```

### 4.1 Open

client는 `session.open`으로 session을 시작한다.

성공 시:

- server는 `session.ready`를 반환한다
- 이후 event stream이 활성화된다

### 4.2 Active

active 상태에서 client는:

- `context.update`
- `snapshot.push`
- `selection.update`
- `context.enrich.result`
- `user.intent`
- `interrupt`
- `projection.ack`

를 보낼 수 있다.

### 4.3 Close

client 또는 server는 session을 종료할 수 있다.

종료 시 규칙:

- active turn이 있으면 먼저 interrupt 또는 abort 처리
- 이후 session state를 종료 상태로 전이

---

## 5. Client -> Server Events

## 5.1 `session.open`

목적:

- sidepanel session 생성

```ts
export interface SessionOpenPayload {
  clientSessionId: string
  openedAt: string
  capabilities?: {
    liveAudio?: boolean
    liveVision?: boolean
    visualSummary?: boolean
  }
}
```

규칙:

- `clientSessionId`는 client가 생성하는 sidepanel 인스턴스 식별자다
- 동일 `clientSessionId` 재연결 정책은 v0.1에서 optional이다

## 5.2 `session.close`

목적:

- session 종료

```ts
export interface SessionClosePayload {
  reason?: "user-close" | "client-disconnect" | "shutdown"
}
```

## 5.3 `context.update`

목적:

- active tab 또는 current page context 갱신

```ts
export interface ContextUpdatePayload {
  tabId: number
  url: string
  pageKind: "article" | "thread" | "post" | "generic"
  isPrimary: boolean
  title?: string
}
```

규칙:

- `isPrimary=true`인 tab이 현재 primary tab이다
- 동일 session 내 primary tab은 한 시점에 하나만 허용한다

## 5.4 `snapshot.push`

목적:

- 특정 탭의 최신 semantic snapshot 전달

```ts
import type { ContextPack, SemanticSnapshot } from "@threadatlas/shared"

export interface SnapshotPushPayload {
  tabId: number
  snapshot: SemanticSnapshot
  providedPack?: ContextPack
}
```

규칙:

- `snapshot`은 해당 `tabId`의 최신 raw truth다
- `providedPack`은 optional hint다
- server는 snapshot 기준으로 canonical/normalized pack을 재생성할 수 있어야 한다

## 5.5 `selection.update`

목적:

- 현재 selection 또는 focus binding 갱신

```ts
export interface SelectionUpdatePayload {
  tabId: number
  selectedNodeId?: string
  selectedText?: string
}
```

## 5.6 `user.intent`

목적:

- user turn 시작

```ts
export interface UserIntentPayload {
  text: string
  primaryTabId: number
  boundSnapshotCapturedAt: string
  mode?: "voice" | "text"
}
```

규칙:

- server는 이 이벤트 수신 시 새 `turnId`를 생성할 수 있다
- `primaryTabId`와 `boundSnapshotCapturedAt`은 active turn binding의 기준이다

## 5.7 `context.enrich.result`

목적:

- server가 요청한 추가 컨텍스트를 전달

```ts
export type EnrichTargetRef =
  | {
      type: "semantic-node"
      tabId: number
      nodeId: string
    }
  | {
      type: "page-entity"
      pageUrl: string
      entityId: string
    }
  | {
      type: "region"
      tabId: number
      regionHint: "viewport" | "focus-node-region" | "selection-region"
    }

export interface ContextEnrichResultPayload {
  requestKind: "node-screenshot" | "visible-region" | "node-detail"
  targetRef: EnrichTargetRef
  imageBase64?: string
  mimeType?: "image/png" | "image/jpeg"
  detail?: {
    text?: string
    htmlSnippet?: string
    attributes?: Record<string, string>
    bounds?: {
      x: number
      y: number
      width: number
      height: number
    }
  }
  capturedAt: string
  status?: "ok" | "failed" | "unsupported"
  failureReason?: string
}
```

규칙:

- `context.enrich.result`는 현재 active turn에만 귀속된다
- `imageBase64` 또는 `detail` 중 최소 하나는 포함해야 한다
- enrich result는 primary snapshot을 대체하지 않고 보강한다
- 실패 시에는 `status`와 `failureReason`을 함께 보내는 것이 권장된다

## 5.8 `interrupt`

목적:

- 현재 진행 중 turn 중단 요청

```ts
export interface InterruptPayload {
  reason?: "barge-in" | "new-intent" | "user-stop"
}
```

규칙:

- active turn이 없으면 no-op 허용
- active turn이 있으면 server는 interruptible 상태로 전이해야 한다

## 5.9 `projection.ack`

목적:

- client가 projection delivery를 확인

```ts
export interface ProjectionAckPayload {
  projectionId: string
  status: "applied" | "ignored" | "failed"
}
```

---

## 6. Server -> Client Events

## 6.1 `session.ready`

```ts
export interface SessionReadyPayload {
  sessionId: string
  protocolVersion: 1
}
```

## 6.2 `progress`

목적:

- planner 진행 상태 스트리밍

```ts
export interface ProgressPayload {
  stage:
    | "intent-routed"
    | "retrieval-started"
    | "retrieval-completed"
    | "enrich-requested"
    | "enrich-received"
    | "relation-analysis"
    | "response-planning"
  message?: string
}
```

## 6.3 `context.enrich.request`

목적:

- server가 FE에 추가 screenshot / detail을 요청

```ts
export interface ContextEnrichRequestPayload {
  requestKind: "node-screenshot" | "visible-region" | "node-detail"
  targetRef: EnrichTargetRef
  detailFields?: Array<"text" | "htmlSnippet" | "attributes" | "bounds">
  reason:
    | "visual-clarification"
    | "node-detail-needed"
    | "ocr-needed"
    | "region-recapture"
  visibility: "hidden" | "status-only" | "approval-required"
  userMessage?: string
  approvalReason?: string
  timeoutMs?: number
}
```

규칙:

- request는 current primary tab 또는 그 page/entity를 대상으로만 보낼 수 있다
- request는 현재 active turn에만 유효하다
- 해커톤 기본값은 `visibility = "status-only"`다
- `timeoutMs`가 생략되면 backend 기본값 `5000ms`를 사용한다
- request는 FE가 deterministic하게 처리 가능한 구조화 필드만 사용해야 한다
- request 필드는 backend가 판단한 capture target 명세이며, 실제 캡처 방법은 FE가 결정한다
- FE가 처리할 수 없으면 실패 상태 또는 대응 error를 반환하는 것이 권장된다
- `targetRef.type = "page-entity"`는 FE의 `url:entity-id` 기반 lookup API를 수용하기 위한 canonical target form이다
- `targetRef.type = "region"`은 entity가 아닌 viewport/selection/focus-region recapture를 위한 target form이다

## 6.4 `retrieval.result`

목적:

- retrieval provenance와 summary 히트 전달

```ts
export interface RetrievalResultPayload {
  resultId: string
  source:
    | { kind: "primary-tab"; tabId: number }
    | { kind: "cross-tab"; tabId: number }
    | { kind: "memory"; memoryRecordId: string }
  summary: string
  score?: number
}
```

규칙:

- v0.1에서는 summary-first로 전달
- raw snapshot/body 전체를 직접 stream하지 않는다

## 6.5 `projection`

목적:

- client가 실행할 projection 전달

```ts
export interface ProjectionPayload {
  projectionId: string
  kind: "focus" | "navigate" | "present" | "notify"
  body: Record<string, unknown>
}
```

규칙:

- projection body의 세부 schema는 existing shared projection contract를 따른다
- generic semantic anchor 확장은 후속 spec 범위다
- navigation / browse 관련 projection이 있을 경우, server는 target과 open hint를 제안할 수 있다
- 실제 same-tab / new-tab / sidepanel preview 실행은 client가 결정한다

## 6.6 `state.patch`

목적:

- session state의 외부 가시 부분 패치

```ts
export interface StatePatchPayload {
  primaryTabId?: number
  activeTurnId?: string | null
  pendingClarification?: string | null
}
```

## 6.7 `memory.patch`

목적:

- memory promotion / accepted link 변화 알림

```ts
export interface MemoryPatchPayload {
  promotedFactIds?: string[]
  acceptedMemoryRecordIds?: string[]
}
```

## 6.8 `turn.done`

목적:

- turn 완료 알림

```ts
export interface TurnDonePayload {
  turnId: string
  responseMode: "answer" | "suggest" | "clarify"
  referencedTabIds: number[]
  usedMemoryRecordIds: string[]
  usedProvenanceSummary: string[]
}
```

규칙:

- 모든 turn은 `turn.done` 또는 `error` 중 하나로 종료된다
- `turn.done`은 실제 사용한 provenance를 요약해 포함해야 한다

## 6.9 `error`

목적:

- turn-level 또는 session-level 오류 전달

```ts
export interface ErrorPayload {
  code:
    | "INVALID_EVENT"
    | "INVALID_SNAPSHOT"
    | "TURN_CONFLICT"
    | "PLANNER_FAILED"
    | "MODEL_FAILED"
    | "INTERNAL_ERROR"
  message: string
  recoverable: boolean
}
```

---

## 7. Session State Contract

```ts
export interface SessionState {
  sessionId: string
  primaryTabId: number | null
  tabContexts: Record<number, TabContext>
  sharedWorkingSet: SharedWorkingSet
  turnHistory: Array<{
    turnId: string
    intentText: string
    responseMode: "answer" | "suggest" | "clarify"
    completedAt: string
  }>
  activeTurnId: string | null
  pendingClarification: string | null
  interruptedTurnId: string | null
}
```

규칙:

- `tabContexts`의 raw context는 탭별로 분리 저장한다
- `sharedWorkingSet`에는 raw snapshot을 저장하지 않는다
- `activeTurnId`는 동시에 하나만 허용한다

---

## 8. Event Sequencing Rules

### 8.1 Minimal Happy Path

```text
client  -> session.open
server  -> session.ready
client  -> context.update
client  -> snapshot.push
client  -> user.intent
server  -> progress*
server  -> retrieval.result*
server  -> projection*
server  -> turn.done
```

### 8.2 Interrupt Path

```text
client  -> user.intent
server  -> progress
client  -> interrupt
server  -> state.patch(activeTurnId=null, interruptedTurnId=...)
client  -> user.intent
server  -> progress*
server  -> turn.done
```

### 8.3 Validation Failure Path

```text
client  -> snapshot.push(invalid)
server  -> error(code="INVALID_SNAPSHOT", recoverable=true)
```

---

## 9. Delivery and Retry Rules

### 9.1 At-Most-Once Rule for Turn Completion

- 하나의 `turnId`는 정확히 한 번만 종료된다
- 종료 이벤트는 `turn.done` 또는 `error` 중 하나다

### 9.2 Projection Ack Rule

- `projection.ack`는 optional이지만 권장된다
- ack가 `failed`일 경우 server는 retry 대신 후속 planning에서 반영하는 수준으로 제한한다

### 9.3 Recoverable Error Rule

- `recoverable=true`이면 session 유지
- `recoverable=false`이면 session 종료 가능

---

## 10. HTTP Companion Endpoints

WS canonical path 외에 v0.1에서 남는 HTTP는 다음과 같다.

- `/api/token`
- `/api/analyze`
- `/api/ingest/memory`
- `/api/health`

이 문서에서는 HTTP 상세 payload를 고정하지 않는다.
다만 `/api/analyze`는 legacy thread-only endpoint가 아니라 semantic analysis / summary seed endpoint로 정의한다.
`/api/ingest/memory`는 approved memory record를 영속화하는 companion endpoint다.
