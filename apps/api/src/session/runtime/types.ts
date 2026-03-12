import type {
  ContextEnrichRequestPayload,
  ContextEnrichResultPayload,
  ContextUpdatePayload,
  EnrichRequestKind,
  RuntimeEnvelope,
  RuntimeErrorPayload,
  SessionOpenPayload,
  SnapshotLike,
  SnapshotPushPayload,
  UserIntentPayload
} from "@threadatlas/shared/runtime"

export type {
  ContextEnrichRequestPayload,
  ContextEnrichResultPayload,
  ContextUpdatePayload,
  EnrichRequestKind,
  RuntimeEnvelope,
  RuntimeErrorPayload,
  SessionOpenPayload,
  SnapshotLike,
  SnapshotPushPayload,
  UserIntentPayload
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
    requestKind: EnrichRequestKind
    targetRef: Record<string, unknown>
  }
}
