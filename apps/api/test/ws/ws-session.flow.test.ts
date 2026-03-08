import express from "express"
import request from "supertest"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WebSocket as NodeWebSocket } from "ws"
import { createWsSessionEventsRouter } from "../../src/routes/ws-session-events"
import { RuntimeManager } from "../../src/session/runtime/manager"
import { attachSessionWebSocketServer } from "../../src/ws/session-ws-server"
import {
  createContextUpdatePayload,
  createEnvelope,
  createSessionOpenPayload,
  createUserIntentPayload,
  createValidSnapshot
} from "./helpers/ws-contract"

const { issuedTokens } = vi.hoisted(() => ({
  issuedTokens: new Map<string, string>()
}))

vi.mock("../../src/auth/principal", () => ({
  resolvePrincipalFromAuthorizationHeader: vi.fn(async (authorization: unknown) => {
    if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
      return {
        ok: false as const,
        message: "unauthorized"
      }
    }
    const token = authorization.slice("Bearer ".length)
    const userId = issuedTokens.get(token)
    if (!userId) {
      return {
        ok: false as const,
        message: "unauthorized"
      }
    }
    return {
      ok: true as const,
      userId
    }
  })
}))

vi.mock("../../src/auth/auth-sessions-repository", () => ({
  resolveAuthSession: vi.fn(async (token: string) => {
    const userId = issuedTokens.get(token)
    if (!userId) {
      return { ok: false as const }
    }
    return { ok: true as const, userId }
  })
}))

vi.mock("../../src/services/gemini", () => ({
  createGeminiClient: () => ({
    // transport 계약 테스트는 외부 모델 지연/가용성에 영향받지 않도록 고정 응답으로 격리한다.
    generateText: vi.fn(async () => "GENAI_WS_SESSION_FLOW_ANSWER")
  }),
  isModelConfigError: () => false
}))

function getPort(server: import("http").Server): number {
  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("server port is not available")
  }
  return address.port
}

function closeServer(server: import("http").Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

function connectWebSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const timer = setTimeout(() => {
      ws.close()
      reject(new Error("ws open timeout"))
    }, 5000)

    ws.addEventListener("open", () => {
      clearTimeout(timer)
      resolve(ws)
    })

    ws.addEventListener("error", () => {
      clearTimeout(timer)
      reject(new Error("ws open failed"))
    })
  })
}

function waitForMessages(ws: WebSocket, count: number): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve, reject) => {
    const collected: Array<Record<string, unknown>> = []
    const timer = setTimeout(() => {
      reject(new Error("ws messages timeout"))
    }, 10000)

    ws.addEventListener("message", (event) => {
      try {
        collected.push(JSON.parse(String(event.data)) as Record<string, unknown>)
      } catch {
        clearTimeout(timer)
        reject(new Error("invalid ws message json"))
        return
      }

      if (collected.length >= count) {
        clearTimeout(timer)
        resolve(collected)
      }
    })

    ws.addEventListener("error", () => {
      clearTimeout(timer)
      reject(new Error("ws receive failed"))
    }, { once: true })
  })
}

function waitForRequiredTypes(
  ws: WebSocket,
  requiredTypes: string[],
  timeoutMs = 10000
): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve, reject) => {
    const collected: Array<Record<string, unknown>> = []
    const timer = setTimeout(() => {
      reject(new Error("ws required types timeout"))
    }, timeoutMs)

    ws.addEventListener("message", (event) => {
      try {
        collected.push(JSON.parse(String(event.data)) as Record<string, unknown>)
      } catch {
        clearTimeout(timer)
        reject(new Error("invalid ws message json"))
        return
      }

      const currentTypes = new Set(collected.map((message) => String(message.type)))
      const satisfied = requiredTypes.every((type) => currentTypes.has(type))
      if (satisfied) {
        clearTimeout(timer)
        resolve(collected)
      }
    })

    ws.addEventListener("error", () => {
      clearTimeout(timer)
      reject(new Error("ws receive failed"))
    }, { once: true })
  })
}

