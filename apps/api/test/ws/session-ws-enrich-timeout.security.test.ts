import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, describe, expect, it, vi } from "vitest"
import { WebSocket as NodeWebSocket } from "ws"
import type { RuntimeManager } from "../../src/session/runtime/manager"
import { attachSessionWebSocketServer } from "../../src/ws/session-ws-server"

const resolveAuthSessionMock = vi.hoisted(() =>
  vi.fn(async (token: string) => {
    if (token === "valid-token") {
      return {
        ok: true as const,
        userId: "user_ws_timeout"
      }
    }
    return {
      ok: false as const,
      message: "unauthorized"
    }
  })
)

vi.mock("../../src/auth/auth-sessions-repository", () => ({
  resolveAuthSession: resolveAuthSessionMock
}))

interface RuntimeMockState {
  timeoutInjectedCount: number
  interruptCount: number
}

function getPort(server: Server): number {
  const address = server.address() as AddressInfo | null
  if (!address) {
    throw new Error("server address is unavailable")
  }
  return address.port
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if ("closeAllConnections" in server && typeof server.closeAllConnections === "function") {
      server.closeAllConnections()
    }
    if ("closeIdleConnections" in server && typeof server.closeIdleConnections === "function") {
      server.closeIdleConnections()
    }
    server.close(() => resolve())
  })
}

function connectNodeWebSocket(url: string): Promise<NodeWebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new NodeWebSocket(url)
    const timer = setTimeout(() => {
      ws.terminate()
      reject(new Error("ws open timeout"))
    }, 2000)

    ws.once("open", () => {
      clearTimeout(timer)
      resolve(ws)
    })

    ws.once("error", () => {
      clearTimeout(timer)
      reject(new Error("ws open failed"))
    })
  })
}

function waitForMessage(
  ws: NodeWebSocket,
  predicate: (message: Record<string, unknown>) => boolean,
  timeoutMs = 1500
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: NodeWebSocket.RawData) => {
      try {
        const parsed = JSON.parse(String(data)) as Record<string, unknown>
        if (!predicate(parsed)) {
          return
        }
        cleanup()
        resolve(parsed)
      } catch {
        cleanup()
        reject(new Error("invalid ws message json"))
      }
    }

    const onError = () => {
      cleanup()
      reject(new Error("ws receive failed"))
    }

    const timer = setTimeout(() => {
      cleanup()
      reject(new Error("ws message timeout"))
    }, timeoutMs)

    const cleanup = () => {
      clearTimeout(timer)
      ws.off("message", onMessage)
      ws.off("error", onError)
    }

    ws.on("message", onMessage)
    ws.once("error", onError)
  })
}

function createRuntimeMock(state: RuntimeMockState): RuntimeManager {
  const runtimeLike = {
    async handle(raw: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
      const envelope = raw as {
        type?: string
        sessionId?: string
        turnId?: string
        requestId?: string
        payload?: Record<string, unknown>
      }
      const timestamp = "2026-03-08T12:00:00.000Z"

      if (envelope.type === "session.open") {
        return {
          status: 200,
          body: {
            type: "session.ready",
            timestamp,
            sessionId: "sess-ws-timeout",
            payload: {
              protocolVersion: 1,
              sessionId: "sess-ws-timeout"
            }
          }
        }
      }

      if (envelope.type === "user.intent") {
        return {
          status: 200,
          body: {
            type: "event.batch",
            timestamp,
            sessionId: envelope.sessionId,
            turnId: "turn-ws-timeout-1",
            events: [
              {
                type: "progress",
                timestamp,
                sessionId: envelope.sessionId,
                turnId: "turn-ws-timeout-1",
                payload: {
                  stage: "enrich-requested"
                }
              },
              {
                type: "context.enrich.request",
                timestamp,
                sessionId: envelope.sessionId,
                turnId: "turn-ws-timeout-1",
                payload: {
                  requestKind: "visible-region",
                  targetRef: {
                    kind: "region",
                    pageUrl: "https://news.ycombinator.com/item?id=43210000",
                    region: "focus-node-region"
                  },
                  timeoutMs: 40,
                  visibility: "status-only"
                }
              }
            ]
          }
        }
      }

      if (envelope.type === "interrupt") {
        state.interruptCount += 1
        return {
          status: 200,
          body: {
            type: "ack",
            timestamp,
            sessionId: envelope.sessionId,
            payload: {
              ok: true
            }
          }
        }
      }

      if (envelope.type === "context.enrich.result") {
        if (String(envelope.requestId ?? "").startsWith("req-enrich-timeout-")) {
          state.timeoutInjectedCount += 1
          return {
            status: 200,
            body: {
              type: "event.batch",
              timestamp,
              sessionId: envelope.sessionId,
              turnId: envelope.turnId,
              events: [
                {
                  type: "turn.done",
                  timestamp,
                  sessionId: envelope.sessionId,
                  turnId: envelope.turnId,
                  payload: {
                    referencedTabIds: [128]
                  }
                }
              ]
            }
          }
        }

        return {
          status: 400,
          body: {
            type: "error",
            payload: {
              code: "INVALID_EVENT",
              message: "binding mismatch"
            }
          }
        }
      }

      return {
        status: 200,
        body: {
          type: "ack",
          timestamp,
          sessionId: envelope.sessionId,
          payload: {
            ok: true
          }
        }
      }
    }
  }

  return runtimeLike as unknown as RuntimeManager
}

