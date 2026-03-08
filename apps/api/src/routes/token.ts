import { Router, type RequestHandler } from "express"
import { issueAuthSession } from "../auth/auth-sessions-repository"
import {
  GoogleIdTokenUnauthorizedError,
  GoogleIdTokenVerifierUnavailableError,
  verifyGoogleIdToken
} from "../auth/google-id-token-verifier"
import { createLogger } from "../runtime/logger"
import { upsertGoogleIdentity } from "../auth/user-identities-repository"
import { findUserById, upsertUserFromBootstrapSubject } from "../auth/users-repository"

const router: ReturnType<typeof Router> = Router()
const logger = createLogger("routes/token")

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function getConfiguredBootstrapKey(): string | null {
  return normalizeText(process.env.AUTH_BOOTSTRAP_KEY)
}

function isBootstrapKeyAuthorized(value: unknown, configuredBootstrapKey: string): boolean {
  const provided = normalizeText(value)
  return Boolean(provided && provided === configuredBootstrapKey)
}

interface TokenRequestBody {
  grantType?: unknown
  bootstrapSubject?: unknown
  profile?: {
    displayName?: unknown
    primaryEmail?: unknown
    avatarUrl?: unknown
  }
  idToken?: unknown
}

interface UserPayload {
  id: string
  displayName?: string
  primaryEmail?: string
  avatarUrl?: string
}

function buildUserPayload(input: {
  id: string
  displayName?: string | null | undefined
  primaryEmail?: string | null | undefined
  avatarUrl?: string | null | undefined
}): UserPayload {
  const userPayload: UserPayload = {
    id: input.id
  }
  if (input.displayName) {
    userPayload.displayName = input.displayName
  }
  if (input.primaryEmail) {
    userPayload.primaryEmail = input.primaryEmail
  }
  if (input.avatarUrl) {
    userPayload.avatarUrl = input.avatarUrl
  }
  return userPayload
}

function readProfileFromRequest(body: TokenRequestBody): {
  displayName?: string
  primaryEmail?: string
  avatarUrl?: string
} {
  const profile: {
    displayName?: string
    primaryEmail?: string
    avatarUrl?: string
  } = {}
  const displayName = normalizeText(body.profile?.displayName)
  const primaryEmail = normalizeText(body.profile?.primaryEmail)
  const avatarUrl = normalizeText(body.profile?.avatarUrl)
  if (displayName) {
    profile.displayName = displayName
  }
  if (primaryEmail) {
    profile.primaryEmail = primaryEmail
  }
  if (avatarUrl) {
    profile.avatarUrl = avatarUrl
  }
  return profile
}

async function issueSessionResponse(
  req: Parameters<RequestHandler>[0],
  res: Parameters<RequestHandler>[1],
  user: UserPayload,
  grantType: "dev-bootstrap" | "google-id-token"
): Promise<void> {
  const issueInput: {
    userId: string
    clientKind: string
    userAgent?: string
  } = {
    userId: user.id,
    clientKind: "extension"
  }
  const userAgent = normalizeText(req.header("user-agent"))
  if (userAgent) {
    issueInput.userAgent = userAgent
  }

  const issued = await issueAuthSession(issueInput)
  logger.info("token-issued", {
    grantType,
    userId: user.id,
    clientKind: issueInput.clientKind
  })
  res.status(200).json({
    token: issued.token,
    expiresAt: issued.expiresAt,
    user
  })
}

