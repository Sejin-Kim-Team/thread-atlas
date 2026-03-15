import type { AuthClient } from "./auth-client"
import type { Projection, SemanticSnapshot } from "@threadatlas/shared"
import type {
  RuntimeV2ClientEnvelope,
  RuntimeV2ErrorPayload,
  RuntimeV2ServerEnvelope,
  RuntimeV2ToolResultPayload
} from "@threadatlas/shared/runtime"

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

export interface RuntimeTransportHandlers {
  onPhaseChange?: (phase: "ready" | "opening-session" | "sending-intent" | "error") => void
  onSessionReady?: (event: Extract<RuntimeV2ServerEnvelope, { type: "session.ready" }>) => void
  onTurnStarted?: (event: Extract<RuntimeV2ServerEnvelope, { type: "turn.started" }>) => void
  onInputTranscript?: (
    text: string,
    final: boolean,
    event:
      | Extract<RuntimeV2ServerEnvelope, { type: "turn.input.transcript.partial" }>
      | Extract<RuntimeV2ServerEnvelope, { type: "turn.input.transcript.final" }>
  ) => void
  onOutputTranscript?: (
    text: string,
    final: boolean,
    event:
      | Extract<RuntimeV2ServerEnvelope, { type: "turn.output.transcript.partial" }>
      | Extract<RuntimeV2ServerEnvelope, { type: "turn.output.transcript.final" }>
  ) => void
  onAudioChunk?: (
    event: Extract<RuntimeV2ServerEnvelope, { type: "turn.output.audio.chunk" }>
  ) => void
  onProjection?: (
    projection: Projection,
    event: Extract<RuntimeV2ServerEnvelope, { type: "turn.output.projection" }>
  ) => void
  onToolRequest?: (
    event: Extract<RuntimeV2ServerEnvelope, { type: "tool.request" }>
  ) => Promise<RuntimeV2ToolResultPayload | null>
  onTurnDone?: (event: Extract<RuntimeV2ServerEnvelope, { type: "turn.done" }>) => void
  onError?: (
    error: RuntimeV2ErrorPayload,
    event: Extract<RuntimeV2ServerEnvelope, { type: "turn.error" }>
  ) => void
}

function makeTimestamp(): string {
  return new Date().toISOString()
}

function makeRequestId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(16).slice(2)
  return `${prefix}-${random}`
}

function makeClientSessionId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `runtime-${Date.now()}`
}

