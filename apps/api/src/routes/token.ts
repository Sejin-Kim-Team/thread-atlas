import { Router, type RequestHandler } from "express"
import { issueAuthSession } from "../auth/auth-sessions-repository"
import { upsertUserFromBootstrapSubject } from "../auth/users-repository"

const router: ReturnType<typeof Router> = Router()

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
  userId?: unknown
  bootstrapSubject?: unknown
  profile?: {
    displayName?: unknown
    primaryEmail?: unknown
    avatarUrl?: unknown
  }
  provider?: unknown
  idToken?: unknown
}

const handleToken: RequestHandler = async (req, res) => {
  const body = req.body as TokenRequestBody
  const grantType = normalizeText(body?.grantType)
  const legacyUserId = normalizeText(body?.userId)

  // 해커톤 범위에서는 구글 식별 토큰 검증 경로를 아직 열지 않는다.
  if (grantType === "google-id-token") {
    res.status(501).json({
      code: "NOT_IMPLEMENTED",
      message: "google id token verification is not implemented yet"
    })
    return
  }

  if (grantType !== "dev-bootstrap" && !(grantType === null && legacyUserId)) {
    res.status(400).json({
      code: "INVALID_EVENT",
      message: "unsupported grantType"
    })
    return
  }

  let bootstrapSubject: string | null = null

  if (grantType === "dev-bootstrap") {
    const configuredBootstrapKey = getConfiguredBootstrapKey()
    if (!configuredBootstrapKey) {
      // 보안 경계: 부트스트랩 키가 없으면 토큰 발급 자체를 중단한다.
      res.status(503).json({
        code: "SERVICE_UNAVAILABLE",
        message: "AUTH_BOOTSTRAP_KEY is not configured"
      })
      return
    }

    const bootstrapKey = req.header("x-bootstrap-key")
    // 보안 경계: 부트스트랩 키가 다르면 인증 주체 생성을 허용하지 않는다.
    if (!isBootstrapKeyAuthorized(bootstrapKey, configuredBootstrapKey)) {
      res.status(403).json({
        code: "FORBIDDEN",
        message: "invalid bootstrap key"
      })
      return
    }

    bootstrapSubject = normalizeText(body?.bootstrapSubject)
    if (!bootstrapSubject) {
      res.status(400).json({
        code: "INVALID_EVENT",
        message: "bootstrapSubject is required"
      })
      return
    }
  } else {
    // 레거시 extension 호환 경로: `{ userId }` 입력을 임시로 수용한다.
    bootstrapSubject = legacyUserId
  }

  if (!bootstrapSubject) {
    res.status(400).json({
      code: "INVALID_EVENT",
      message: "bootstrapSubject is required"
    })
    return
  }

  try {
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

    const user = await upsertUserFromBootstrapSubject({
      bootstrapSubject,
      profile
    })
    // /api/token은 불투명 앱 세션 토큰을 발급하고 users.id를 인증 주체로 사용한다.
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

    const userPayload: {
      id: string
      displayName?: string
      primaryEmail?: string
      avatarUrl?: string
    } = {
      id: user.id
    }
    if (user.displayName) {
      userPayload.displayName = user.displayName
    }
    if (user.primaryEmail) {
      userPayload.primaryEmail = user.primaryEmail
    }
    if (user.avatarUrl) {
      userPayload.avatarUrl = user.avatarUrl
    }

    res.status(200).json({
      token: issued.token,
      expiresAt: issued.expiresAt,
      user: userPayload
    })
  } catch (error) {
    res.status(500).json({
      code: "TOKEN_ISSUE_FAILED",
      message: "failed to issue token"
    })
  }
}

router.post("/", handleToken)

export default router
