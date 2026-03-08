import request from "supertest"
import { afterEach, describe, expect, it } from "vitest"
import { WebSocket as NodeWebSocket } from "ws"
import { createHttpServer, createServer } from "../../src/server"
import { requireEnv } from "../helpers/env"
import { createSessionOpenPayload } from "./helpers/ws-contract"

function getPort(server: import("http").Server): number {
  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("server port is not available")
  }
  return address.port
}

function closeServer(server: import("http").Server): Promise<void> {
  return new Promise((resolve) => {
    const fallback = setTimeout(() => {
      resolve()
    }, 300)

    if ("closeAllConnections" in server && typeof server.closeAllConnections === "function") {
      server.closeAllConnections()
    }
    if ("closeIdleConnections" in server && typeof server.closeIdleConnections === "function") {
      server.closeIdleConnections()
    }

    server.close((error) => {
      clearTimeout(fallback)
      if (error) {
        resolve()
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

function connectNodeWebSocket(
  url: string,
  options?: {
    headers?: Record<string, string>
  }
): Promise<NodeWebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new NodeWebSocket(url, options)
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

function expectHandshakeRejected(
  url: string,
  options?: {
    headers?: Record<string, string>
    timeoutMs?: number
  }
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new NodeWebSocket(url, options)
    const timeoutMs = options?.timeoutMs ?? 400
    const timer = setTimeout(() => {
      ws.terminate()
      reject(new Error("handshake was not rejected before timeout"))
    }, timeoutMs)

    ws.once("open", () => {
      clearTimeout(timer)
      ws.terminate()
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

function waitForMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("ws message timeout"))
    }, 2000)

    ws.addEventListener("message", (event) => {
      clearTimeout(timer)
      try {
        resolve(JSON.parse(String(event.data)) as Record<string, unknown>)
      } catch {
        reject(new Error("invalid ws message json"))
      }
    }, { once: true })

    ws.addEventListener("error", () => {
      clearTimeout(timer)
      reject(new Error("ws message failed"))
    }, { once: true })
  })
}

function waitForNodeMessage(ws: NodeWebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("ws message timeout"))
    }, 2000)

    ws.once("message", (data) => {
      clearTimeout(timer)
      try {
        resolve(JSON.parse(String(data)) as Record<string, unknown>)
      } catch {
        reject(new Error("invalid ws message json"))
      }
    })

    ws.once("error", () => {
      clearTimeout(timer)
      reject(new Error("ws message failed"))
    })
  })
}

