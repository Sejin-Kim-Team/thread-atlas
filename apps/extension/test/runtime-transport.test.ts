import type { SemanticSnapshot } from "@threadatlas/shared"
import type { RuntimeV2ClientEnvelope, RuntimeV2ServerEnvelope } from "@threadatlas/shared/runtime"
import { describe, expect, it, vi } from "vitest"
import { RuntimeTransport } from "../src/sidepanel/runtime-transport"

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

  close(_code?: number, _reason?: string): void {
    this.readyState = WebSocket.CLOSED
    this.onclose?.(new CloseEvent("close"))
  }

  open(): void {
    this.readyState = WebSocket.OPEN
    this.onopen?.(new Event("open"))
  }

  emit(event: RuntimeV2ServerEnvelope): void {
    this.onmessage?.({
      data: JSON.stringify(event)
    } as MessageEvent<string>)
  }
}

const snapshot: SemanticSnapshot = {
  page: {
    id: "page-1",
    url: "https://example.com/docs",
    title: "Docs page",
    kind: "article"
  },
  focus: {
    nodeId: "node-1",
    node: {
      kind: "content",
      id: "node-1",
      type: "paragraph",
      text: "Current page summary"
    },
    region: "region-1"
  },
  context: [],
  meta: {
    capturedAt: "2026-03-15T00:00:00.000Z",
    skeletonVersion: 1,
    extractorId: "test"
  }
}

function parseSent(socket: FakeWebSocket): RuntimeV2ClientEnvelope[] {
  return socket.sent.map((payload) => JSON.parse(payload) as RuntimeV2ClientEnvelope)
}

function resolveSession(socket: FakeWebSocket): string {
  const sent = parseSent(socket)
  const openEnvelope = sent[0]
  if (!openEnvelope || openEnvelope.type !== "session.open") {
    throw new Error("session.open must be sent before session.ready")
  }

  socket.emit({
    type: "session.ready",
    requestId: openEnvelope.requestId,
    timestamp: "2026-03-15T00:00:01.000Z",
    sessionId: "runtime-session-1",
    payload: {
      sessionId: "runtime-session-1",
      clientSessionId: openEnvelope.payload.clientSessionId,
      reused: false,
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
      }
    }
  })

  return "runtime-session-1"
}