describe("ws enrich timeout security contract (red)", () => {
  const servers: Server[] = []

  afterEach(async () => {
    while (servers.length > 0) {
      const server = servers.pop()
      if (server) {
        await closeServer(server)
      }
    }
    resolveAuthSessionMock.mockClear()
  })

  it("does not neutralize timeout timer when invalid context.enrich.result arrives", async () => {
    const state: RuntimeMockState = {
      timeoutInjectedCount: 0,
      interruptCount: 0
    }
    const runtime = createRuntimeMock(state)

    const server = createServer((_req, res) => {
      res.statusCode = 404
      res.end("not found")
    })
    attachSessionWebSocketServer(server, runtime)

    await new Promise<void>((resolve) => server.listen(0, () => resolve()))
    servers.push(server)

    const port = getPort(server)
    let ws: NodeWebSocket | null = null
    try {
      ws = await connectNodeWebSocket(`ws://127.0.0.1:${port}/ws/session?token=valid-token`)

      ws.send(
        JSON.stringify({
          type: "session.open",
          requestId: "req-ws-timeout-open",
          timestamp: "2026-03-08T12:00:00.000Z",
          payload: {
            clientSessionId: "sidepanel-ws-timeout"
          }
        })
      )

      await waitForMessage(ws, (message) => message.type === "session.ready")

      ws.send(
        JSON.stringify({
          type: "user.intent",
          requestId: "req-ws-timeout-intent",
          timestamp: "2026-03-08T12:00:01.000Z",
          payload: {
            text: "추가 확인이 필요한지 알려줘"
          }
        })
      )

      await waitForMessage(ws, (message) => message.type === "context.enrich.request")

      ws.send(
        JSON.stringify({
          type: "context.enrich.result",
          requestId: "req-ws-timeout-invalid-result",
          turnId: "turn-ws-timeout-1",
          timestamp: "2026-03-08T12:00:02.000Z",
          payload: {
            requestKind: "node-detail",
            targetRef: {
              kind: "semantic-node",
              nodeId: "wrong-node"
            },
            status: "ok",
            capturedAt: "2026-03-08T12:00:02.000Z",
            detail: {
              text: "wrong"
            }
          }
        })
      )

      const invalidError = await waitForMessage(
        ws,
        (message) =>
          message.type === "error" && (message.payload as { code?: string })?.code === "INVALID_EVENT"
      )
      expect(invalidError.type).toBe("error")

      const turnDone = await waitForMessage(ws, (message) => message.type === "turn.done", 1000)
      expect(turnDone.type).toBe("turn.done")
      expect(state.timeoutInjectedCount).toBe(1)
    } finally {
      ws?.terminate()
    }
  })

  it("clears enrich timeout timer when interrupt arrives", async () => {
    const state: RuntimeMockState = {
      timeoutInjectedCount: 0,
      interruptCount: 0
    }
    const runtime = createRuntimeMock(state)

    const server = createServer((_req, res) => {
      res.statusCode = 404
      res.end("not found")
    })
    attachSessionWebSocketServer(server, runtime)

    await new Promise<void>((resolve) => server.listen(0, () => resolve()))
    servers.push(server)

    const port = getPort(server)
    let ws: NodeWebSocket | null = null
    try {
      ws = await connectNodeWebSocket(`ws://127.0.0.1:${port}/ws/session?token=valid-token`)

      ws.send(
        JSON.stringify({
          type: "session.open",
          requestId: "req-ws-interrupt-open",
          timestamp: "2026-03-08T12:10:00.000Z",
          payload: {
            clientSessionId: "sidepanel-ws-interrupt"
          }
        })
      )
      await waitForMessage(ws, (message) => message.type === "session.ready")

      ws.send(
        JSON.stringify({
          type: "user.intent",
          requestId: "req-ws-interrupt-intent",
          timestamp: "2026-03-08T12:10:01.000Z",
          payload: {
            text: "추가 확인이 필요한지 알려줘"
          }
        })
      )

      await waitForMessage(ws, (message) => message.type === "context.enrich.request")

      ws.send(
        JSON.stringify({
          type: "interrupt",
          requestId: "req-ws-interrupt",
          timestamp: "2026-03-08T12:10:02.000Z",
          payload: {}
        })
      )

      await new Promise((resolve) => setTimeout(resolve, 120))
      expect(state.interruptCount).toBe(1)
      expect(state.timeoutInjectedCount).toBe(0)
    } finally {
      ws?.terminate()
    }
  })
})
