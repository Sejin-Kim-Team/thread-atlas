import type { IncomingMessage } from "node:http"
import type { Socket } from "node:net"
import { resolveAuthSession } from "../auth/auth-sessions-repository"

export interface UpgradeAuthContext {
  principalUserId: string
}

export interface AuthenticatedUpgradeRequest extends IncomingMessage {
  authContext?: UpgradeAuthContext
}

export function parseRequestUrl(req: IncomingMessage): URL | null {
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

export function rejectUpgrade(
  socket: Socket,
  statusCode: 400 | 401 | 403 | 404 | 500,
  reason: string
): void {
  const statusTextByCode: Record<number, string> = {
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    500: "Internal Server Error"
  }
  socket.write(
    `HTTP/1.1 ${statusCode} ${statusTextByCode[statusCode]}\r\nConnection: close\r\n\r\n${reason}`
  )
  socket.destroy()
}

export async function authenticateUpgradeRequest(
  req: IncomingMessage,
  expectedPath: string
): Promise<{ ok: true; context: UpgradeAuthContext } | { ok: false; code: 400 | 401 | 403; reason: string }> {
  const parsedUrl = parseRequestUrl(req)
  if (!parsedUrl) {
    return {
      ok: false,
      code: 400,
      reason: "invalid request url"
    }
  }

  if (parsedUrl.pathname !== expectedPath) {
    return {
      ok: false,
      code: 400,
      reason: "invalid websocket path"
    }
  }

  const allowedOrigins = parseAllowedOrigins()
  const requestOrigin = req.headers.origin
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
