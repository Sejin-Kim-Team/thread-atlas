import type { Intent, SemanticSnapshot } from "@threadatlas/shared"
import type { ClientEnvelope, ContextEnrichResultPayload, ServerEnvelope } from "@threadatlas/shared/runtime"
import { describe, expect, it, vi } from "vitest"
import { SessionWsTransport } from "../src/sidepanel/session-ws-transport"

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

  emit(event: ServerEnvelope): void {
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
    capturedAt: "2026-03-12T00:00:00.000Z",
    skeletonVersion: 1,
    extractorId: "test"
  }
}

function createIntent(transcript: string): Intent {
  return {
    type: "UserSpeech",
    intentType: "general",
    transcript
  }
}

function parseSent(socket: FakeWebSocket): ClientEnvelope[] {
  return socket.sent.map((payload) => JSON.parse(payload) as ClientEnvelope)
}

function resolveSession(socket: FakeWebSocket): void {
  const sent = parseSent(socket)
  const openEnvelope = sent[0]
  if (!openEnvelope || openEnvelope.type !== "session.open") {
    throw new Error("session.open must be sent before session.ready")
  }

  socket.emit({
    type: "session.ready",
    timestamp: "2026-03-12T00:00:01.000Z",
    sessionId: "session-1",
    payload: {
      sessionId: "session-1",
      clientSessionId: openEnvelope.payload.clientSessionId,
      reused: false
    }
  })
}

