import type { IncomingMessage } from "node:http"
import type { Socket } from "node:net"
import { WebSocketServer } from "ws"
import type { RawData, WebSocket } from "ws"
import { resolveAuthSession } from "../auth/auth-sessions-repository"
import { createLogger } from "../runtime/logger"
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

interface PendingEnrichBinding {
  requestKind: string
  targetRef: Record<string, unknown>
}

const logger = createLogger("ws/session")

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

function parseEnvelope(raw: RawData): Record<string, unknown> | null {
  const text = rawDataToText(raw)
  if (!text) {
    return null
  }

  try {
    const parsed = JSON.parse(text) as unknown
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
      logger.warn("ws-connection-missing-auth-context")
      sendUnauthorized(ws, "missing authenticated websocket context")
      ws.close()
      return
    }
    logger.info("ws-connection-opened", {
      principalUserId
    })

    const context: SocketContext = {
      principalUserId,
      sessionId: null
    }
    let pendingInboundCount = 0
    let deferredSessionReady: Record<string, unknown> | null = null
    let inboundQueue: Promise<void> = Promise.resolve()
    const enrichTimeoutByTurnId = new Map<string, ReturnType<typeof setTimeout>>()
    const pendingEnrichBindingByTurnId = new Map<string, PendingEnrichBinding>()

    const flushDeferredReady = (force = false): void => {
      if ((!force && pendingInboundCount !== 0) || !deferredSessionReady) {
        return
      }
      ws.send(JSON.stringify(deferredSessionReady))
      deferredSessionReady = null
    }

    const clearEnrichTimeout = (turnId: string): void => {
      const handle = enrichTimeoutByTurnId.get(turnId)
      if (handle) {
        clearTimeout(handle)
      }
      enrichTimeoutByTurnId.delete(turnId)
      pendingEnrichBindingByTurnId.delete(turnId)
    }

    const clearAllEnrichTimeouts = (): void => {
      for (const handle of enrichTimeoutByTurnId.values()) {
        clearTimeout(handle)
      }
      enrichTimeoutByTurnId.clear()
      pendingEnrichBindingByTurnId.clear()
    }

    const emitRuntimeBody = (body: Record<string, unknown>): void => {
      const bodyType = isRecord(body) && typeof body.type === "string" ? body.type : ""
      logger.debug("ws-outbound-runtime-body", {
        principalUserId: context.principalUserId,
        sessionId: context.sessionId,
        type: bodyType || "unknown"
      })
      if (bodyType !== "session.ready" && deferredSessionReady) {
        // canonical WS flow 가시성: deferred session.ready가 후속 이벤트 배치 뒤로 밀리지 않게 선전송한다.
        flushDeferredReady(true)
      }

      if (bodyType === "session.ready") {
        const sessionId = typeof body.sessionId === "string" ? body.sessionId : null
        if (sessionId) {
          context.sessionId = sessionId
        }
        // 이벤트 순서를 안정화하기 위해 session.ready는 연결 큐 소진 시점에 전송한다.
        deferredSessionReady = body
        return
      }

      if (bodyType === "event.batch" && Array.isArray((body as { events?: unknown }).events)) {
        const events = (body as { events: unknown[] }).events
        for (const event of events) {
          ws.send(JSON.stringify(event))
          if (!isRecord(event)) {
            continue
          }
          const eventType = typeof event.type === "string" ? event.type : ""
          const eventTurnId = typeof event.turnId === "string" ? event.turnId : ""
          if (eventType === "turn.done" && eventTurnId) {
            clearEnrichTimeout(eventTurnId)
          }
          if (eventType === "context.enrich.request" && eventTurnId) {
            const payload = isRecord(event.payload) ? event.payload : null
            const timeoutMs =
              payload && typeof payload.timeoutMs === "number" && Number.isFinite(payload.timeoutMs)
                ? payload.timeoutMs
                : 3000
            const requestKind = payload && typeof payload.requestKind === "string" ? payload.requestKind : null
            const targetRef = payload && isRecord(payload.targetRef) ? payload.targetRef : null

            clearEnrichTimeout(eventTurnId)
            if (requestKind && targetRef) {
              pendingEnrichBindingByTurnId.set(eventTurnId, {
                requestKind,
                targetRef
              })
            }
            const handle = setTimeout(() => {
              pendingInboundCount += 1
              inboundQueue = inboundQueue
                .then(async () => {
                  if (!context.sessionId) {
                    return
                  }
                  const pendingBinding = pendingEnrichBindingByTurnId.get(eventTurnId)
                  // 상태 전이 보장: enrich 응답이 오지 않으면 timeout 이벤트를 주입해 fallback 경로를 강제한다.
                  const timeoutEnvelope = {
                    type: "context.enrich.result",
                    requestId: `req-enrich-timeout-${eventTurnId}`,
                    sessionId: context.sessionId,
                    turnId: eventTurnId,
                    timestamp: new Date().toISOString(),
                    payload: {
                      requestKind: pendingBinding?.requestKind ?? "visible-region",
                      targetRef: pendingBinding?.targetRef ?? {
                        kind: "region",
                        pageUrl: "about:blank",
                        region: "timeout-fallback"
                      },
                      status: "failed",
                      failureReason: "timeout",
                      capturedAt: new Date().toISOString()
                    }
                  }
                  const timeoutResult = await runtime.handle(timeoutEnvelope, {
                    principalUserId: context.principalUserId
                  })

                  if (timeoutResult.status !== 200) {
                    const errorCode = isRecord(timeoutResult.body.payload)
                      ? timeoutResult.body.payload.code
                      : null
                    if (errorCode === "INVALID_EVENT") {
                      return
                    }
                    ws.send(JSON.stringify(timeoutResult.body))
                    return
                  }

                  emitRuntimeBody(timeoutResult.body)
                })
                .catch(() => {
                  logger.error("ws-enrich-timeout-fallback-failed", {
                    principalUserId: context.principalUserId,
                    sessionId: context.sessionId,
                    turnId: eventTurnId
                  })
                  ws.send(
                    JSON.stringify({
                      type: "error",
                      payload: {
                        code: "INVALID_EVENT",
                        message: "enrich timeout fallback handling failed"
                      }
                    })
                  )
                })
                .finally(() => {
                  pendingInboundCount -= 1
                  flushDeferredReady()
                })
            }, Math.max(0, timeoutMs))

            enrichTimeoutByTurnId.set(eventTurnId, handle)
          }
        }
        return
      }

      // context.update/snapshot.push의 ack는 WS canonical flow에서 생략한다.
      if (bodyType === "ack") {
        return
      }

      ws.send(JSON.stringify(body))
    }
    const processInbound = async (chunk: RawData): Promise<void> => {
      const envelope = parseEnvelope(chunk)
      if (!envelope) {
        logger.warn("ws-invalid-envelope", {
          principalUserId: context.principalUserId,
          sessionId: context.sessionId
        })
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
      logger.debug("ws-inbound-envelope", {
        principalUserId: context.principalUserId,
        sessionId: context.sessionId,
        type: envelope.type,
        requestId: typeof envelope.requestId === "string" ? envelope.requestId : null,
        turnId: typeof envelope.turnId === "string" ? envelope.turnId : null
      })

      if (envelope.type === "interrupt") {
        // 중단 이벤트는 pending enrich 대기 상태를 즉시 폐기해야 한다.
        clearAllEnrichTimeouts()
      }

      // canonical WS 경로에서는 연결 단위 sessionId를 유지해 매 메시지에 재주입한다.
      if (context.sessionId && !envelope.sessionId) {
        envelope.sessionId = context.sessionId
      }

      const result = await runtime.handle(envelope, {
        principalUserId: context.principalUserId
      })

      if (result.status !== 200) {
        logger.warn("ws-runtime-rejected-envelope", {
          principalUserId: context.principalUserId,
          sessionId: context.sessionId,
          type: envelope.type,
          status: result.status
        })
        ws.send(JSON.stringify(result.body))
        return
      }

      if (envelope.type === "user.intent") {
        // user.intent가 런타임 유효성 검증을 통과한 경우에만 기존 enrich timeout을 정리한다.
        clearAllEnrichTimeouts()
      }

      if (envelope.type === "context.enrich.result" && typeof envelope.turnId === "string") {
        // 런타임 유효성 검증을 통과한 경우에만 timeout 타이머를 해제한다.
        clearEnrichTimeout(envelope.turnId)
      }
      emitRuntimeBody(result.body)
    }

    ws.on("message", (chunk) => {
      pendingInboundCount += 1
      inboundQueue = inboundQueue
        .then(async () => {
          await processInbound(chunk)
        })
        .catch((error) => {
          logger.error("ws-message-handling-failed", {
            principalUserId: context.principalUserId,
            sessionId: context.sessionId,
            error
          })
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
          flushDeferredReady()
        })
    })

    ws.on("close", () => {
      logger.info("ws-connection-closed", {
        principalUserId: context.principalUserId,
        sessionId: context.sessionId
      })
      clearAllEnrichTimeouts()
    })
  })

  server.on("upgrade", async (req: IncomingMessage, socket: Socket, head: Buffer) => {
    try {
      const authResult = await authenticateUpgradeRequest(req)
      if (!authResult.ok) {
        logger.warn("ws-upgrade-rejected", {
          code: authResult.code,
          reason: authResult.reason,
          path: parseRequestUrl(req)?.pathname ?? "unknown"
        })
        rejectUpgrade(socket, authResult.code, authResult.reason)
        return
      }

      // 핸드셰이크를 통과한 연결만 인증 컨텍스트를 주입해 런타임으로 전달한다.
      const upgradedRequest = req as AuthenticatedUpgradeRequest
      upgradedRequest.authContext = authResult.context
      logger.info("ws-upgrade-accepted", {
        principalUserId: authResult.context.principalUserId
      })

      wss.handleUpgrade(upgradedRequest, socket, head, (ws) => {
        wss.emit("connection", ws, upgradedRequest)
      })
    } catch (error) {
      logger.error("ws-upgrade-auth-error", {
        error
      })
      rejectUpgrade(socket, 500, "internal auth error")
    }
  })
}
