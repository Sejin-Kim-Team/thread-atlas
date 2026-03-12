import type { Projection } from "./projection"
import type { SemanticSnapshot } from "./semantic-snapshot"

type DeepPartial<T> = T extends readonly (infer Item)[]
  ? Array<DeepPartial<Item>>
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T

export type EnrichRequestKind = "node-screenshot" | "visible-region" | "node-detail"

export type SnapshotLike = DeepPartial<SemanticSnapshot> & {
  visualSignals?: {
    uiSuspicious?: boolean
    anomalyScore?: number
  }
}

export interface RuntimeEnvelope {
  type: string
  timestamp: string
  payload: unknown
  requestId: string
  sessionId?: string
  turnId?: string
}

export interface SessionOpenPayload {
  clientSessionId: string
}

export interface ContextUpdatePayload {
  tabId: number
  isPrimary?: boolean
}

export interface SnapshotPushPayload {
  tabId: number
  snapshot: SnapshotLike
}

export interface UserIntentPayload {
  text: string
  primaryTabId: number
  boundSnapshotCapturedAt: string
}

export interface ContextEnrichRequestPayload {
  requestKind: EnrichRequestKind
  targetRef: Record<string, unknown>
  reason: string
  timeoutMs: number
  visibility?: "status-only"
}

export interface ContextEnrichResultPayload {
  requestKind: EnrichRequestKind
  targetRef: Record<string, unknown>
  status: "ok" | "failed" | "unsupported"
  capturedAt: string
  detail?: Record<string, unknown>
  failureReason?: string
}

export type RuntimeErrorCode =
  | "INVALID_EVENT"
  | "INVALID_SNAPSHOT"
  | "UNAUTHORIZED"
  | "MODEL_CONFIG_MISSING"
  | "GENERATION_FAILED"

export interface RuntimeErrorPayload {
  code: RuntimeErrorCode
  message: string
}

export interface SessionReadyPayload {
  sessionId: string
  clientSessionId: string
  reused: boolean
}

export type ProgressStage =
  | "intent-routed"
  | "retrieval-started"
  | "retrieval-completed"
  | "enrich-requested"
  | "enrich-received"
  | "response-planning"

export interface ProgressPayload {
  stage: ProgressStage | string
  message?: string
}

export interface TurnDonePayload {
  referencedTabIds: number[]
  usedMemoryRecordIds?: string[]
  provenanceSummary?: string[]
}

export type ClientEnvelope =
  | (RuntimeEnvelope & {
      type: "session.open"
      payload: SessionOpenPayload
    })
  | (RuntimeEnvelope & {
      type: "context.update"
      payload: ContextUpdatePayload
    })
  | (RuntimeEnvelope & {
      type: "snapshot.push"
      payload: SnapshotPushPayload
    })
  | (RuntimeEnvelope & {
      type: "user.intent"
      payload: UserIntentPayload
    })
  | (RuntimeEnvelope & {
      type: "context.enrich.result"
      payload: ContextEnrichResultPayload
    })
  | (RuntimeEnvelope & {
      type: "interrupt"
      payload: { reason?: string }
    })

export type ServerEnvelope =
  | {
      type: "session.ready"
      timestamp: string
      sessionId: string
      requestId?: string
      payload: SessionReadyPayload
    }
  | {
      type: "progress"
      timestamp: string
      sessionId: string
      turnId: string
      requestId?: string
      payload: ProgressPayload
    }
  | {
      type: "projection"
      timestamp: string
      sessionId: string
      turnId: string
      requestId?: string
      payload: Projection
    }
  | {
      type: "context.enrich.request"
      timestamp: string
      sessionId: string
      turnId: string
      requestId?: string
      payload: ContextEnrichRequestPayload
    }
  | {
      type: "turn.done"
      timestamp: string
      sessionId: string
      turnId: string
      requestId?: string
      payload: TurnDonePayload
    }
  | {
      type: "error"
      timestamp: string
      sessionId?: string
      turnId?: string
      requestId?: string
      payload: RuntimeErrorPayload
    }
