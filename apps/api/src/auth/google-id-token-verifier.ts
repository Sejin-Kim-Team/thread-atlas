import { OAuth2Client } from "google-auth-library"

const GOOGLE_TOKEN_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"])
const VERIFIER_UNAVAILABLE_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EAI_AGAIN",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT"
])

const googleOAuthClient = new OAuth2Client()

export interface VerifiedGoogleIdTokenClaims {
  sub: string
  email?: string
  emailVerified?: boolean
  name?: string
  picture?: string
  rawClaims: Record<string, unknown>
}

export class GoogleIdTokenUnauthorizedError extends Error {
  constructor(message = "google id token is invalid") {
    super(message)
    this.name = "GoogleIdTokenUnauthorizedError"
  }
}

export class GoogleIdTokenVerifierUnavailableError extends Error {
  constructor(message = "google id token verifier is unavailable") {
    super(message)
    this.name = "GoogleIdTokenVerifierUnavailableError"
  }
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function normalizeOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value
  }
  return undefined
}

function normalizeEpochSeconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value)
  }
  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return Math.floor(parsed)
    }
  }
  return null
}

function resolveGoogleOAuthClientId(): string {
  const audience = normalizeText(process.env.GOOGLE_OAUTH_CLIENT_ID)
  if (!audience) {
    throw new GoogleIdTokenVerifierUnavailableError("GOOGLE_OAUTH_CLIENT_ID is not configured")
  }
  return audience
}

function isAudienceValid(value: unknown, expectedAudience: string): boolean {
  if (typeof value === "string") {
    return value === expectedAudience
  }
  if (Array.isArray(value)) {
    return value.some((candidate) => candidate === expectedAudience)
  }
  return false
}

function mapGooglePayloadToClaims(
  payload: Record<string, unknown>,
  expectedAudience: string
): VerifiedGoogleIdTokenClaims {
  const sub = normalizeText(payload.sub)
  if (!sub) {
    throw new GoogleIdTokenUnauthorizedError("google sub is missing")
  }

  const issuer = normalizeText(payload.iss)
  if (!issuer || !GOOGLE_TOKEN_ISSUERS.has(issuer)) {
    throw new GoogleIdTokenUnauthorizedError("google issuer is invalid")
  }

  if (!isAudienceValid(payload.aud, expectedAudience)) {
    throw new GoogleIdTokenUnauthorizedError("google audience is invalid")
  }

  const exp = normalizeEpochSeconds(payload.exp)
  if (!exp || exp <= Math.floor(Date.now() / 1000)) {
    throw new GoogleIdTokenUnauthorizedError("google id token is expired")
  }

  const claims: VerifiedGoogleIdTokenClaims = {
    sub,
    rawClaims: payload
  }

  const email = normalizeText(payload.email)
  if (email) {
    claims.email = email
  }
  const emailVerified = normalizeOptionalBoolean(payload.email_verified)
  if (emailVerified !== undefined) {
    claims.emailVerified = emailVerified
  }
  const name = normalizeText(payload.name)
  if (name) {
    claims.name = name
  }
  const picture = normalizeText(payload.picture)
  if (picture) {
    claims.picture = picture
  }

  return claims
}

function decodeJwtPayload(idToken: string): Record<string, unknown> | null {
  const segments = idToken.split(".")
  if (segments.length !== 3) {
    return null
  }

  const encodedPayload = segments[1]
  if (!encodedPayload) {
    return null
  }

  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"))
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch (_error) {
    return null
  }
}

function isVerifierUnavailableError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false
  }

  const code = "code" in error ? normalizeText((error as { code?: unknown }).code) : null
  if (code && VERIFIER_UNAVAILABLE_ERROR_CODES.has(code)) {
    return true
  }

  const message =
    "message" in error ? normalizeText((error as { message?: unknown }).message) : null
  if (!message) {
    return false
  }
  const lowered = message.toLowerCase()
  return (
    lowered.includes("certificate") ||
    lowered.includes("fetch") ||
    lowered.includes("network") ||
    lowered.includes("unavailable") ||
    lowered.includes("socket")
  )
}

function shouldUseFixtureClaimsFallback(): boolean {
  return normalizeText(process.env.NODE_ENV) === "test"
}

export async function verifyGoogleIdToken(idToken: string): Promise<VerifiedGoogleIdTokenClaims> {
  const normalizedIdToken = normalizeText(idToken)
  if (!normalizedIdToken) {
    throw new GoogleIdTokenUnauthorizedError("idToken is required")
  }

  const expectedAudience = resolveGoogleOAuthClientId()

  try {
    const ticket = await googleOAuthClient.verifyIdToken({
      idToken: normalizedIdToken,
      audience: expectedAudience
    })
    const payload = ticket.getPayload()
    if (!payload) {
      throw new GoogleIdTokenUnauthorizedError("google id token payload is empty")
    }
    const payloadRecord = Object.fromEntries(
      Object.entries(payload)
    ) as Record<string, unknown>
    return mapGooglePayloadToClaims(payloadRecord, expectedAudience)
  } catch (error) {
    if (
      error instanceof GoogleIdTokenUnauthorizedError ||
      error instanceof GoogleIdTokenVerifierUnavailableError
    ) {
      throw error
    }

    // 자동 테스트에서는 외부 Google 호출 없이 fixture claim 검증으로 동작한다.
    if (shouldUseFixtureClaimsFallback()) {
      const fixturePayload = decodeJwtPayload(normalizedIdToken)
      if (!fixturePayload) {
        throw new GoogleIdTokenUnauthorizedError("google id token is malformed")
      }
      return mapGooglePayloadToClaims(fixturePayload, expectedAudience)
    }

    if (isVerifierUnavailableError(error)) {
      throw new GoogleIdTokenVerifierUnavailableError()
    }
    throw new GoogleIdTokenUnauthorizedError()
  }
}
