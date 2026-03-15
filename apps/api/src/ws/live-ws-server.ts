import type { IncomingMessage } from "node:http"
import type { Socket } from "node:net"
import { WebSocketServer } from "ws"
import type { RawData, WebSocket } from "ws"
import { createLogger } from "../runtime/logger"
import { RuntimeManager } from "../session/runtime/manager"
import { LiveSessionRelay, isLiveClientEnvelope } from "../live/live-session-relay"
import {
  authenticateUpgradeRequest,
  type AuthenticatedUpgradeRequest,
  parseRequestUrl,
  rejectUpgrade
} from "./ws-upgrade-auth"

const logger = createLogger("ws/live")

function rawDataToText(raw: RawData): string | null {
  if (typeof raw === "string") {
    return raw
  }

  if (Buffer.isBuffer(raw)) {
    return raw.toString("utf8")
  }

  if (raw instanceof ArrayBuffer) {
    return Buffer.from(raw).toString("utf8")
  }

  if (Array.isArray(raw)) {
    return Buffer.concat(raw).toString("utf8")
  }

  return null
}

function makeErrorEnvelope(message: string, code: "INVALID_EVENT" | "UNAUTHORIZED" | "LIVE_CONNECT_FAILED") {
  return JSON.stringify({
    type: "live.error",
    timestamp: new Date().toISOString(),
    payload: {
      code,
      message,
      recoverable: code !== "UNAUTHORIZED"
    }
  })
}

export function attachLiveWebSocketServer(
  server: import("node:http").Server,
  runtime: RuntimeManager
): void {
  const wss = new WebSocketServer({ noServer: true })

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const principalUserId = (req as AuthenticatedUpgradeRequest).authContext?.principalUserId ?? null
    if (!principalUserId) {
      ws.send(makeErrorEnvelope("missing authenticated websocket context", "UNAUTHORIZED"))
      ws.close()
      return
    }

    logger.info("live-ws-connection-opened", {
      principalUserId
    })

    const relay = new LiveSessionRelay({
      ws,
      runtime,
      principalUserId,
      onCloseSocket: () => ws.close()
    })

    ws.on("message", (chunk) => {
      void (async () => {
        const text = rawDataToText(chunk)
        if (!text) {
          ws.send(makeErrorEnvelope("invalid live envelope", "INVALID_EVENT"))
          return
        }

        let parsed: unknown
        try {
          parsed = JSON.parse(text)
        } catch {
          ws.send(makeErrorEnvelope("invalid live envelope", "INVALID_EVENT"))
          return
        }

        if (!isLiveClientEnvelope(parsed)) {
          ws.send(makeErrorEnvelope("invalid live envelope", "INVALID_EVENT"))
          return
        }

        try {
          await relay.handleClientEnvelope(parsed)
        } catch (error) {
          logger.error("live-ws-message-handling-failed", {
            principalUserId,
            error
          })
          ws.send(
            makeErrorEnvelope(
              error instanceof Error ? error.message : "live websocket message handling failed",
              "LIVE_CONNECT_FAILED"
            )
          )
        }
      })()
    })

    ws.on("close", () => {
      logger.info("live-ws-connection-closed", {
        principalUserId
      })
      relay.close()
    })
  })

  server.on("upgrade", async (req: IncomingMessage, socket: Socket, head: Buffer) => {
    try {
      const parsedUrl = parseRequestUrl(req)
      if (!parsedUrl) {
        rejectUpgrade(socket, 400, "invalid request url")
        return
      }

      if (parsedUrl.pathname !== "/ws/live") {
        return
      }

      const authResult = await authenticateUpgradeRequest(req, "/ws/live")
      if (!authResult.ok) {
        logger.warn("live-ws-upgrade-rejected", {
          code: authResult.code,
          reason: authResult.reason
        })
        rejectUpgrade(socket, authResult.code, authResult.reason)
        return
      }

      const upgradedRequest = req as AuthenticatedUpgradeRequest
      upgradedRequest.authContext = authResult.context

      wss.handleUpgrade(upgradedRequest, socket, head, (ws) => {
        wss.emit("connection", ws, upgradedRequest)
      })
    } catch (error) {
      logger.error("live-ws-upgrade-auth-error", {
        error
      })
      rejectUpgrade(socket, 500, "internal auth error")
    }
  })
}