function toWebSocketUrl(apiBaseUrl: string, token: string): string {
  const url = new URL(apiBaseUrl)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  url.pathname = "/ws/runtime"
  url.search = ""
  url.searchParams.set("token", token)
  return url.toString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isRuntimeV2ServerEnvelope(value: unknown): value is RuntimeV2ServerEnvelope {
  return (
    isRecord(value) &&
    typeof value.type === "string" &&
    typeof value.timestamp === "string" &&
    isRecord(value.payload)
  )
}

export class RuntimeTransport {
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
      authClient: Pick<AuthClient, "issueToken">
      handlers: RuntimeTransportHandlers
      webSocketFactory?: WebSocketFactory
    }
  ) {}

  async sendTextTurn(input: {
    activeTabId: number
    snapshot: SemanticSnapshot
    text: string
    language?: string
  }): Promise<void> {
    const normalized = input.text.trim()
    if (!normalized) {
      throw new Error("text input is required")
    }
    if (this.activeTurnId) {
      await this.interrupt("superseded-by-new-turn")
    }
    await this.ensureSession(input.language)
    await this.syncContextSnapshot(input.activeTabId, input.snapshot)
    const sessionId = this.sessionId
    if (!sessionId) {
      throw new Error("runtime session is not ready")
    }
    this.args.handlers.onPhaseChange?.("sending-intent")
    this.send({
      type: "turn.input.text",
      requestId: makeRequestId("turn-text"),
      timestamp: makeTimestamp(),
      sessionId,
      payload: {
        text: normalized
      }
    })
  }

  async startVoiceTurn(input: {
    activeTabId: number
    snapshot: SemanticSnapshot
    language?: string
  }): Promise<void> {
    if (this.activeTurnId) {
      await this.interrupt("superseded-by-new-turn")
    }
    await this.ensureSession(input.language)
    await this.syncContextSnapshot(input.activeTabId, input.snapshot)
  }

  appendAudioChunk(chunkBase64: string): void {
    const sessionId = this.sessionId
    if (!sessionId) {
      throw new Error("runtime session is not ready")
    }
    this.send({
      type: "turn.input.audio.append",
      requestId: makeRequestId("turn-audio"),
      timestamp: makeTimestamp(),
      sessionId,
      payload: {
        chunkBase64
      }
    })
  }

  commitAudio(): void {
    const sessionId = this.sessionId
    if (!sessionId) {
      throw new Error("runtime session is not ready")
    }
    this.send({
      type: "turn.input.audio.commit",
      requestId: makeRequestId("turn-commit"),
      timestamp: makeTimestamp(),
      sessionId,
      payload: {
        endOfTurn: true
      }
    })
  }

  async interrupt(reason?: string): Promise<void> {
    if (!this.sessionId || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return
    }
    this.send({
      type: "turn.interrupt",
      requestId: makeRequestId("turn-interrupt"),
      timestamp: makeTimestamp(),
      sessionId: this.sessionId,
      ...(this.activeTurnId ? { turnId: this.activeTurnId } : {}),
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

  private async ensureSession(language?: string): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.sessionId) {
      return
    }
    if (this.connectPromise) {
      await this.connectPromise
      return
    }

    this.args.handlers.onPhaseChange?.("opening-session")
    this.connectPromise = this.openSession(language).finally(() => {
      this.connectPromise = null
    })
    await this.connectPromise
  }

  private async openSession(language?: string): Promise<void> {
    const token = await this.args.authClient.issueToken()
    const factory = this.args.webSocketFactory ?? ((url) => new WebSocket(url))
    const nextWs = factory(toWebSocketUrl(this.args.apiBaseUrl, token.token))
    this.ws = nextWs

    await new Promise<void>((resolve, reject) => {
      this.resolveSessionReady = resolve
      this.rejectSessionReady = reject

      nextWs.onopen = () => {
        const envelope: RuntimeV2ClientEnvelope = {
          type: "session.open",
          requestId: makeRequestId("session-open"),
          timestamp: makeTimestamp(),
          payload: {
            clientSessionId: this.clientSessionId,
            ...(language ? { language } : {})
          }
        }
        nextWs.send(JSON.stringify(envelope))
      }

      nextWs.onmessage = (event: MessageEvent<string>) => {
        this.handleSocketMessage(event.data)
      }

      nextWs.onerror = () => {
        this.args.handlers.onPhaseChange?.("error")
        this.rejectSessionReady?.(new Error("runtime websocket failed"))
        this.clearPendingSessionReady()
      }

      nextWs.onclose = () => {
        this.args.handlers.onPhaseChange?.("error")
        this.rejectSessionReady?.(new Error("runtime websocket closed"))
        this.clearPendingSessionReady()
        this.sessionId = null
        this.activeTurnId = null
        this.ws = null
      }
    })
  }

  private async syncContextSnapshot(tabId: number, snapshot: SemanticSnapshot): Promise<void> {
    if (!this.sessionId || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("runtime websocket is not ready")
    }

    this.send({
      type: "session.context.sync",
      requestId: makeRequestId("session-context"),
      timestamp: makeTimestamp(),
      sessionId: this.sessionId,
      payload: {
        tabId,
        isPrimary: true
      }
    })

    this.send({
      type: "session.snapshot.sync",
      requestId: makeRequestId("session-snapshot"),
      timestamp: makeTimestamp(),
      sessionId: this.sessionId,
      payload: {
        tabId,
        snapshot
      }
    })
  }

  private handleSocketMessage(raw: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      return
    }
    if (!isRuntimeV2ServerEnvelope(parsed)) {
      return
    }

    switch (parsed.type) {
      case "session.ready":
        this.sessionId = parsed.payload.sessionId
        this.args.handlers.onSessionReady?.(parsed)
        this.args.handlers.onPhaseChange?.("ready")
        this.resolveSessionReady?.()
        this.clearPendingSessionReady()
        return
      case "turn.started":
        this.activeTurnId = parsed.turnId
        this.args.handlers.onTurnStarted?.(parsed)
        return
      case "turn.input.transcript.partial":
        this.args.handlers.onInputTranscript?.(parsed.payload.text, false, parsed)
        return
      case "turn.input.transcript.final":
        this.args.handlers.onInputTranscript?.(parsed.payload.text, true, parsed)
        return
      case "turn.output.transcript.partial":
        this.args.handlers.onOutputTranscript?.(parsed.payload.text, false, parsed)
        return
      case "turn.output.transcript.final":
        this.args.handlers.onOutputTranscript?.(parsed.payload.text, true, parsed)
        return
      case "turn.output.audio.chunk":
        this.args.handlers.onAudioChunk?.(parsed)
        return
      case "turn.output.projection":
        this.args.handlers.onProjection?.(parsed.payload.projection, parsed)
        return
      case "tool.request":
        void this.handleToolRequest(parsed)
        return
      case "turn.done":
        if (this.activeTurnId === parsed.turnId) {
          this.activeTurnId = null
        }
        this.args.handlers.onPhaseChange?.("ready")
        this.args.handlers.onTurnDone?.(parsed)
        return
      case "turn.error":
        if (parsed.turnId && this.activeTurnId === parsed.turnId) {
          this.activeTurnId = null
        }
        this.args.handlers.onPhaseChange?.("error")
        this.args.handlers.onError?.(parsed.payload, parsed)
        return
    }
  }

  private async handleToolRequest(
    event: Extract<RuntimeV2ServerEnvelope, { type: "tool.request" }>
  ): Promise<void> {
    const result = await this.args.handlers.onToolRequest?.(event)
    if (!event.payload.waitForResult && !result) {
      return
    }

    const payload: RuntimeV2ToolResultPayload =
      result ?? {
        toolRequestId: event.payload.toolRequestId,
        kind: event.payload.kind,
        ok: false,
        error: "frontend tool handler did not return a result"
      }

    this.send({
      type: "tool.result",
      requestId: makeRequestId("tool-result"),
      timestamp: makeTimestamp(),
      sessionId: event.sessionId,
      turnId: event.turnId,
      payload
    })
  }

  private send(envelope: RuntimeV2ClientEnvelope): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("runtime websocket is not open")
    }
    this.ws.send(JSON.stringify(envelope))
  }

  private clearPendingSessionReady(): void {
    this.resolveSessionReady = null
    this.rejectSessionReady = null
  }
}