describe("session websocket transport", () => {
  it("opens lazily, reuses the socket, and preserves context->snapshot->intent ordering", async () => {
    const sockets: FakeWebSocket[] = []
    const issueToken = vi.fn(async () => ({
      token: "auth-token",
      expiresAt: 1_799_999_999,
      user: { id: "user-1" }
    }))
    const onProjection = vi.fn()
    const onTurnDone = vi.fn()
    const phases: string[] = []

    const transport = new SessionWsTransport({
      apiBaseUrl: "https://api.example.com",
      authClient: {
        issueToken
      },
      handlers: {
        onPhaseChange(phase) {
          phases.push(phase)
        },
        onProjection,
        onTurnDone,
        async onEnrichRequest() {
          throw new Error("unexpected enrich request")
        }
      },
      webSocketFactory(url) {
        const socket = new FakeWebSocket(url)
        sockets.push(socket)
        return socket
      }
    })

    const firstSend = transport.sendIntent({
      intent: createIntent("Summarize this page"),
      activeTabId: 17,
      snapshot
    })
    await Promise.resolve()

    expect(issueToken).toHaveBeenCalledTimes(1)
    expect(sockets).toHaveLength(1)
    expect(sockets[0]?.url).toBe("wss://api.example.com/ws/session?token=auth-token")

    const socket = sockets[0]!
    socket.open()
    resolveSession(socket)
    await firstSend

    const firstBatch = parseSent(socket)
    expect(firstBatch.map((event) => event.type)).toEqual([
      "session.open",
      "context.update",
      "snapshot.push",
      "user.intent"
    ])
    expect(firstBatch.every((event) => typeof event.requestId === "string" && event.requestId.length > 0)).toBe(true)
    expect(firstBatch[1]).toMatchObject({
      type: "context.update",
      payload: {
        tabId: 17,
        isPrimary: true
      }
    })
    expect(firstBatch[2]).toMatchObject({
      type: "snapshot.push",
      payload: {
        tabId: 17,
        snapshot
      }
    })
    expect(firstBatch[3]).toMatchObject({
      type: "user.intent",
      payload: {
        text: "Summarize this page",
        primaryTabId: 17,
        boundSnapshotCapturedAt: snapshot.meta.capturedAt
      }
    })

    socket.emit({
      type: "progress",
      timestamp: "2026-03-12T00:00:02.000Z",
      sessionId: "session-1",
      turnId: "turn-1",
      payload: {
        stage: "response-planning"
      }
    })
    socket.emit({
      type: "projection",
      timestamp: "2026-03-12T00:00:03.000Z",
      sessionId: "session-1",
      turnId: "turn-1",
      payload: {
        type: "respond",
        payload: {
          text: "Answer",
          mode: "answer"
        }
      }
    })
    socket.emit({
      type: "turn.done",
      timestamp: "2026-03-12T00:00:04.000Z",
      sessionId: "session-1",
      turnId: "turn-1",
      payload: {
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
      expect.objectContaining({ type: "projection", turnId: "turn-1" })
    )
    expect(onTurnDone).toHaveBeenCalledWith(expect.objectContaining({ type: "turn.done", turnId: "turn-1" }))
    expect(phases).toEqual(expect.arrayContaining(["opening-session", "sending-intent", "ready"]))

    await transport.sendIntent({
      intent: createIntent("Follow up"),
      activeTabId: 17,
      snapshot
    })

    expect(issueToken).toHaveBeenCalledTimes(1)
    expect(sockets).toHaveLength(1)
    expect(parseSent(socket).map((event) => event.type)).toEqual([
      "session.open",
      "context.update",
      "snapshot.push",
      "user.intent",
      "context.update",
      "snapshot.push",
      "user.intent"
    ])
  })

  it("returns enrich results to the runtime and advances enrich phases", async () => {
    const sockets: FakeWebSocket[] = []
    const phases: string[] = []
    const enrichResult: ContextEnrichResultPayload = {
      requestKind: "node-detail",
      targetRef: {
        kind: "semantic-node",
        nodeId: "node-1"
      },
      status: "ok",
      capturedAt: "2026-03-12T00:00:05.000Z",
      detail: {
        text: "More detail"
      }
    }

    const transport = new SessionWsTransport({
      apiBaseUrl: "https://api.example.com",
      authClient: {
        issueToken: vi.fn(async () => ({
          token: "auth-token",
          expiresAt: 1_799_999_999,
          user: { id: "user-1" }
        }))
      },
      handlers: {
        onPhaseChange(phase) {
          phases.push(phase)
        },
        async onEnrichRequest() {
          return enrichResult
        }
      },
      webSocketFactory(url) {
        const socket = new FakeWebSocket(url)
        sockets.push(socket)
        return socket
      }
    })

    const sendPromise = transport.sendIntent({
      intent: createIntent("Inspect this node"),
      activeTabId: 17,
      snapshot
    })
    await Promise.resolve()
    const socket = sockets[0]!
    socket.open()
    resolveSession(socket)
    await sendPromise

    socket.emit({
      type: "context.enrich.request",
      timestamp: "2026-03-12T00:00:06.000Z",
      sessionId: "session-1",
      turnId: "turn-1",
      payload: {
        requestKind: "node-detail",
        targetRef: {
          kind: "semantic-node",
          nodeId: "node-1"
        },
        reason: "Need more detail",
        timeoutMs: 1_000
      }
    })

    await Promise.resolve()

    const sent = parseSent(socket)
    const enrichEnvelope = sent.find((event) => event.type === "context.enrich.result")
    expect(enrichEnvelope).toMatchObject({
      type: "context.enrich.result",
      sessionId: "session-1",
      turnId: "turn-1",
      payload: enrichResult
    })
    expect(phases).toEqual(expect.arrayContaining(["waiting-enrich", "resuming-turn"]))
  })

  it("drops stale enrich results after the active turn changes", async () => {
    const sockets: FakeWebSocket[] = []
    let resolveEnrich: (result: ContextEnrichResultPayload) => void = () => {
      throw new Error("enrich resolver was not captured")
    }

    const transport = new SessionWsTransport({
      apiBaseUrl: "https://api.example.com",
      authClient: {
        issueToken: vi.fn(async () => ({
          token: "auth-token",
          expiresAt: 1_799_999_999,
          user: { id: "user-1" }
        }))
      },
      handlers: {
        onPhaseChange: vi.fn(),
        onEnrichRequest: vi.fn(
          () =>
            new Promise<ContextEnrichResultPayload>((resolve) => {
              resolveEnrich = resolve
            })
        )
      },
      webSocketFactory(url) {
        const socket = new FakeWebSocket(url)
        sockets.push(socket)
        return socket
      }
    })

    const sendPromise = transport.sendIntent({
      intent: createIntent("Inspect this node"),
      activeTabId: 17,
      snapshot
    })
    await Promise.resolve()
    const socket = sockets[0]!
    socket.open()
    resolveSession(socket)
    await sendPromise

    socket.emit({
      type: "context.enrich.request",
      timestamp: "2026-03-12T00:00:06.000Z",
      sessionId: "session-1",
      turnId: "turn-1",
      payload: {
        requestKind: "node-detail",
        targetRef: {
          kind: "semantic-node",
          nodeId: "node-1"
        },
        reason: "Need more detail",
        timeoutMs: 1_000
      }
    })

    await Promise.resolve()

    socket.emit({
      type: "progress",
      timestamp: "2026-03-12T00:00:07.000Z",
      sessionId: "session-1",
      turnId: "turn-2",
      payload: {
        stage: "intent-routed"
      }
    })

    resolveEnrich({
      requestKind: "node-detail",
      targetRef: {
        kind: "semantic-node",
        nodeId: "node-1"
      },
      status: "ok",
      capturedAt: "2026-03-12T00:00:08.000Z",
      detail: {
        text: "Too late"
      }
    })

    await Promise.resolve()
    await Promise.resolve()

    expect(parseSent(socket).find((event) => event.type === "context.enrich.result")).toBeUndefined()
  })
})