describe("ws /ws/session handshake contract (red)", () => {
  const servers: import("http").Server[] = []
  const originalAllowedOrigins = process.env.WS_ALLOWED_ORIGINS

  afterEach(async () => {
    if (originalAllowedOrigins === undefined) {
      delete process.env.WS_ALLOWED_ORIGINS
    } else {
      process.env.WS_ALLOWED_ORIGINS = originalAllowedOrigins
    }

    while (servers.length > 0) {
      const server = servers.pop()
      if (server) {
        await closeServer(server)
      }
    }
  })

  it("accepts handshake with valid app token and allows first session.open event", async () => {
    const app = createServer()
    const httpServer = createHttpServer(app).listen(0)
    servers.push(httpServer)
    const port = getPort(httpServer)

    const client = request(app)
    const tokenResponse = await client
      .post("/api/token")
      .set("X-Bootstrap-Key", requireEnv("AUTH_BOOTSTRAP_KEY"))
      .send({
        grantType: "dev-bootstrap",
        bootstrapSubject: "google-sub-ws-canonical-alpha"
      })

    expect(tokenResponse.status).toBe(200)
    const token = tokenResponse.body.token as string

    const ws = await connectWebSocket(`ws://127.0.0.1:${port}/ws/session?token=${token}`)

    // canonical WS 경로에서는 open 직후 session.open을 보내면 session.ready를 받아야 한다.
    ws.send(
      JSON.stringify({
        type: "session.open",
        requestId: "req-ws-open-1",
        timestamp: "2026-03-08T00:00:00.000Z",
        payload: createSessionOpenPayload()
      })
    )

    const message = await waitForMessage(ws)
    expect(message.type).toBe("session.ready")
    ws.close()
  })

  it("accepts binary websocket payload that contains valid JSON envelope", async () => {
    const app = createServer()
    const httpServer = createHttpServer(app).listen(0)
    servers.push(httpServer)
    const port = getPort(httpServer)

    const client = request(app)
    const tokenResponse = await client
      .post("/api/token")
      .set("X-Bootstrap-Key", requireEnv("AUTH_BOOTSTRAP_KEY"))
      .send({
        grantType: "dev-bootstrap",
        bootstrapSubject: "google-sub-ws-binary-alpha"
      })

    expect(tokenResponse.status).toBe(200)
    const token = tokenResponse.body.token as string

    const ws = await connectNodeWebSocket(`ws://127.0.0.1:${port}/ws/session?token=${token}`)

    ws.send(
      Buffer.from(
        JSON.stringify({
          type: "session.open",
          requestId: "req-ws-open-binary-1",
          timestamp: "2026-03-08T00:00:00.000Z",
          payload: createSessionOpenPayload()
        })
      )
    )

    const message = await waitForNodeMessage(ws)
    expect(message.type).toBe("session.ready")
    ws.close()
  })

  it("rejects invalid token at handshake stage before websocket open", async () => {
    const app = createServer()
    const httpServer = createHttpServer(app).listen(0)
    servers.push(httpServer)
    const port = getPort(httpServer)

    await expectHandshakeRejected(`ws://127.0.0.1:${port}/ws/session?token=invalid-token`)
  })

  it("rejects upgrade for non-target websocket path immediately", async () => {
    const app = createServer()
    const httpServer = createHttpServer(app).listen(0)
    servers.push(httpServer)
    const port = getPort(httpServer)

    await expectHandshakeRejected(`ws://127.0.0.1:${port}/ws/not-session?token=invalid-token`)
  })

  it("rejects disallowed origin only when origin header is present", async () => {
    process.env.WS_ALLOWED_ORIGINS = "https://allowed.example"

    const app = createServer()
    const httpServer = createHttpServer(app).listen(0)
    servers.push(httpServer)
    const port = getPort(httpServer)

    const client = request(app)
    const tokenResponse = await client
      .post("/api/token")
      .set("X-Bootstrap-Key", requireEnv("AUTH_BOOTSTRAP_KEY"))
      .send({
        grantType: "dev-bootstrap",
        bootstrapSubject: "google-sub-ws-canonical-origin"
      })

    expect(tokenResponse.status).toBe(200)
    const token = tokenResponse.body.token as string

    await expectHandshakeRejected(`ws://127.0.0.1:${port}/ws/session?token=${token}`, {
      headers: {
        origin: "https://malicious.example"
      }
    })
  })

  it("does not require origin header for extension-style websocket clients", async () => {
    const app = createServer()
    const httpServer = createHttpServer(app).listen(0)
    servers.push(httpServer)
    const port = getPort(httpServer)

    const client = request(app)
    const tokenResponse = await client
      .post("/api/token")
      .set("X-Bootstrap-Key", requireEnv("AUTH_BOOTSTRAP_KEY"))
      .send({
        grantType: "dev-bootstrap",
        bootstrapSubject: "google-sub-ws-canonical-no-origin"
      })

    expect(tokenResponse.status).toBe(200)
    const token = tokenResponse.body.token as string

    const ws = await connectNodeWebSocket(`ws://127.0.0.1:${port}/ws/session?token=${token}`)
    ws.send(
      JSON.stringify({
        type: "session.open",
        requestId: "req-ws-open-no-origin",
        timestamp: "2026-03-08T00:00:00.000Z",
        payload: createSessionOpenPayload()
      })
    )
    const message = await waitForNodeMessage(ws)
    expect(message.type).toBe("session.ready")
    ws.close()
  })

  it("rejects session reuse when clientSessionId is same but principal differs", async () => {
    const app = createServer()
    const httpServer = createHttpServer(app).listen(0)
    servers.push(httpServer)
    const port = getPort(httpServer)

    const client = request(app)
    const alpha = await client
      .post("/api/token")
      .set("X-Bootstrap-Key", requireEnv("AUTH_BOOTSTRAP_KEY"))
      .send({
        grantType: "dev-bootstrap",
        bootstrapSubject: "google-sub-ws-canonical-beta"
      })

    const beta = await client
      .post("/api/token")
      .set("X-Bootstrap-Key", requireEnv("AUTH_BOOTSTRAP_KEY"))
      .send({
        grantType: "dev-bootstrap",
        bootstrapSubject: "google-sub-ws-canonical-gamma"
      })

    expect(alpha.status).toBe(200)
    expect(beta.status).toBe(200)

    const sharedClientSessionId = "sidepanel-shared-ws-001"

    const wsAlpha = await connectWebSocket(
      `ws://127.0.0.1:${port}/ws/session?token=${alpha.body.token as string}`
    )
    wsAlpha.send(
      JSON.stringify({
        type: "session.open",
        requestId: "req-ws-open-2",
        timestamp: "2026-03-08T00:00:00.000Z",
        payload: {
          clientSessionId: sharedClientSessionId
        }
      })
    )

    const ready = await waitForMessage(wsAlpha)
    expect(ready.type).toBe("session.ready")

    const wsBeta = await connectWebSocket(
      `ws://127.0.0.1:${port}/ws/session?token=${beta.body.token as string}`
    )
    wsBeta.send(
      JSON.stringify({
        type: "session.open",
        requestId: "req-ws-open-3",
        timestamp: "2026-03-08T00:00:00.000Z",
        payload: {
          clientSessionId: sharedClientSessionId
        }
      })
    )

    const denied = await waitForMessage(wsBeta)
    expect(denied).toMatchObject({
      type: "error",
      payload: {
        code: "UNAUTHORIZED"
      }
    })

    wsAlpha.close()
    wsBeta.close()
  })
})
