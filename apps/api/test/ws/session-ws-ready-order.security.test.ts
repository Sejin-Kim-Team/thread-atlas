import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, describe, expect, it, vi } from "vitest"
import { WebSocket as NodeWebSocket, type RawData } from "ws"
import type { RuntimeManager } from "../../src/session/runtime/manager"
import { attachSessionWebSocketServer } from "../../src/ws/session-ws-server"

const resolveAuthSessionMock = vi.hoisted(() =>
  vi.fn(async (token: string) => {
    if (token === "valid-token") {
      return {
        ok: true as const,
        userId: "user_ws_ready_order"
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

function waitForMessages(ws: NodeWebSocket, count: number, timeoutMs = 2000): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve, reject) => {
    const messages: Array<Record<string, unknown>> = []

    const onMessage = (raw: RawData) => {
      try {
        const parsed = JSON.parse(String(raw)) as Record<string, unknown>
        messages.push(parsed)
        if (messages.length >= count) {
          cleanup()
          resolve(messages)
        }
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

function createRuntimeMock(): RuntimeManager {
  const runtimeLike = {
    async handle(raw: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
      const envelope = raw as {
        type?: string
        sessionId?: string
      }
      const timestamp = "2026-03-08T13:00:00.000Z"

      if (envelope.type === "session.open") {
        return {
          status: 200,
          body: {
            type: "session.ready",
            timestamp,
            sessionId: "sess-ws-ready-order",
            payload: {
              sessionId: "sess-ws-ready-order",
              clientSessionId: "mock-client-session",
              reused: false
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
            turnId: "turn-ws-ready-order-1",
            events: [
              {
                type: "progress",
                timestamp,
                sessionId: envelope.sessionId,
                turnId: "turn-ws-ready-order-1",
                payload: {
                  stage: "response-planning"
                }
              },
              {
                type: "projection",
                timestamp,
                sessionId: envelope.sessionId,
                turnId: "turn-ws-ready-order-1",
                payload: {
                  kind: "present",
                  body: {
                    type: "answer",
                    text: "answer"
                  }
                }
              },
              {
                type: "projection",
                timestamp,
                sessionId: envelope.sessionId,
                turnId: "turn-ws-ready-order-1",
                payload: {
                  kind: "present",
                  body: {
                    type: "recall-card",
                    summary: "recall"
                  }
                }
              },
              {
                type: "turn.done",
                timestamp,
                sessionId: envelope.sessionId,
                turnId: "turn-ws-ready-order-1",
                payload: {
                  referencedTabIds: [128]
                }
              }
            ]
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

describe("ws session.ready ordering security contract (red)", () => {
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

  it("keeps session.ready observable within first 4 canonical flow messages", async () => {
    const runtime = createRuntimeMock()

    const server = createServer((_req, res) => {
      res.statusCode = 404
      res.end("not found")
    })
    attachSessionWebSocketServer(server, runtime)

    await new Promise<void>((resolve) => server.listen(0, () => resolve()))
    servers.push(server)

    const port = getPort(server)
    const ws = await connectNodeWebSocket(`ws://127.0.0.1:${port}/ws/session?token=valid-token`)

    try {
      // canonical flow 재현: open/context/snapshot/intent를 연속으로 밀어넣는다.
      ws.send(
        JSON.stringify({
          type: "session.open",
          requestId: "req-ready-order-open",
          timestamp: "2026-03-08T13:00:00.000Z",
          payload: {
            clientSessionId: "sidepanel-ready-order"
          }
        })
      )
      ws.send(
        JSON.stringify({
          type: "context.update",
          requestId: "req-ready-order-context",
          timestamp: "2026-03-08T13:00:01.000Z",
          payload: {
            tabId: 128,
            isPrimary: true
          }
        })
      )
      ws.send(
        JSON.stringify({
          type: "snapshot.push",
          requestId: "req-ready-order-snapshot",
          timestamp: "2026-03-08T13:00:02.000Z",
          payload: {
            tabId: 128,
            snapshot: {
              focus: {
                nodeId: "comment-1",
                node: {
                  id: "comment-1",
                  text: "focus"
                }
              },
              meta: {
                capturedAt: "2026-03-08T13:00:02.000Z"
              }
            }
          }
        })
      )
      ws.send(
        JSON.stringify({
          type: "user.intent",
          requestId: "req-ready-order-intent",
          timestamp: "2026-03-08T13:00:03.000Z",
          payload: {
            text: "summarize",
            primaryTabId: 128,
            boundSnapshotCapturedAt: "2026-03-08T13:00:02.000Z"
          }
        })
      )

      const firstFive = await waitForMessages(ws, 5)
      const types = firstFive.map((message) => String(message.type))
      const readyIndex = types.indexOf("session.ready")
      const turnDoneIndex = types.indexOf("turn.done")

      // canonical 가시성 계약: session.ready는 후속 진행/종료 이벤트보다 먼저 관측되어야 한다.
      expect(readyIndex).toBe(0)
      expect(turnDoneIndex).toBeGreaterThan(readyIndex)
    } finally {
      ws.terminate()
    }
  })
})
