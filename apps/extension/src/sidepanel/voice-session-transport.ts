import type { AuthClient } from "./auth-client"
import type { SemanticSnapshot } from "@threadatlas/shared"
import type {
  LiveClientEnvelope,
  LiveRuntimeErrorPayload,
  LiveServerEnvelope,
  LiveToolResultPayload
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

function makeTimestamp(): string {
  return new Date().toISOString()
}

function makeRequestId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(16).slice(2)
  return `${prefix}-${random}`
}

function makeClientSessionId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `live-${Date.now()}`
}

function toWebSocketUrl(apiBaseUrl: string, token: string): string {
  const url = new URL(apiBaseUrl)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  url.pathname = "/ws/live"
  url.search = ""
  url.searchParams.set("token", token)
  return url.toString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isLiveServerEnvelope(value: unknown): value is LiveServerEnvelope {
  return (
    isRecord(value) &&
    typeof value.type === "string" &&
    typeof value.timestamp === "string" &&
    isRecord(value.payload)
  )
}

export interface VoiceSessionTransportHandlers {
  onReady?: (event: Extract<LiveServerEnvelope, { type: "live.ready" }>) => void
  onInputTranscript?: (text: string, final: boolean) => void
  onOutputTranscript?: (text: string, final: boolean) => void
  onAudioChunk?: (chunkBase64: string) => void
  onToolCall?: (
    event: Extract<LiveServerEnvelope, { type: "live.tool.call" }>
  ) => Promise<LiveToolResultPayload | null>
  onTurnDone?: (event: Extract<LiveServerEnvelope, { type: "live.turn.done" }>) => void
  onError?: (payload: LiveRuntimeErrorPayload, event: Extract<LiveServerEnvelope, { type: "live.error" }>) => void
}

export class VoiceSessionTransport {
  private ws: WebSocketLike | null = null
  private readonly clientSessionId = makeClientSessionId()
  private openPromise: Promise<void> | null = null
  private liveSessionId: string | null = null

  constructor(
    private readonly args: {
      apiBaseUrl: string
      authClient: Pick<AuthClient, "issueToken">
      handlers: VoiceSessionTransportHandlers
      webSocketFactory?: WebSocketFactory
    }
  ) {}

  async open(input: { activeTabId: number; snapshot: SemanticSnapshot; language?: string }): Promise<void> {
    if (this.openPromise) {
      await this.openPromise
      return
    }

    this.openPromise = this.openSocket(input).finally(() => {
      this.openPromise = null
    })
    await this.openPromise
  }

  appendAudioChunk(chunkBase64: string): void {
    this.send({
      type: "live.audio.append",
      requestId: makeRequestId("live-audio"),
      timestamp: makeTimestamp(),
      ...(this.liveSessionId ? { liveSessionId: this.liveSessionId } : {}),
      payload: {
        chunkBase64
      }
    })
  }

  commitAudio(): void {
    this.send({
      type: "live.audio.commit",
      requestId: makeRequestId("live-commit"),
      timestamp: makeTimestamp(),
      ...(this.liveSessionId ? { liveSessionId: this.liveSessionId } : {}),
      payload: {
        endOfTurn: true
      }
    })
  }

  interrupt(reason?: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return
    }
    this.send({
      type: "live.interrupt",
      requestId: makeRequestId("live-interrupt"),
      timestamp: makeTimestamp(),
      ...(this.liveSessionId ? { liveSessionId: this.liveSessionId } : {}),
      payload: reason ? { reason } : {}
    })
  }

  close(): void {
    this.liveSessionId = null
    this.openPromise = null
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  private async openSocket(input: {
    activeTabId: number
    snapshot: SemanticSnapshot
    language?: string
  }): Promise<void> {
    const token = await this.args.authClient.issueToken()
    const factory = this.args.webSocketFactory ?? ((url) => new WebSocket(url))
    const nextWs = factory(toWebSocketUrl(this.args.apiBaseUrl, token.token))
    this.ws = nextWs

    await new Promise<void>((resolve, reject) => {
      let resolved = false
      nextWs.onopen = () => {
        const envelope: LiveClientEnvelope = {
          type: "live.open",
          requestId: makeRequestId("live-open"),
          timestamp: makeTimestamp(),
          payload: {
            clientSessionId: this.clientSessionId,
            tabId: input.activeTabId,
            snapshot: input.snapshot,
            ...(input.language ? { language: input.language } : {})
          }
        }
        nextWs.send(JSON.stringify(envelope))
      }

      nextWs.onmessage = (event: MessageEvent<string>) => {
        const parsed = JSON.parse(event.data) as unknown
        if (!isLiveServerEnvelope(parsed)) {
          return
        }
        void this.handleEvent(parsed)
        if (!resolved && parsed.type === "live.ready") {
          resolved = true
          this.liveSessionId = parsed.liveSessionId
          resolve()
        }
        if (!resolved && parsed.type === "live.error") {
          resolved = true
          reject(new Error(parsed.payload.message))
        }
      }

      nextWs.onerror = () => {
        if (!resolved) {
          reject(new Error("live websocket failed"))
        }
      }

      nextWs.onclose = () => {
        this.ws = null
        this.liveSessionId = null
        if (!resolved) {
          reject(new Error("live websocket closed before ready"))
        }
      }
    })
  }

  private async handleEvent(event: LiveServerEnvelope): Promise<void> {
    switch (event.type) {
      case "live.ready":
        this.liveSessionId = event.liveSessionId
        this.args.handlers.onReady?.(event)
        return
      case "live.input.transcript.partial":
        this.args.handlers.onInputTranscript?.(event.payload.text, false)
        return
      case "live.input.transcript.final":
        this.args.handlers.onInputTranscript?.(event.payload.text, true)
        return
      case "live.output.transcript.partial":
        this.args.handlers.onOutputTranscript?.(event.payload.text, false)
        return
      case "live.output.transcript.final":
        this.args.handlers.onOutputTranscript?.(event.payload.text, true)
        return
      case "live.output.audio.chunk":
        this.args.handlers.onAudioChunk?.(event.payload.chunkBase64)
        return
      case "live.tool.call": {
        const result = await this.args.handlers.onToolCall?.(event)
        if (!result || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
          return
        }
        const response: LiveClientEnvelope = {
          type: "live.tool.result",
          requestId: makeRequestId("live-tool-result"),
          timestamp: makeTimestamp(),
          liveSessionId: event.liveSessionId,
          toolCallId: event.toolCallId,
          payload: result
        }
        this.ws.send(JSON.stringify(response))
        return
      }
      case "live.tool.result.ack":
        return
      case "live.turn.done":
        this.args.handlers.onTurnDone?.(event)
        return
      case "live.error":
        this.args.handlers.onError?.(event.payload, event)
        return
    }
  }

  private send(envelope: LiveClientEnvelope): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return
    }
    this.ws.send(JSON.stringify(envelope))
  }
}
