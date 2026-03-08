import request from "supertest"
import { afterEach, describe, expect, it, vi } from "vitest"
import { WebSocket as NodeWebSocket } from "ws"
import { createServer } from "../../src/server"
import { requireEnv } from "../helpers/env"
import {
  createContextUpdatePayload,
  createEnvelope,
  createSessionOpenPayload,
  createUserIntentPayload,
  createValidSnapshot
} from "./helpers/ws-contract"

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
    }, 2000)

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
    }, 3000)

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

async function issueToken(client: request.SuperTest<request.Test>, bootstrapSubject: string): Promise<string> {
  const response = await client
    .post("/api/token")
    .set("X-Bootstrap-Key", requireEnv("AUTH_BOOTSTRAP_KEY"))
    .send({
      grantType: "dev-bootstrap",
      bootstrapSubject
    })

  expect(response.status).toBe(200)
  return response.body.token as string
}

describe("ws /ws/session flow contract (red)", () => {
  const servers: import("http").Server[] = []

  afterEach(async () => {
    while (servers.length > 0) {
      const server = servers.pop()
      if (server) {
        await closeServer(server)
      }
    }
  })

  it("emits session.ready/progress/projection/turn.done over canonical ws flow", async () => {
    const app = createServer()
    const httpServer = app.listen(0)
    servers.push(httpServer)
    const port = getPort(httpServer)

    const client = request(app)
    const token = await issueToken(client, "google-sub-ws-flow-alpha")

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
    expect(types).toContain("progress")
    expect(types).toContain("projection")
    expect(types).toContain("turn.done")

    ws.close()
  })

  it("keeps INVALID_SNAPSHOT semantics for snapshot binding mismatch on ws canonical path", async () => {
    const app = createServer()
    const httpServer = app.listen(0)
    servers.push(httpServer)
    const port = getPort(httpServer)

    const client = request(app)
    const token = await issueToken(client, "google-sub-ws-flow-beta")

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

    const messages = await waitForMessages(ws, 1)
    expect(messages[0]).toMatchObject({
      type: "error",
      payload: {
        code: "INVALID_SNAPSHOT"
      }
    })

    ws.close()
  })

  it("preserves error semantics parity between /ws/session and /ws/session/events", async () => {
    const app = createServer()
    const httpServer = app.listen(0)
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
