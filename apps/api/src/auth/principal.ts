import crypto from "node:crypto"

const TOKEN_TTL_SECONDS = 600

interface PrincipalTokenRecord {
  userId: string
  expiresAt: number
}

const tokenStore = new Map<string, PrincipalTokenRecord>()

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function isValidUserId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

export function issuePrincipalToken(userId: unknown): {
  ok: true
  token: string
  expiresAt: number
} | {
  ok: false
  message: string
} {
  if (!isValidUserId(userId)) {
    return {
      ok: false,
      message: "userId is required"
    }
  }

  const expiresAt = nowSeconds() + TOKEN_TTL_SECONDS
  const token = `stub-${userId}-${crypto.randomBytes(8).toString("hex")}`
  tokenStore.set(token, {
    userId: userId.trim(),
    expiresAt
  })

  return {
    ok: true,
    token,
    expiresAt
  }
}

export function resolvePrincipalFromAuthorizationHeader(authorizationHeader: unknown): {
  ok: true
  userId: string
} | {
  ok: false
  message: string
} {
  if (typeof authorizationHeader !== "string") {
    return {
      ok: false,
      message: "authorization header is required"
    }
  }

  const [scheme, token] = authorizationHeader.split(" ")
  if (scheme !== "Bearer" || !token) {
    return {
      ok: false,
      message: "invalid authorization format"
    }
  }

  const record = tokenStore.get(token)
  if (!record) {
    return {
      ok: false,
      message: "invalid token"
    }
  }

  if (record.expiresAt <= nowSeconds()) {
    tokenStore.delete(token)
    return {
      ok: false,
      message: "token expired"
    }
  }

  return {
    ok: true,
    userId: record.userId
  }
}
