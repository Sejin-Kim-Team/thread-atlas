import type { AuthClient } from "./auth-client"
import type {
  ContextEnrichResultPayload,
  RuntimeEnvelope,
  RuntimeErrorPayload,
  ServerEnvelope
} from "@threadatlas/shared/runtime"
import type { ConversationIntentInput, ConversationTransport, ConversationTransportHandlers } from "./conversation-transport"

interface WebSocketLike {
  readyState: number
  onopen: ((event: Event) => void) | null
  onmessage: ((event: MessageEvent<string>) => void) | null
  onerror: ((event: Event) => void) | null
  onclose: ((event: CloseEvent) => void) | null
  send(data: string): void
  close(code?: number, reason?: string): void
}

type WebSocketFactory = (url: string) => WebSocketLike
type TokenIssuer = Pick<AuthClient, "issueToken">

function makeTimestamp(): string {
  return new Date().toISOString()
}

function makeRequestId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(16).slice(2)
  return `${prefix}-${random}`
}

function makeClientSessionId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `sidepanel-${Date.now()}`
}

function toWebSocketUrl(apiBaseUrl: string, token: string): string {
  const url = new URL(apiBaseUrl)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  url.pathname = "/ws/session"
  url.search = ""
  url.searchParams.set("token", token)
  return url.toString()
}

function isServerEnvelope(value: unknown): value is ServerEnvelope {
  return typeof value === "object" && value !== null && "type" in value && "timestamp" in value
}

function isRuntimeErrorPayload(value: unknown): value is RuntimeErrorPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof (value as { code?: unknown }).code === "string" &&
    "message" in value &&
    typeof (value as { message?: unknown }).message === "string"
  )
}

function isLegacyErrorEnvelope(
  value: unknown
): value is Extract<ServerEnvelope, { type: "error" }> & { timestamp?: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "error" &&
    isRuntimeErrorPayload((value as { payload?: unknown }).payload)
  )
}

function isEventBatch(value: unknown): value is { events: unknown[] } {
  return typeof value === "object" && value !== null && "type" in value && (value as { type?: unknown }).type === "event.batch" && Array.isArray((value as { events?: unknown[] }).events)
}

function normalizeServerEnvelope(value: unknown): ServerEnvelope | null {
  if (isServerEnvelope(value)) {
    return value
  }

  if (isLegacyErrorEnvelope(value)) {
    return {
      type: "error",
      timestamp:
        typeof value.timestamp === "string" && value.timestamp.length > 0
          ? value.timestamp
          : makeTimestamp(),
      ...(typeof value.sessionId === "string" ? { sessionId: value.sessionId } : {}),
      ...(typeof value.turnId === "string" ? { turnId: value.turnId } : {}),
      ...(typeof value.requestId === "string" ? { requestId: value.requestId } : {}),
      payload: value.payload
    }
  }

  return null
}

export class SessionWsTransport implements ConversationTransport {
  private readonly clientSessionId = makeClientSessionId()
  private ws: WebSocketLike | null = null
  private sessionId: string | null = null
  private activeTurnId: string | null = null
  private connectPromise: Promise<void> | null = null
  private resolveSessionReady: (() => void) | null = null
  private rejectSessionReady: ((error: Error) => void) | null = null

  constructor(
    private readonly args: {
      apiBaseUrl: string
      authClient: TokenIssuer
      handlers: ConversationTransportHandlers
      webSocketFactory?: WebSocketFactory
    }
  ) {}

  async sendIntent(input: ConversationIntentInput): Promise<void> {
    const text = input.intent.transcript?.trim()
    if (!text) {
      throw new Error("intent transcript is required")
    }

    if (this.activeTurnId) {
      await this.interrupt("superseded-by-new-intent")
    }

    await this.ensureSession()
    const sessionId = this.sessionId
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !sessionId) {
      throw new Error("session websocket is not ready")
    }

