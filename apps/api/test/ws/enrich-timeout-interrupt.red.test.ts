import { createServer as createHttpServer } from "node:http"
import { afterEach, describe, expect, it, vi } from "vitest"
import { WebSocket as NodeWebSocket, type RawData } from "ws"
import type { RuntimeManager } from "../../src/session/runtime/manager"
import { attachSessionWebSocketServer } from "../../src/ws/session-ws-server"

vi.mock("../../src/auth/auth-sessions-repository", () => ({
  resolveAuthSession: vi.fn(async (token: string) => {
    if (token === "valid-ws-token") {
      return {
        ok: true as const,
        userId: "user_timeout_interrupt"
      }
    }
    return {
      ok: false as const
    }
  })
}))

function getPort(server: import("http").Server): number {
  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("server port is not available")
  }
  return address.port
}

function closeServer(server: import("http").Server): Promise<void> {
  return new Promise((resolve) => {
    const fallback = setTimeout(() => resolve(), 300)
    server.close(() => {
      clearTimeout(fallback)
      resolve()
    })
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

function waitForMessageType(ws: NodeWebSocket, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`ws ${type} timeout`))
    }, 2000)

    const onMessage = (data: RawData) => {
      try {
        const parsed = JSON.parse(String(data)) as Record<string, unknown>
        if (parsed.type === type) {
          clearTimeout(timer)
          ws.off("message", onMessage)
          resolve(parsed)
        }
      } catch {
        clearTimeout(timer)
        ws.off("message", onMessage)
        reject(new Error("invalid ws message json"))
      }
    }

    ws.on("message", onMessage)
    ws.once("error", () => {
      clearTimeout(timer)
      ws.off("message", onMessage)
      reject(new Error("ws receive failed"))
    })
  })
}