const handleToken: RequestHandler = async (req, res) => {
  const body = req.body as TokenRequestBody
  const grantType = normalizeText(body?.grantType)

  if (grantType !== "dev-bootstrap" && grantType !== "google-id-token") {
    logger.warn("token-request-invalid-grant-type", {
      grantType: normalizeText(body?.grantType) ?? "missing"
    })
    res.status(400).json({
      code: "INVALID_EVENT",
      message: "unsupported grantType"
    })
    return
  }

  if (grantType === "google-id-token") {
    const idToken = normalizeText(body.idToken)
    if (!idToken) {
      logger.warn("token-request-missing-google-id-token")
      res.status(400).json({
        code: "INVALID_EVENT",
        message: "idToken is required"
      })
      return
    }
    try {
      logger.info("token-request-google-started")
      const verified = await verifyGoogleIdToken(idToken)
      const googleProfile: {
        displayName?: string
        primaryEmail?: string
        avatarUrl?: string
      } = {}
      if (verified.name) {
        googleProfile.displayName = verified.name
      }
      if (verified.email) {
        googleProfile.primaryEmail = verified.email
      }
      if (verified.picture) {
        googleProfile.avatarUrl = verified.picture
      }

      const googleIdentityInput: {
        providerSubject: string
        email?: string
        emailVerified?: boolean
        profile?: {
          displayName?: string
          primaryEmail?: string
          avatarUrl?: string
        }
        rawClaims: Record<string, unknown>
      } = {
        providerSubject: verified.sub,
        rawClaims: verified.rawClaims
      }
      if (verified.email) {
        googleIdentityInput.email = verified.email
      }
      if (verified.emailVerified !== undefined) {
        googleIdentityInput.emailVerified = verified.emailVerified
      }
      if (Object.keys(googleProfile).length > 0) {
        googleIdentityInput.profile = googleProfile
      }

      const identity = await upsertGoogleIdentity(googleIdentityInput)
      const user = await findUserById(identity.userId)
      if (!user) {
        throw new Error("failed to resolve user for verified google identity")
      }
      await issueSessionResponse(
        req,
        res,
        buildUserPayload({
          id: user.id,
          displayName: user.displayName,
          primaryEmail: user.primaryEmail,
          avatarUrl: user.avatarUrl
        }),
        "google-id-token"
      )
      return
    } catch (error) {
      logger.warn("token-request-google-failed", {
        error
      })
      if (error instanceof GoogleIdTokenUnauthorizedError) {
        res.status(401).json({
          code: "UNAUTHORIZED",
          message: "invalid google id token"
        })
        return
      }
      if (error instanceof GoogleIdTokenVerifierUnavailableError) {
        res.status(503).json({
          code: "SERVICE_UNAVAILABLE",
          message: "google id token verifier is unavailable"
        })
        return
      }
      res.status(500).json({
        code: "TOKEN_ISSUE_FAILED",
        message: "failed to issue token"
      })
      return
    }
  }

  const bootstrapSubject = normalizeText(body.bootstrapSubject)
  if (!bootstrapSubject) {
    logger.warn("token-request-missing-bootstrap-subject")
    res.status(400).json({
      code: "INVALID_EVENT",
      message: "bootstrapSubject is required"
    })
    return
  }

  const configuredBootstrapKey = getConfiguredBootstrapKey()
  if (!configuredBootstrapKey) {
    // 보안 경계: 부트스트랩 키가 없으면 토큰 발급 자체를 중단한다.
    logger.error("token-request-bootstrap-key-missing")
    res.status(503).json({
      code: "SERVICE_UNAVAILABLE",
      message: "AUTH_BOOTSTRAP_KEY is not configured"
    })
    return
  }

  const bootstrapKey = req.header("x-bootstrap-key")
  // 보안 경계: 부트스트랩 키가 다르면 인증 주체 생성을 허용하지 않는다.
  if (!isBootstrapKeyAuthorized(bootstrapKey, configuredBootstrapKey)) {
    logger.warn("token-request-bootstrap-key-invalid", {
      bootstrapSubject
    })
    res.status(403).json({
      code: "FORBIDDEN",
      message: "invalid bootstrap key"
    })
    return
  }

  try {
    logger.info("token-request-bootstrap-started", {
      bootstrapSubject
    })
    const profile = readProfileFromRequest(body)
    const user = await upsertUserFromBootstrapSubject({
      bootstrapSubject,
      profile
    })
    // /api/token은 불투명 앱 세션 토큰을 발급하고 users.id를 인증 주체로 사용한다.
    await issueSessionResponse(
      req,
      res,
      buildUserPayload({
        id: user.id,
        displayName: user.displayName,
        primaryEmail: user.primaryEmail,
        avatarUrl: user.avatarUrl
      }),
      "dev-bootstrap"
    )
  } catch (error) {
    logger.error("token-request-bootstrap-failed", {
      bootstrapSubject,
      error
    })
    res.status(500).json({
      code: "TOKEN_ISSUE_FAILED",
      message: "failed to issue token"
    })
  }
}

router.post("/", handleToken)

export default router