describe("runtime transport", () => {
  it("opens lazily and preserves session.context.sync -> session.snapshot.sync -> turn.input.text ordering", async () => {
    const sockets: FakeWebSocket[] = []
    const issueToken = vi.fn(async () => ({
      token: "auth-token",
      expiresAt: 1_799_999_999,
      user: { id: "user-1" }
    }))
    const onProjection = vi.fn()
    const onTurnDone = vi.fn()
    const phases: string[] = []

    const transport = new RuntimeTransport({
      apiBaseUrl: "https://api.example.com",
      authClient: {
        issueToken
      },
      handlers: {
        onPhaseChange(phase) {
          phases.push(phase)
        },
        onProjection,
        onTurnDone
      },
      webSocketFactory(url) {
        const socket = new FakeWebSocket(url)
        sockets.push(socket)
        return socket
      }
    })

    const firstSend = transport.sendTextTurn({
      activeTabId: 17,
      snapshot,
      text: "Summarize this page"
    })
    await Promise.resolve()

    expect(issueToken).toHaveBeenCalledTimes(1)
    expect(sockets).toHaveLength(1)
    expect(sockets[0]?.url).toBe("wss://api.example.com/ws/runtime?token=auth-token")

    const socket = sockets[0]!
    socket.open()
    const sessionId = resolveSession(socket)
    await firstSend

    const firstBatch = parseSent(socket)
    expect(firstBatch.map((event) => event.type)).toEqual([
      "session.open",
      "session.context.sync",
      "session.snapshot.sync",
      "turn.input.text"
    ])
    expect(firstBatch[1]).toMatchObject({
      type: "session.context.sync",
      sessionId,
      payload: {
        tabId: 17,
        isPrimary: true
      }
    })
    expect(firstBatch[2]).toMatchObject({
      type: "session.snapshot.sync",
      sessionId,
      payload: {
        tabId: 17,
        snapshot
      }
    })
    expect(firstBatch[3]).toMatchObject({
      type: "turn.input.text",
      sessionId,
      payload: {
        text: "Summarize this page"
      }
    })

    socket.emit({
      type: "turn.started",
      timestamp: "2026-03-15T00:00:02.000Z",
      sessionId,
      turnId: "turn-1",
      payload: {
        modality: "text"
      }
    })
    socket.emit({
      type: "turn.input.transcript.final",
      timestamp: "2026-03-15T00:00:02.100Z",
      sessionId,
      turnId: "turn-1",
      payload: {
        text: "Summarize this page"
      }
    })
    socket.emit({
      type: "turn.output.projection",
      timestamp: "2026-03-15T00:00:03.000Z",
      sessionId,
      turnId: "turn-1",
      payload: {
        projection: {
          type: "respond",
          payload: {
            text: "Answer",
            mode: "answer"
          }
        }
      }
    })
    socket.emit({
      type: "turn.done",
      timestamp: "2026-03-15T00:00:04.000Z",
      sessionId,
      turnId: "turn-1",
      payload: {
        modality: "text",
        referencedTabIds: [17],
        provenanceSummary: ["current-page"]
      }
    })

    expect(onProjection).toHaveBeenCalledWith(
      {
        type: "respond",
        payload: {
          text: "Answer",
          mode: "answer"
        }
      },
      expect.objectContaining({ type: "turn.output.projection", turnId: "turn-1" })
    )
    expect(onTurnDone).toHaveBeenCalledWith(
      expect.objectContaining({ type: "turn.done", turnId: "turn-1" })
    )
    expect(phases).toEqual(expect.arrayContaining(["opening-session", "sending-intent", "ready"]))
  })

  it("streams voice audio over the unified runtime and returns tool results", async () => {
    const sockets: FakeWebSocket[] = []
    const issueToken = vi.fn(async () => ({
      token: "voice-auth-token",
      expiresAt: 1_800_000_000,
      user: { id: "user-1" }
    }))
    const onToolRequest = vi.fn(async (event) => ({
      toolRequestId: event.payload.toolRequestId,
      kind: event.payload.kind,
      ok: true,
      result: {
        payload: {
          requestKind: "node-detail",
          targetRef: { kind: "semantic-node", nodeId: "node-1" },
          status: "ok",
          capturedAt: "2026-03-15T00:00:05.000Z",
          detail: {
            text: "Focused node detail"
          }
        }
      }
    }))
    const userTranscript = vi.fn()
    const assistantTranscript = vi.fn()
    const audioChunk = vi.fn()

    const transport = new RuntimeTransport({
      apiBaseUrl: "https://api.example.com",
      authClient: {
        issueToken
      },
      handlers: {
        onInputTranscript: userTranscript,
        onOutputTranscript: assistantTranscript,
        onAudioChunk: audioChunk,
        onToolRequest
      },
      webSocketFactory(url) {
        const socket = new FakeWebSocket(url)
        sockets.push(socket)
        return socket
      }
    })

    const openPromise = transport.startVoiceTurn({
      activeTabId: 17,
      snapshot,
      language: "en-US"
    })
    await Promise.resolve()

    expect(issueToken).toHaveBeenCalledTimes(1)
    expect(sockets).toHaveLength(1)
    expect(sockets[0]?.url).toBe("wss://api.example.com/ws/runtime?token=voice-auth-token")

    const socket = sockets[0]!
    socket.open()
    const sessionId = resolveSession(socket)
    await openPromise

    const sentBeforeAudio = parseSent(socket)
    expect(sentBeforeAudio.map((event) => event.type)).toEqual([
      "session.open",
      "session.context.sync",
      "session.snapshot.sync"
    ])

    transport.appendAudioChunk("cGNt")
    transport.commitAudio()

    expect(parseSent(socket).map((event) => event.type)).toEqual([
      "session.open",
      "session.context.sync",
      "session.snapshot.sync",
      "turn.input.audio.append",
      "turn.input.audio.commit"
    ])

    socket.emit({
      type: "turn.started",
      timestamp: "2026-03-15T00:00:06.000Z",
      sessionId,
      turnId: "turn-voice-1",
      payload: {
        modality: "voice"
      }
    })
    socket.emit({
      type: "turn.input.transcript.partial",
      timestamp: "2026-03-15T00:00:06.100Z",
      sessionId,
      turnId: "turn-voice-1",
      payload: {
        text: "what matters"
      }
    })
    socket.emit({
      type: "turn.output.transcript.partial",
      timestamp: "2026-03-15T00:00:06.200Z",
      sessionId,
      turnId: "turn-voice-1",
      payload: {
        text: "The article"
      }
    })
    socket.emit({
      type: "turn.output.audio.chunk",
      timestamp: "2026-03-15T00:00:06.300Z",
      sessionId,
      turnId: "turn-voice-1",
      payload: {
        chunkBase64: "cGNt",
        mimeType: "audio/pcm;rate=24000"
      }
    })
    socket.emit({
      type: "tool.request",
      timestamp: "2026-03-15T00:00:06.400Z",
      sessionId,
      turnId: "turn-voice-1",
      payload: {
        toolRequestId: "tool-request-1",
        kind: "context.enrich",
        waitForResult: true,
        args: {
          requestKind: "node-detail",
          targetRef: {
            kind: "semantic-node",
            nodeId: "node-1"
          }
        }
      }
    })
    await Promise.resolve()

    expect(userTranscript).toHaveBeenCalledWith(
      "what matters",
      false,
      expect.objectContaining({ type: "turn.input.transcript.partial" })
    )
    expect(assistantTranscript).toHaveBeenCalledWith(
      "The article",
      false,
      expect.objectContaining({ type: "turn.output.transcript.partial" })
    )
    expect(audioChunk).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "turn.output.audio.chunk",
        turnId: "turn-voice-1"
      })
    )
    expect(onToolRequest).toHaveBeenCalledTimes(1)

    const toolResultEnvelope = parseSent(socket).find((event) => event.type === "tool.result")
    expect(toolResultEnvelope).toMatchObject({
      type: "tool.result",
      sessionId,
      turnId: "turn-voice-1",
      payload: {
        toolRequestId: "tool-request-1",
        kind: "context.enrich",
        ok: true
      }
    })
  })
})
