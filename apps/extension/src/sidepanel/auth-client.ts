import type {
  DevBootstrapTokenRequest,
  GoogleIdTokenTokenRequest,
  TokenGrantType,
  TokenRequest,
  TokenResponse
} from "@threadatlas/shared"

const AUTH_GRANT_TYPE_KEY = "THREADATLAS_AUTH_GRANT_TYPE"
const GOOGLE_ID_TOKEN_KEY = "THREADATLAS_GOOGLE_ID_TOKEN"
const BOOTSTRAP_SUBJECT_KEY = "THREADATLAS_BOOTSTRAP_SUBJECT"
const BOOTSTRAP_KEY_KEY = "THREADATLAS_AUTH_BOOTSTRAP_KEY"
const DISPLAY_NAME_KEY = "THREADATLAS_AUTH_DISPLAY_NAME"
const PRIMARY_EMAIL_KEY = "THREADATLAS_AUTH_PRIMARY_EMAIL"
const AVATAR_URL_KEY = "THREADATLAS_AUTH_AVATAR_URL"

type StorageLike = Pick<Storage, "getItem">

interface ResolvedTokenRequest {
  body: TokenRequest
  headers: Record<string, string>
}

export interface AuthClient {
  issueToken(): Promise<TokenResponse>
}

function normalizeText(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function readBootstrapProfile(
  storage: StorageLike
): DevBootstrapTokenRequest["profile"] | undefined {
  const displayName = normalizeText(storage.getItem(DISPLAY_NAME_KEY))
  const primaryEmail = normalizeText(storage.getItem(PRIMARY_EMAIL_KEY))
  const avatarUrl = normalizeText(storage.getItem(AVATAR_URL_KEY))

  if (!displayName && !primaryEmail && !avatarUrl) {
    return undefined
  }

  const profile: NonNullable<DevBootstrapTokenRequest["profile"]> = {}
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

function resolveConfiguredGrantType(storage: StorageLike): TokenGrantType | null {
  const configured = normalizeText(storage.getItem(AUTH_GRANT_TYPE_KEY))
  if (configured === "dev-bootstrap" || configured === "google-id-token") {
    return configured
  }
  return null
}

function resolveGoogleGrant(storage: StorageLike): GoogleIdTokenTokenRequest | null {
  const idToken = normalizeText(storage.getItem(GOOGLE_ID_TOKEN_KEY))
  if (!idToken) {
    return null
  }
  return {
    grantType: "google-id-token",
    idToken
  }
}

function resolveBootstrapGrant(storage: StorageLike): ResolvedTokenRequest | null {
  const bootstrapSubject = normalizeText(storage.getItem(BOOTSTRAP_SUBJECT_KEY))
  if (!bootstrapSubject) {
    return null
  }

  const bootstrapKey = normalizeText(storage.getItem(BOOTSTRAP_KEY_KEY))
  if (!bootstrapKey) {
    throw new Error(`Missing ${BOOTSTRAP_KEY_KEY} for dev-bootstrap token flow.`)
  }

  const body: DevBootstrapTokenRequest = {
    grantType: "dev-bootstrap",
    bootstrapSubject
  }
  const profile = readBootstrapProfile(storage)
  if (profile) {
    body.profile = profile
  }

  return {
    body,
    headers: {
      "X-Bootstrap-Key": bootstrapKey
    }
  }
}

function resolveTokenRequest(storage: StorageLike): ResolvedTokenRequest {
  const configuredGrant = resolveConfiguredGrantType(storage)
  const googleGrant = resolveGoogleGrant(storage)
  const bootstrapGrant = resolveBootstrapGrant(storage)

  if (configuredGrant === "google-id-token") {
    if (!googleGrant) {
      throw new Error(`Missing ${GOOGLE_ID_TOKEN_KEY} for google-id-token flow.`)
    }
    return {
      body: googleGrant,
      headers: {}
    }
  }

  if (configuredGrant === "dev-bootstrap") {
    if (!bootstrapGrant) {
      throw new Error(`Missing ${BOOTSTRAP_SUBJECT_KEY} for dev-bootstrap token flow.`)
    }
    return bootstrapGrant
  }

  if (googleGrant && bootstrapGrant) {
    throw new Error(
      `Both ${GOOGLE_ID_TOKEN_KEY} and ${BOOTSTRAP_SUBJECT_KEY} are configured. Set ${AUTH_GRANT_TYPE_KEY} to choose one.`
    )
  }

  if (googleGrant) {
    return {
      body: googleGrant,
      headers: {}
    }
  }

  if (bootstrapGrant) {
    return bootstrapGrant
  }

  throw new Error(
    `No auth provider configured. Set ${GOOGLE_ID_TOKEN_KEY} or ${BOOTSTRAP_SUBJECT_KEY}.`
  )
}

export function createAuthClient(args: {
  apiBaseUrl: string
  storage?: StorageLike
  fetchImpl?: typeof fetch
}): AuthClient {
  const storage = args.storage ?? window.localStorage
  const fetchImpl = args.fetchImpl ?? fetch

  return {
    async issueToken(): Promise<TokenResponse> {
      const resolved = resolveTokenRequest(storage)
      const response = await fetchImpl(`${args.apiBaseUrl}/api/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...resolved.headers
        },
        body: JSON.stringify(resolved.body)
      })

      if (!response.ok) {
        let message = `token request failed (${response.status})`
        try {
          const body = (await response.json()) as { message?: string; code?: string }
          message = body.message ?? body.code ?? message
        } catch {
          // Ignore JSON parse failures and keep the fallback error.
        }
        throw new Error(message)
      }

      return (await response.json()) as TokenResponse
    }
  }
}
