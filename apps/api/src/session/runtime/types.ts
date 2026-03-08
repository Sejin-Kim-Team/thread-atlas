import type { SemanticSnapshot } from "@threadatlas/shared"

type DeepPartial<T> = T extends readonly (infer Item)[]
  ? Array<DeepPartial<Item>>
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T

export interface RuntimeEnvelope {
  type: string
  timestamp: string
  payload: unknown
  requestId?: string
  sessionId?: string
  turnId?: string
}

export interface RuntimeSession {
  sessionId: string
  ownerUserId: string
  clientSessionId: string
  createdAtMs: number
  lastSeenAtMs: number
  primaryTabId: number | null
  latestSnapshotByTab: Map<number, SnapshotLike>
  activeTurnId: string | null
  activeTurn?: RuntimeActiveTurn
}

export type SnapshotLike = DeepPartial<SemanticSnapshot> & {
  visualSignals?: {
    uiSuspicious?: boolean
    anomalyScore?: number
  }
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

export interface RuntimeErrorPayload {
  code:
    | "INVALID_EVENT"
    | "INVALID_SNAPSHOT"
    | "UNAUTHORIZED"
    | "MODEL_CONFIG_MISSING"
    | "GENERATION_FAILED"
  message: string
}

export interface RuntimeActiveTurn {
  turnId: string
  intentText: string
  primaryTabId: number
  boundSnapshotCapturedAt: string
  status: "running" | "waiting-enrich" | "resumed"
  enrichApplied: boolean
  enrichRequestedAtMs: number
  enrichTimeoutAtMs: number
  latestSnapshot: SnapshotLike
  pendingEnrichRequest?: {
    requestKind: "node-screenshot" | "visible-region" | "node-detail"
    targetRef: Record<string, unknown>
  }
}
