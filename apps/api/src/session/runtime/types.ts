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
}

export interface SnapshotLike {
  page?: {
    url?: string
    kind?: "article" | "thread" | "post" | "generic"
  }
  focus?: {
    nodeId?: string
    node?: {
      id?: string
      text?: string
    }
  }
  meta?: {
    capturedAt?: string
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
  mode?: string
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