    this.args.handlers.onPhaseChange?.("sending-intent")
    this.sendEnvelope({
      type: "context.update",
      requestId: this.nextRequestId("ctx"),
      sessionId,
      timestamp: makeTimestamp(),
      payload: {
        tabId: input.activeTabId,
        isPrimary: true
      }
    })
    this.sendEnvelope({
      type: "snapshot.push",
      requestId: this.nextRequestId("snapshot"),
      sessionId,
      timestamp: makeTimestamp(),
      payload: {
        tabId: input.activeTabId,
        snapshot: input.snapshot
      }
    })
    this.sendEnvelope({
      type: "user.intent",
      requestId: this.nextRequestId("intent"),
      sessionId,
      timestamp: makeTimestamp(),
      payload: {
        text,
        primaryTabId: input.activeTabId,
        boundSnapshotCapturedAt: input.snapshot.meta.capturedAt
      }
    })
  }

  async interrupt(reason?: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.sessionId || !this.activeTurnId) {
      return
    }

    this.sendEnvelope({
      type: "interrupt",
      requestId: this.nextRequestId("interrupt"),
      sessionId: this.sessionId,
      turnId: this.activeTurnId,
      timestamp: makeTimestamp(),
      payload: reason ? { reason } : {}
    })
    this.activeTurnId = null
  }

  async close(): Promise<void> {
    this.connectPromise = null
    this.resolveSessionReady = null
    this.rejectSessionReady = null
    this.sessionId = null
    this.activeTurnId = null
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  private async ensureSession(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.sessionId) {
      return
    }

    if (this.connectPromise) {
      await this.connectPromise
      return
    }

    this.args.handlers.onPhaseChange?.("opening-session")
    this.connectPromise = this.openSession().finally(() => {
      this.connectPromise = null
    })
    await this.connectPromise
  }

  private async openSession(): Promise<void> {
    const token = await this.args.authClient.issueToken()
    const factory = this.args.webSocketFactory ?? ((url) => new WebSocket(url))
    const nextWs = factory(toWebSocketUrl(this.args.apiBaseUrl, token.token))
    this.ws = nextWs

    await new Promise<void>((resolve, reject) => {
      this.resolveSessionReady = resolve
      this.rejectSessionReady = reject

      nextWs.onopen = () => {
        this.sendEnvelope({
          type: "session.open",
          requestId: this.nextRequestId("open"),
          timestamp: makeTimestamp(),
          payload: {
            clientSessionId: this.clientSessionId
          }
        })
      }

      nextWs.onmessage = (event: MessageEvent<string>) => {
        this.handleSocketMessage(event.data)
      }

      nextWs.onerror = () => {
        this.args.handlers.onPhaseChange?.("error")
        this.rejectSessionReady?.(new Error("session websocket failed"))
        this.clearPendingSessionReady()
      }

      nextWs.onclose = () => {
        this.sessionId = null
        this.activeTurnId = null
        this.ws = null
        this.args.handlers.onPhaseChange?.("ready")
        this.rejectSessionReady?.(new Error("session websocket closed before ready"))
        this.clearPendingSessionReady()
      }
    })
  }

  private clearPendingSessionReady(): void {
    this.resolveSessionReady = null
    this.rejectSessionReady = null
  }

  private handleSocketMessage(message: string): void {
    const parsed = JSON.parse(message) as unknown
    if (isEventBatch(parsed)) {
      for (const event of parsed.events) {
        const normalized = normalizeServerEnvelope(event)
        if (normalized) {
          void this.handleServerEnvelope(normalized)
        }
      }
      return
    }

    const normalized = normalizeServerEnvelope(parsed)
    if (normalized) {
      void this.handleServerEnvelope(normalized)
    }
  }

  private async handleServerEnvelope(event: ServerEnvelope): Promise<void> {
    if ("turnId" in event && typeof event.turnId === "string") {
      this.activeTurnId = event.turnId
    }

    switch (event.type) {
      case "session.ready":
        this.sessionId = event.payload.sessionId
        this.args.handlers.onSessionReady?.(event)
        this.resolveSessionReady?.()
        this.clearPendingSessionReady()
        return

      case "progress":
        this.args.handlers.onProgress?.(event)
        return

      case "projection":
        this.args.handlers.onProjection?.(event.payload, event)
        return

      case "context.enrich.request": {
        this.args.handlers.onPhaseChange?.("waiting-enrich")
        const turnId = event.turnId
        const result = await this.args.handlers.onEnrichRequest?.(event)
        if (!result || !this.ws || this.ws.readyState !== WebSocket.OPEN || this.sessionId !== event.sessionId) {
          return
        }
        if (this.activeTurnId !== turnId) {
          return
        }

        this.args.handlers.onPhaseChange?.("resuming-turn")
        this.sendEnvelope({
          type: "context.enrich.result",
          requestId: this.nextRequestId("enrich"),
          sessionId: event.sessionId,
          turnId,
          timestamp: makeTimestamp(),
          payload: result
        })
        return
      }

      case "turn.done":
        this.activeTurnId = null
        this.args.handlers.onTurnDone?.(event)
        this.args.handlers.onPhaseChange?.("ready")
        return

      case "error":
        this.args.handlers.onError?.(event.payload, event)
        this.args.handlers.onPhaseChange?.("error")
        return
    }
  }

  private sendEnvelope(envelope: RuntimeEnvelope): void {
    if (!this.ws) {
      throw new Error("session websocket is not initialized")
    }
    this.ws.send(JSON.stringify(envelope))
  }

  private nextRequestId(prefix: string): string {
    return makeRequestId(`sidepanel-${prefix}`)
  }
}