function expectHandshakeRejected(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new NodeWebSocket(url)
    const timer = setTimeout(() => {
      ws.close()
      reject(new Error("handshake was not rejected before timeout"))
    }, 500)

    ws.once("open", () => {
      clearTimeout(timer)
      ws.close()
      reject(new Error("handshake unexpectedly accepted"))
    })

    ws.once("unexpected-response", () => {
      clearTimeout(timer)
      resolve()
    })

    ws.once("error", () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

function createCanonicalHarness(): { app: express.Express; server: import("http").Server } {
  const app = express()
  const manager = new RuntimeManager()
  app.use(express.json({ limit: "2mb" }))
  app.use("/ws/session/events", createWsSessionEventsRouter(manager))
  const server = app.listen(0)
  attachSessionWebSocketServer(server, manager)
  return { app, server }
}

function issueToken(bootstrapSubject: string): string {
  const token = `test-token-${Math.random().toString(16).slice(2)}`
  issuedTokens.set(token, `user-${bootstrapSubject}`)
  return token
}

describe("ws /ws/session flow contract (red)", () => {
  const servers: import("http").Server[] = []

  beforeEach(() => {
    process.env.GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT ?? "threadatlas"
    process.env.GOOGLE_CLOUD_LOCATION = process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1"
    issuedTokens.clear()
  })

  afterEach(async () => {
    while (servers.length > 0) {
      const server = servers.pop()
      if (server) {
        await closeServer(server)
      }
    }
  }, 30000)

  it("emits session.ready/progress/projection/turn.done over canonical ws flow", async () => {
    const harness = createCanonicalHarness()
    const httpServer = harness.server
    servers.push(httpServer)
    const port = getPort(httpServer)

    const token = issueToken("google-sub-ws-flow-alpha")

    const ws = await connectWebSocket(`ws://127.0.0.1:${port}/ws/session?token=${token}`)

    ws.send(
      JSON.stringify({
        type: "session.open",
        requestId: "req-flow-open",
        timestamp: "2026-03-08T00:00:00.000Z",
        payload: createSessionOpenPayload()
      })
    )

    ws.send(
      JSON.stringify({
        type: "context.update",
        requestId: "req-flow-context",
        timestamp: "2026-03-08T00:00:01.000Z",
        payload: createContextUpdatePayload(128)
      })
    )

    ws.send(
      JSON.stringify({
        type: "snapshot.push",
        requestId: "req-flow-snapshot",
        timestamp: "2026-03-08T00:00:02.000Z",
        payload: {
          tabId: 128,
          snapshot: createValidSnapshot("2026-03-08T00:00:02.000Z")
        }
      })
    )

    ws.send(
      JSON.stringify({
        type: "user.intent",
        requestId: "req-flow-intent",
        timestamp: "2026-03-08T00:00:03.000Z",
        payload: createUserIntentPayload(128, "2026-03-08T00:00:02.000Z")
      })
    )

    const messages = await waitForMessages(ws, 4)
    const types = messages.map((message) => message.type)

    expect(types).toContain("session.ready")
    expect(types.filter((type) => type === "session.ready")).toHaveLength(1)
    expect(types[0]).toBe("session.ready")
    expect(types).toContain("progress")
    expect(types).toContain("projection")
    expect(types).toContain("turn.done")
    expect(types).not.toContain("ack")

    ws.close()
  }, 20000)

  it("keeps INVALID_SNAPSHOT semantics for snapshot binding mismatch on ws canonical path", async () => {
    const harness = createCanonicalHarness()
    const httpServer = harness.server
    servers.push(httpServer)
    const port = getPort(httpServer)

    const token = issueToken("google-sub-ws-flow-beta")

    const ws = await connectWebSocket(`ws://127.0.0.1:${port}/ws/session?token=${token}`)

    ws.send(
      JSON.stringify({
        type: "session.open",
        requestId: "req-bind-open",
        timestamp: "2026-03-08T00:00:00.000Z",
        payload: createSessionOpenPayload()
      })
    )

    ws.send(
      JSON.stringify({
        type: "context.update",
        requestId: "req-bind-context",
        timestamp: "2026-03-08T00:00:01.000Z",
        payload: createContextUpdatePayload(128)
      })
    )

    ws.send(
      JSON.stringify({
        type: "snapshot.push",
        requestId: "req-bind-snapshot",
        timestamp: "2026-03-08T00:00:02.000Z",
        payload: {
          tabId: 128,
          snapshot: createValidSnapshot("2026-03-08T00:00:02.000Z")
        }
      })
    )

    ws.send(
      JSON.stringify({
        type: "user.intent",
        requestId: "req-bind-intent",
        timestamp: "2026-03-08T00:00:03.000Z",
        payload: createUserIntentPayload(128, "2026-03-08T00:00:09.000Z")
      })
    )

    const messages = await waitForRequiredTypes(ws, ["session.ready", "error"])
    const invalidSnapshotError = messages.find((message) => message.type === "error")
    expect(invalidSnapshotError).toMatchObject({
      type: "error",
      payload: {
        code: "INVALID_SNAPSHOT"
      }
    })

    ws.close()
  })

  it("links enrich sub-loop on canonical ws path and resumes turn with context.enrich.result", async () => {
    const harness = createCanonicalHarness()
    const httpServer = harness.server
    servers.push(httpServer)
    const port = getPort(httpServer)

    const token = issueToken("google-sub-ws-flow-enrich")

    const ws = await connectWebSocket(`ws://127.0.0.1:${port}/ws/session?token=${token}`)

    ws.send(
      JSON.stringify({
        type: "session.open",
        requestId: "req-enrich-open",
        timestamp: "2026-03-08T00:10:00.000Z",
        payload: createSessionOpenPayload()
      })
    )

    ws.send(
      JSON.stringify({
        type: "context.update",
        requestId: "req-enrich-context",
        timestamp: "2026-03-08T00:10:01.000Z",
        payload: createContextUpdatePayload(128)
      })
    )

    ws.send(
      JSON.stringify({
        type: "snapshot.push",
        requestId: "req-enrich-snapshot",
        timestamp: "2026-03-08T00:10:02.000Z",
        payload: {
          tabId: 128,
          snapshot: createValidSnapshot("2026-03-08T00:10:02.000Z")
        }
      })
    )

    ws.send(
      JSON.stringify({
        type: "user.intent",
        requestId: "req-enrich-intent",
        timestamp: "2026-03-08T00:10:03.000Z",
        payload: {
          ...createUserIntentPayload(128, "2026-03-08T00:10:02.000Z"),
          text: "이 차트 영역을 더 자세히 확인해서 설명해줘."
        }
      })
    )

    const waitingMessages = await waitForRequiredTypes(ws, [
      "session.ready",
      "progress",
      "context.enrich.request"
    ])

    const enrichRequest = waitingMessages.find(
      (message) => message.type === "context.enrich.request"
    ) as { turnId?: string } | undefined
    const turnId = enrichRequest?.turnId
    expect(turnId).toBeDefined()

    ws.send(
      JSON.stringify({
        type: "context.enrich.result",
        requestId: "req-enrich-result",
        timestamp: "2026-03-08T00:10:04.000Z",
        turnId,
        payload: {
          requestKind: "visible-region",
          targetRef: {
            kind: "region",
            pageUrl: "https://news.ycombinator.com/item?id=43210000",
            region: "focus-node-region"
          },
          status: "ok",
          capturedAt: "2026-03-08T00:10:04.000Z",
          detail: {
            text: "chart detail"
          }
        }
      })
    )

    const resumedMessages = await waitForRequiredTypes(ws, ["progress", "projection", "turn.done"])
    const resumedTypes = resumedMessages.map((message) => message.type)
    expect(resumedTypes).toContain("turn.done")

    ws.close()
  }, 20000)

  it("falls back on canonical ws path when enrich result does not arrive before timeout", async () => {
    const harness = createCanonicalHarness()
    const httpServer = harness.server
    servers.push(httpServer)
    const port = getPort(httpServer)

    const token = issueToken("google-sub-ws-flow-enrich-timeout")

    const ws = await connectWebSocket(`ws://127.0.0.1:${port}/ws/session?token=${token}`)

    ws.send(
      JSON.stringify({
        type: "session.open",
        requestId: "req-enrich-timeout-open",
        timestamp: "2026-03-08T00:20:00.000Z",
        payload: createSessionOpenPayload()
      })
    )

    ws.send(
      JSON.stringify({
        type: "context.update",
        requestId: "req-enrich-timeout-context",
        timestamp: "2026-03-08T00:20:01.000Z",
        payload: createContextUpdatePayload(128)
      })
    )

    ws.send(
      JSON.stringify({
        type: "snapshot.push",
        requestId: "req-enrich-timeout-snapshot",
        timestamp: "2026-03-08T00:20:02.000Z",
        payload: {
          tabId: 128,
          snapshot: createValidSnapshot("2026-03-08T00:20:02.000Z")
        }
      })
    )

    ws.send(
      JSON.stringify({
        type: "user.intent",
        requestId: "req-enrich-timeout-intent",
        timestamp: "2026-03-08T00:20:03.000Z",
        payload: {
          ...createUserIntentPayload(128, "2026-03-08T00:20:02.000Z"),
          text: "이 차트 영역을 더 자세히 확인해서 설명해줘."
        }
      })
    )

    await waitForRequiredTypes(ws, ["context.enrich.request"])
    const fallbackMessages = await waitForRequiredTypes(ws, ["projection", "turn.done"], 12000)
    const fallbackTypes = fallbackMessages.map((message) => message.type)

    expect(fallbackTypes).toContain("turn.done")
    ws.close()
  }, 20000)

  it("keeps timeout fallback alive after rejecting invalid context.enrich.result", async () => {
    const harness = createCanonicalHarness()
    const httpServer = harness.server
    servers.push(httpServer)
    const port = getPort(httpServer)

    const token = issueToken("google-sub-ws-flow-enrich-invalid-result")

    const ws = await connectWebSocket(`ws://127.0.0.1:${port}/ws/session?token=${token}`)

    ws.send(
      JSON.stringify({
        type: "session.open",
        requestId: "req-enrich-invalid-open",
        timestamp: "2026-03-08T00:30:00.000Z",
        payload: createSessionOpenPayload()
      })
    )

    ws.send(
      JSON.stringify({
        type: "context.update",
        requestId: "req-enrich-invalid-context",
        timestamp: "2026-03-08T00:30:01.000Z",
        payload: createContextUpdatePayload(128)
      })
    )

    ws.send(
      JSON.stringify({
        type: "snapshot.push",
        requestId: "req-enrich-invalid-snapshot",
        timestamp: "2026-03-08T00:30:02.000Z",
        payload: {
          tabId: 128,
          snapshot: createValidSnapshot("2026-03-08T00:30:02.000Z")
        }
      })
    )

    ws.send(
      JSON.stringify({
        type: "user.intent",
        requestId: "req-enrich-invalid-intent",
        timestamp: "2026-03-08T00:30:03.000Z",
        payload: {
          ...createUserIntentPayload(128, "2026-03-08T00:30:02.000Z"),
          text: "이 차트 영역을 더 자세히 확인해서 설명해줘."
        }
      })
    )

    const waitingMessages = await waitForRequiredTypes(ws, ["context.enrich.request"])
    const enrichRequest = waitingMessages.find(
      (message) => message.type === "context.enrich.request"
    ) as { turnId?: string } | undefined
    const turnId = enrichRequest?.turnId
    expect(turnId).toBeDefined()

    ws.send(
      JSON.stringify({
        type: "context.enrich.result",
        requestId: "req-enrich-invalid-result",
        timestamp: "2026-03-08T00:30:04.000Z",
        turnId,
        payload: {
          requestKind: "visible-region",
          targetRef: {
            kind: "region",
            pageUrl: "https://news.ycombinator.com/item?id=43210000",
            region: "focus-node-region"
          },
          status: "ok"
        }
      })
    )

    const recoveryMessages = await waitForRequiredTypes(ws, ["error", "projection", "turn.done"], 12000)
    const hasInvalidEventError = recoveryMessages.some(
      (message) =>
        message.type === "error" &&
        typeof message.payload === "object" &&
        message.payload !== null &&
        (message.payload as { code?: string }).code === "INVALID_EVENT"
    )
    const recoveryTypes = recoveryMessages.map((message) => message.type)

    expect(hasInvalidEventError).toBe(true)
    expect(recoveryTypes).toContain("projection")
    expect(recoveryTypes).toContain("turn.done")
    ws.close()
  }, 25000)

  it("preserves error semantics parity between /ws/session and /ws/session/events", async () => {
    const harness = createCanonicalHarness()
    const app = harness.app
    const httpServer = harness.server
    servers.push(httpServer)
    const port = getPort(httpServer)

    const httpResponse = await request(app)
      .post("/ws/session/events")
      .set("Authorization", "Bearer invalid-token")
      .send(
        createEnvelope("session.open", createSessionOpenPayload(), {
          requestId: "req-http-invalid-auth"
        })
      )

    expect(httpResponse.status).toBe(401)
    expect(httpResponse.body?.payload?.code).toBe("UNAUTHORIZED")

    await expectHandshakeRejected("ws://127.0.0.1:" + port + "/ws/session?token=invalid-token")
  })
})
