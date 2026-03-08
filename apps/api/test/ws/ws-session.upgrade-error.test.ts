import { createServer } from "node:http"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("../../src/auth/auth-sessions-repository", () => ({
  resolveAuthSession: vi.fn(async () => {
    throw new Error("db unavailable")
  })
}))

import { attachSessionWebSocketServer } from "../../src/ws/session-ws-server"
import type { RuntimeManager } from "../../src/session/runtime/manager"

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

    server.close(() => {
      clearTimeout(fallback)
      resolve()
    })
  })
}

describe("ws upgrade auth error handling", () => {
  const servers: import("http").Server[] = []

  afterEach(async () => {
    while (servers.length > 0) {
      const server = servers.pop()
      if (server) {
        await closeServer(server)
      }
    }
  })

  it("rejects handshake with 500 when auth lookup throws", async () => {
    const server = createServer((_req, res) => {
      res.statusCode = 404
      res.end("not found")
    })
    servers.push(server)

    attachSessionWebSocketServer(server, {
      handle: vi.fn()
    } as unknown as RuntimeManager)

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        resolve()
      })
    })

    const port = getPort(server)

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/session?token=any`)
      const timer = setTimeout(() => {
        ws.close()
        reject(new Error("handshake was not rejected before timeout"))
      }, 1000)

      let opened = false

      ws.addEventListener("open", () => {
        opened = true
        clearTimeout(timer)
        ws.close()
        reject(new Error("handshake unexpectedly accepted"))
      })

      ws.addEventListener("error", () => {
        clearTimeout(timer)
      })

      ws.addEventListener("close", () => {
        clearTimeout(timer)
        expect(opened).toBe(false)
        resolve()
      })
    })
  })
})
