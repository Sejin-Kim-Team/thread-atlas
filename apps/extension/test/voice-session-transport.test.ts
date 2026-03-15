import type { SemanticSnapshot } from "@threadatlas/shared"
import type { LiveClientEnvelope, LiveServerEnvelope } from "@threadatlas/shared/runtime"
import { describe, expect, it, vi } from "vitest"
import { VoiceSessionTransport } from "../src/sidepanel/voice-session-transport"

class FakeWebSocket {
  readyState = 0
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  readonly sent: string[] = []

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.readyState = WebSocket.CLOSED
    this.onclose?.(new CloseEvent("close"))
  }

  open(): void {
    this.readyState = WebSocket.OPEN
    this.onopen?.(new Event("open"))
  }

  emit(event: LiveServerEnvelope): void {
    this.onmessage?.({
      data: JSON.stringify(event)
    } as MessageEvent<string>)
  }
}

const snapshot: SemanticSnapshot = {
  page: {
    id: "page-1",
    url: "https://example.com/article",
    title: "Example article",
    kind: "article"
  },
  focus: {
    nodeId: "node-1",
    region: "region-1",
    node: {
      kind: "content",
      id: "node-1",
      type: "paragraph",
      text: "Current page summary"
    }
  },
  context: [],
  meta: {
    capturedAt: "2026-03-15T12:00:00.000Z",
    skeletonVersion: 1,
    extractorId: "test"
  }
}

function parseSent(socket: FakeWebSocket): LiveClientEnvelope[] {
  return socket.sent.map((value) => JSON.parse(value) as LiveClientEnvelope)
}

describe("voice session transport", () => {
  it("opens lazily, streams transcripts/audio, and responds to frontend tool calls", async () => {
    const sockets: FakeWebSocket[] = []
    const issueToken = vi.fn(async () => ({
      token: "voice-auth-token",
      expiresAt: 1_800_000_000,
      user: { id: "user-1" }
    }))
    const onToolCall = vi.fn(async () => ({
      name: "request_context_enrich" as const,
      ok: true,
      result: {
        payload: {
          requestKind: "node-detail",
          targetRef: { nodeId: "node-1" },
          status: "ok",
          capturedAt: "2026-03-15T12:00:01.000Z",
          detail: {
            text: "Focused node detail"
          }
        }
      }
    }))
    const userTranscript = vi.fn()
    const assistantTranscript = vi.fn()
    const audioChunk = vi.fn()
    const turnDone = vi.fn()

    const transport = new VoiceSessionTransport({
      apiBaseUrl: "https://api.example.com",
      authClient: {
        issueToken
      },
      handlers: {
        onInputTranscript: userTranscript,
        onOutputTranscript: assistantTranscript,
        onAudioChunk: audioChunk,
        onToolCall,
        onTurnDone: turnDone
      },
      webSocketFactory(url) {
        const socket = new FakeWebSocket(url)
        sockets.push(socket)
        return socket
      }
    })

    const openPromise = transport.open({
      activeTabId: 17,
      snapshot,
      language: "en-US"
    })
    await Promise.resolve()

    expect(issueToken).toHaveBeenCalledTimes(1)
    expect(sockets).toHaveLength(1)
    expect(sockets[0]?.url).toBe("wss://api.example.com/ws/live?token=voice-auth-token")

    const socket = sockets[0]!
    socket.open()
    socket.emit({
      type: "live.ready",
      timestamp: "2026-03-15T12:00:00.500Z",
      liveSessionId: "live-session-1",
      payload: {
        liveSessionId: "live-session-1",
        clientSessionId: "client-session-1",
        inputAudioFormat: {
          encoding: "pcm_s16le",
          sampleRateHz: 16000,
          channels: 1,
          mimeType: "audio/pcm;rate=16000"
        },
        outputAudioFormat: {
          encoding: "pcm_s16le",
          sampleRateHz: 24000,
          channels: 1,
          mimeType: "audio/pcm;rate=24000"
        },
        model: "gemini-live-2.5-flash-native-audio"
      }
    })
    await openPromise

    const sent = parseSent(socket)
    expect(sent[0]).toMatchObject({
      type: "live.open",
      payload: {
        tabId: 17,
        snapshot
      }
    })

    transport.appendAudioChunk("cGNt")
    transport.commitAudio()

    expect(parseSent(socket).map((event) => event.type)).toEqual([
      "live.open",
      "live.audio.append",
      "live.audio.commit"
    ])

    socket.emit({
      type: "live.input.transcript.partial",
      timestamp: "2026-03-15T12:00:01.000Z",
      liveSessionId: "live-session-1",
      payload: {
        text: "what matters"
      }
    })
    socket.emit({
      type: "live.output.transcript.partial",
      timestamp: "2026-03-15T12:00:01.100Z",
      liveSessionId: "live-session-1",
      payload: {
        text: "The article"
      }
    })
    socket.emit({
      type: "live.output.audio.chunk",
      timestamp: "2026-03-15T12:00:01.200Z",
      liveSessionId: "live-session-1",
      payload: {
        chunkBase64: "cGNt",
        mimeType: "audio/pcm;rate=24000"
      }
    })
    socket.emit({
      type: "live.tool.call",
      timestamp: "2026-03-15T12:00:01.300Z",
      liveSessionId: "live-session-1",
      toolCallId: "tool-call-1",
      payload: {
        name: "request_context_enrich",
        args: {
          requestKind: "node-detail",
          targetRef: { nodeId: "node-1" },
          reason: "Need node detail",
          timeoutMs: 5000
        }
      }
    })
    await Promise.resolve()
    socket.emit({
      type: "live.turn.done",
      timestamp: "2026-03-15T12:00:01.400Z",
      liveSessionId: "live-session-1",
      payload: {}
    })

    expect(userTranscript).toHaveBeenCalledWith("what matters", false)
    expect(assistantTranscript).toHaveBeenCalledWith("The article", false)
    expect(audioChunk).toHaveBeenCalledWith("cGNt")
    expect(onToolCall).toHaveBeenCalledTimes(1)
    expect(turnDone).toHaveBeenCalledTimes(1)

    const toolResultEnvelope = parseSent(socket).find((event) => event.type === "live.tool.result")
    expect(toolResultEnvelope).toMatchObject({
      type: "live.tool.result",
      toolCallId: "tool-call-1",
      payload: {
        name: "request_context_enrich",
        ok: true
      }
    })
  })
})