function waitForRequiredTypes(
  ws: NodeWebSocket,
  requiredTypes: string[],
  timeoutMs = 2000
): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve, reject) => {
    const collected: Array<Record<string, unknown>> = []
    const timer = setTimeout(() => {
      reject(new Error("ws required types timeout"))
    }, timeoutMs)

    const onMessage = (data: RawData) => {
      try {
        const parsed = JSON.parse(String(data)) as Record<string, unknown>
        collected.push(parsed)
      } catch {
        clearTimeout(timer)
        ws.off("message", onMessage)
        reject(new Error("invalid ws message json"))
        return
      }

      const currentTypes = new Set(collected.map((message) => String(message.type)))
      const satisfied = requiredTypes.every((type) => currentTypes.has(type))
      if (satisfied) {
        clearTimeout(timer)
        ws.off("message", onMessage)
        resolve(collected)
      }
    }

    ws.on("message", onMessage)
    ws.once("error", () => {
      clearTimeout(timer)
      ws.off("message", onMessage)
      reject(new Error("ws receive failed"))
    })
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface RuntimeLike {
  handle: (raw: unknown, context: { principalUserId: string }) => Promise<{
    status: 200 | 400
    body: Record<string, unknown>
  }>
}

class TimeoutRuntimeStub implements RuntimeLike {
  readonly sessionId = "sess-timeout-red"
  readonly turnId = "turn-timeout-red"
  timeoutEnvelopeCallCount = 0

  async handle(
    raw: unknown,
    _context: { principalUserId: string }
  ): Promise<{ status: 200 | 400; body: Record<string, unknown> }> {
    const envelope = raw as Record<string, unknown>
    const type = String(envelope.type)
    const requestId = typeof envelope.requestId === "string" ? envelope.requestId : ""

    if (requestId.startsWith(`req-enrich-timeout-${this.turnId}`)) {
      this.timeoutEnvelopeCallCount += 1
      return {
        status: 200,
        body: {
          type: "event.batch",
          requestId,
          sessionId: this.sessionId,
          turnId: this.turnId,
          timestamp: "2026-03-08T13:00:09.000Z",
          events: [
            {
              type: "progress",
              turnId: this.turnId,
              sessionId: this.sessionId,
              timestamp: "2026-03-08T13:00:09.000Z",
              payload: {
                stage: "response-planning"
              }
            },
            {
              type: "projection",
              turnId: this.turnId,
              sessionId: this.sessionId,
              timestamp: "2026-03-08T13:00:09.000Z",
              payload: {
                kind: "present",
                body: {
                  type: "answer",
                  text: "timeout fallback answer",
                  responseMode: "answer",
                  provenanceSummary: ["current-page"]
                }
              }
            },
            {
              type: "turn.done",
              turnId: this.turnId,
              sessionId: this.sessionId,
              timestamp: "2026-03-08T13:00:09.000Z",
              payload: {
                referencedTabIds: [128]
              }
            }
          ]
        }
      }
    }

    if (type === "session.open") {
      return {
        status: 200,
        body: {
          type: "session.ready",
          requestId: envelope.requestId,
          sessionId: this.sessionId,
          timestamp: "2026-03-08T13:00:00.000Z",
          payload: {
            protocolVersion: 1,
            sessionId: this.sessionId
          }
        }
      }
    }

    if (type === "user.intent") {
      return {
        status: 200,
        body: {
          type: "event.batch",
          requestId: envelope.requestId,
          sessionId: this.sessionId,
          turnId: this.turnId,
          timestamp: "2026-03-08T13:00:01.000Z",
          events: [
            {
              type: "context.enrich.request",
              turnId: this.turnId,
              sessionId: this.sessionId,
              timestamp: "2026-03-08T13:00:01.000Z",
              payload: {
                requestKind: "visible-region",
                targetRef: {
                  kind: "region",
                  pageUrl: "about:blank",
                  region: "focus-node-region"
                },
                timeoutMs: 50
              }
            }
          ]
        }
      }
    }

    if (type === "interrupt") {
      return {
        status: 200,
        body: {
          type: "ack",
          requestId: envelope.requestId,
          sessionId: this.sessionId,
          timestamp: "2026-03-08T13:00:02.000Z",
          payload: {
            ok: true
          }
        }
      }
    }

    if (type === "context.enrich.result") {
      return {
        status: 400,
        body: {
          type: "error",
          payload: {
            code: "INVALID_EVENT",
            message: "invalid context.enrich.result payload"
          }
        }
      }
    }

    return {
      status: 200,
      body: {
        type: "ack",
        requestId: envelope.requestId,
        sessionId: this.sessionId,
        timestamp: "2026-03-08T13:00:03.000Z",
        payload: {
          ok: true
        }
      }
    }
  }
}

describe("ws enrich timeout timer contract (red)", () => {
  const servers: import("http").Server[] = []

  afterEach(async () => {
    while (servers.length > 0) {
      const server = servers.pop()
      if (server) {
        await closeServer(server)
      }
    }
  })

  it("keeps timeout fallback armed after invalid context.enrich.result with turnId", async () => {
    const runtime = new TimeoutRuntimeStub()
    const server = createHttpServer((_req, res) => {
      res.statusCode = 200
      res.end("ok")
    })
    attachSessionWebSocketServer(server, runtime as unknown as RuntimeManager)
    server.listen(0)
    servers.push(server)

    const ws = await connectNodeWebSocket(`ws://127.0.0.1:${getPort(server)}/ws/session?token=valid-ws-token`)

    ws.send(
      JSON.stringify({
        type: "session.open",
        requestId: "req-timeout-invalid-open",
        timestamp: "2026-03-08T13:00:00.000Z",
        payload: {
          clientSessionId: "client-timeout-invalid"
        }
      })
    )
    await waitForMessageType(ws, "session.ready")

    ws.send(
      JSON.stringify({
        type: "user.intent",
        requestId: "req-timeout-invalid-intent",
        timestamp: "2026-03-08T13:00:01.000Z",
        payload: {
          text: "trigger enrich timeout path",
          primaryTabId: 128,
          boundSnapshotCapturedAt: "2026-03-08T13:00:01.000Z"
        }
      })
    )
    await waitForMessageType(ws, "context.enrich.request")

    const invalidErrorPromise = waitForMessageType(ws, "error")
    const fallbackPromise = waitForRequiredTypes(ws, ["projection", "turn.done"], 1200)

    ws.send(
      JSON.stringify({
        type: "context.enrich.result",
        requestId: "req-timeout-invalid-result",
        timestamp: "2026-03-08T13:00:02.000Z",
        turnId: runtime.turnId,
        payload: {
          requestKind: "visible-region",
          targetRef: {
            kind: "region",
            pageUrl: "about:blank",
            region: "focus-node-region"
          },
          status: "ok"
        }
      })
    )

    const invalidError = await invalidErrorPromise
    const fallbackMessages = await fallbackPromise

    expect((invalidError.payload as { code?: string } | undefined)?.code).toBe("INVALID_EVENT")
    const fallbackTypes = fallbackMessages.map((message) => message.type)
    expect(fallbackTypes).toContain("projection")
    expect(fallbackTypes).toContain("turn.done")
    expect(runtime.timeoutEnvelopeCallCount).toBe(1)
    ws.close()
  })

  it("clears enrich timeout timer on interrupt so timeout envelope is not executed later", async () => {
    const runtime = new TimeoutRuntimeStub()
    const server = createHttpServer((_req, res) => {
      res.statusCode = 200
      res.end("ok")
    })
    attachSessionWebSocketServer(server, runtime as unknown as RuntimeManager)
    server.listen(0)
    servers.push(server)

    const ws = await connectNodeWebSocket(`ws://127.0.0.1:${getPort(server)}/ws/session?token=valid-ws-token`)

    ws.send(
      JSON.stringify({
        type: "session.open",
        requestId: "req-timeout-interrupt-open",
        timestamp: "2026-03-08T13:10:00.000Z",
        payload: {
          clientSessionId: "client-timeout-interrupt"
        }
      })
    )
    await waitForMessageType(ws, "session.ready")

    ws.send(
      JSON.stringify({
        type: "user.intent",
        requestId: "req-timeout-interrupt-intent",
        timestamp: "2026-03-08T13:10:01.000Z",
        payload: {
          text: "trigger enrich then interrupt",
          primaryTabId: 128,
          boundSnapshotCapturedAt: "2026-03-08T13:10:01.000Z"
        }
      })
    )
    await waitForMessageType(ws, "context.enrich.request")

    ws.send(
      JSON.stringify({
        type: "interrupt",
        requestId: "req-timeout-interrupt",
        timestamp: "2026-03-08T13:10:02.000Z",
        payload: {
          reason: "user-stop"
        }
      })
    )

    await sleep(150)
    expect(runtime.timeoutEnvelopeCallCount).toBe(0)
    ws.close()
  })
})
