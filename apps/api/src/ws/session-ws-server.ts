import type { IncomingMessage } from "node:http"
import type { Socket } from "node:net"
import { WebSocketServer } from "ws"
import type { WebSocket } from "ws"
import { resolveAuthSession } from "../auth/auth-sessions-repository"
import { RuntimeManager } from "../session/runtime/manager"

interface SocketContext {
  principalUserId: string
  sessionId: string | null
}

interface UpgradeAuthContext {
  principalUserId: string
}

interface AuthenticatedUpgradeRequest extends IncomingMessage {
  authContext?: UpgradeAuthContext
}

function sendUnauthorized(ws: WebSocket, message: string): void {
  ws.send(
    JSON.stringify({
      type: "error",
      payload: {
        code: "UNAUTHORIZED",
        message
      }
    })
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function parseEnvelope(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function parseRequestUrl(req: IncomingMessage): URL | null {
  const requestUrl = req.url ?? ""
  try {
    return new URL(requestUrl, "http://localhost")
  } catch {
    return null
  }
}

function parseAllowedOrigins(): string[] {
  const raw = process.env.WS_ALLOWED_ORIGINS
  if (!raw) {
    return []
  }
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
}

function rejectUpgrade(socket: Socket, statusCode: 400 | 401 | 403 | 404 | 500, reason: string): void {
  const statusTextByCode: Record<number, string> = {
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    500: "Internal Server Error"
  }
  // 보안 경계: handshake 단계에서 실패하면 WebSocket 연결을 성립시키지 않고 즉시 종료한다.
  socket.write(
    `HTTP/1.1 ${statusCode} ${statusTextByCode[statusCode]}\r\nConnection: close\r\n\r\n${reason}`
  )
  socket.destroy()
}

async function authenticateUpgradeRequest(
  req: IncomingMessage
): Promise<{ ok: true; context: UpgradeAuthContext } | { ok: false; code: 400 | 401 | 403 | 404; reason: string }> {
  const parsedUrl = parseRequestUrl(req)
  if (!parsedUrl) {
    return {
      ok: false,
      code: 400,
      reason: "invalid request url"
    }
  }

  if (parsedUrl.pathname !== "/ws/session") {
    return {
      ok: false,
      code: 404,
      reason: "invalid websocket path"
    }
  }

  const allowedOrigins = parseAllowedOrigins()
  const requestOrigin = req.headers.origin
  // 확장프로그램 런타임 호환: Origin 헤더가 없는 경우는 허용한다.
  if (allowedOrigins.length > 0 && typeof requestOrigin === "string") {
    if (!allowedOrigins.includes(requestOrigin)) {
      return {
        ok: false,
        code: 403,
        reason: "origin not allowed"
      }
    }
  }

  const token = parsedUrl.searchParams.get("token") ?? ""
  const auth = await resolveAuthSession(token)
  if (!auth.ok) {
    return {
      ok: false,
      code: 401,
      reason: "unauthorized"
    }
  }

  return {
    ok: true,
    context: {
      principalUserId: auth.userId
    }
  }
}

export function attachSessionWebSocketServer(
  server: import("node:http").Server,
  runtime: RuntimeManager
): void {
  const wss = new WebSocketServer({ noServer: true })

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const principalUserId = (req as AuthenticatedUpgradeRequest).authContext?.principalUserId ?? null

    if (!principalUserId) {
      sendUnauthorized(ws, "missing authenticated websocket context")
      ws.close()
      return
    }

    const context: SocketContext = {
      principalUserId,
      sessionId: null
    }
    let pendingInboundCount = 0
    let inboundQueue: Promise<void> = Promise.resolve()

    const processInbound = async (chunk: unknown): Promise<void> => {
      const envelope = parseEnvelope(String(chunk))
      if (!envelope) {
        ws.send(
          JSON.stringify({
            type: "error",
            payload: {
              code: "INVALID_EVENT",
              message: "invalid envelope"
            }
          })
        )
        return
      }

      // canonical WS 경로에서는 연결 단위 sessionId를 유지해 매 메시지에 재주입한다.
      if (context.sessionId && !envelope.sessionId) {
        envelope.sessionId = context.sessionId
      }

      const result = await runtime.handle(envelope, {
        principalUserId: context.principalUserId
      })

      if (result.status !== 200) {
        ws.send(JSON.stringify(result.body))
        return
      }

      const body = result.body
      const bodyType = isRecord(body) && typeof body.type === "string" ? body.type : ""

      if (bodyType === "session.ready") {
        const sessionId = typeof body.sessionId === "string" ? body.sessionId : null
        if (sessionId) {
          context.sessionId = sessionId
        }
        // lifecycle 보장을 위해 session.ready는 즉시 전송한다.
        ws.send(JSON.stringify(body))
        return
      }

      if (bodyType === "event.batch" && Array.isArray((body as { events?: unknown }).events)) {
        const events = (body as { events: unknown[] }).events
        for (const event of events) {
          ws.send(JSON.stringify(event))
        }
        return
      }

      // context.update/snapshot.push의 ack는 WS canonical flow에서 생략한다.
      if (bodyType === "ack") {
        return
      }

      ws.send(JSON.stringify(body))
    }

    ws.on("message", (chunk) => {
      pendingInboundCount += 1
      inboundQueue = inboundQueue
        .then(async () => {
          await processInbound(chunk)
        })
        .catch(() => {
          ws.send(
            JSON.stringify({
              type: "error",
              payload: {
                code: "INVALID_EVENT",
                message: "ws message handling failed"
              }
            })
          )
        })
        .finally(() => {
          pendingInboundCount -= 1
        })
    })
  })

  server.on("upgrade", async (req: IncomingMessage, socket: Socket, head: Buffer) => {
    try {
      const authResult = await authenticateUpgradeRequest(req)
      if (!authResult.ok) {
        rejectUpgrade(socket, authResult.code, authResult.reason)
        return
      }

      // 핸드셰이크를 통과한 연결만 인증 컨텍스트를 주입해 런타임으로 전달한다.
      const upgradedRequest = req as AuthenticatedUpgradeRequest
      upgradedRequest.authContext = authResult.context

      wss.handleUpgrade(upgradedRequest, socket, head, (ws) => {
        wss.emit("connection", ws, upgradedRequest)
      })
    } catch {
      rejectUpgrade(socket, 500, "internal auth error")
    }
  })
}
