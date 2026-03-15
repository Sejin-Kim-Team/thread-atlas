import type {
  DevBootstrapTokenRequest,
  EnsureAuthSessionResponse,
  ExtensionAuthProvider,
  ExtensionAuthState,
  GoogleIdTokenTokenRequest,
  TokenResponse
} from "@threadatlas/shared"
import { loadExtensionConfig, type ExtensionConfig, type KeyValueStorage } from "../common/extension-config"

const AUTH_STATE_STORAGE_KEY = "THREADATLAS_AUTH_STATE"
const SESSION_RENEWAL_SAFETY_WINDOW_SECONDS = 5 * 60

interface PersistedAuthState extends ExtensionAuthState {}

type GoogleWebAuthFlowLauncher = (details: {
  url: string
  interactive: boolean
}) => Promise<string | undefined>

export interface ExtensionAuthManager {
  getState(): Promise<ExtensionAuthState>
  signInWithGoogle(): Promise<ExtensionAuthState>
  ensureAuthSession(): Promise<EnsureAuthSessionResponse>
  signOut(): Promise<ExtensionAuthState>
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function normalizeAuthState(value: unknown): PersistedAuthState | null {
  if (!value || typeof value !== "object") {
    return null
  }

  const candidate = value as Partial<PersistedAuthState>
  const status = candidate.status
  if (
    status !== "signed-out" &&
    status !== "signing-in" &&
    status !== "signed-in" &&
    status !== "refreshing" &&
    status !== "error"
  ) {
    return null
  }

  const provider =
    candidate.provider === "google" || candidate.provider === "dev-bootstrap"
      ? candidate.provider
      : null

  const user =
    candidate.user && typeof candidate.user === "object" && typeof candidate.user.id === "string"
      ? {
          id: candidate.user.id,
          ...(normalizeText(candidate.user.displayName) ? { displayName: normalizeText(candidate.user.displayName)! } : {}),
          ...(normalizeText(candidate.user.primaryEmail)
            ? { primaryEmail: normalizeText(candidate.user.primaryEmail)! }
            : {}),
          ...(normalizeText(candidate.user.avatarUrl) ? { avatarUrl: normalizeText(candidate.user.avatarUrl)! } : {})
        }
      : null

  const session =
    candidate.session &&
    typeof candidate.session === "object" &&
    typeof candidate.session.token === "string" &&
    typeof candidate.session.expiresAt === "number"
      ? {
          token: candidate.session.token,
          expiresAt: candidate.session.expiresAt
        }
      : null

  const errorMessage = normalizeText(candidate.errorMessage) ?? undefined

  return {
    status,
    provider,
    user,
    session,
    ...(errorMessage ? { errorMessage } : {})
  }
}

function createSignedOutState(errorMessage?: string): ExtensionAuthState {
  return {
    status: "signed-out",
    provider: null,
    user: null,
    session: null,
    ...(errorMessage ? { errorMessage } : {})
  }
}

function createErrorState(errorMessage: string, provider: ExtensionAuthProvider | null = "google"): ExtensionAuthState {
  return {
    status: "error",
    provider,
    user: null,
    session: null,
    errorMessage
  }
}

function isSessionFresh(expiresAt: number, nowMs: number): boolean {
  return expiresAt - Math.floor(nowMs / 1000) > SESSION_RENEWAL_SAFETY_WINDOW_SECONDS
}

function bufferToBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function randomBase64Url(length = 24): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bufferToBase64Url(bytes)
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const segments = token.split(".")
  if (segments.length !== 3) {
    return null
  }
  const payload = segments[1]
  if (!payload) {
    return null
  }

  try {
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/")
    const normalized = padded + "=".repeat((4 - (padded.length % 4 || 4)) % 4)
    const decoded = atob(normalized)
    const parsed = JSON.parse(decoded)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Ignore malformed payloads and let the caller handle the invalid token.
  }
  return null
}

function parseGoogleAuthRedirect(args: {
  redirectUrl: string
  expectedState: string
  expectedNonce: string
}): string {
  const url = new URL(args.redirectUrl)
  const params = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash)
  const error = normalizeText(params.get("error"))
  if (error) {
    if (error === "access_denied") {
      throw new Error("Google sign-in was cancelled.")
    }
    throw new Error(`Google sign-in failed (${error}).`)
  }

  const state = normalizeText(params.get("state"))
  if (!state || state !== args.expectedState) {
    throw new Error("Google sign-in returned an invalid state.")
  }

  const idToken = normalizeText(params.get("id_token"))
  if (!idToken) {
    throw new Error("Google sign-in did not return an ID token.")
  }

  const payload = decodeJwtPayload(idToken)
  const nonce = normalizeText(payload?.nonce)
  if (!nonce || nonce !== args.expectedNonce) {
    throw new Error("Google sign-in returned an invalid nonce.")
  }

  return idToken
}

function buildGoogleAuthorizeUrl(args: {
  clientId: string
  redirectUri: string
  state: string
  nonce: string
  interactive: boolean
}): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth")
  url.searchParams.set("client_id", args.clientId)
  url.searchParams.set("response_type", "id_token")
  url.searchParams.set("redirect_uri", args.redirectUri)
  url.searchParams.set("scope", "openid email profile")
  url.searchParams.set("state", args.state)
  url.searchParams.set("nonce", args.nonce)
  url.searchParams.set("prompt", args.interactive ? "select_account consent" : "none")
  url.searchParams.set("include_granted_scopes", "true")
  return url.toString()
}

async function readPersistedAuthState(storage: KeyValueStorage): Promise<PersistedAuthState> {
  const items = await storage.get([AUTH_STATE_STORAGE_KEY])
  const persisted = normalizeAuthState(items[AUTH_STATE_STORAGE_KEY])
  return persisted ?? createSignedOutState()
}

export function createExtensionAuthManager(args: {
  storage: KeyValueStorage
  fetchImpl?: typeof fetch
  launchWebAuthFlow?: GoogleWebAuthFlowLauncher
  getRedirectUrl?: (path?: string) => string
  loadConfig?: () => Promise<ExtensionConfig>
  now?: () => number
  broadcastAuthState?: (state: ExtensionAuthState) => void
}): ExtensionAuthManager {
  const fetchImpl = args.fetchImpl ?? fetch
  const launchWebAuthFlow =
    args.launchWebAuthFlow ??
    (async (details) =>
      chrome.identity.launchWebAuthFlow({
        url: details.url,
        interactive: details.interactive
      }))
  const getRedirectUrl = args.getRedirectUrl ?? ((path) => chrome.identity.getRedirectURL(path))
  const loadConfig = args.loadConfig ?? (() => loadExtensionConfig(args.storage))
  const now = args.now ?? (() => Date.now())
  const broadcastAuthState = args.broadcastAuthState ?? (() => {})
  let ensureInFlight: Promise<EnsureAuthSessionResponse> | null = null
  let signInInFlight: Promise<ExtensionAuthState> | null = null

  async function writeState(next: ExtensionAuthState): Promise<ExtensionAuthState> {
    await args.storage.set({
      [AUTH_STATE_STORAGE_KEY]: next
    })
    broadcastAuthState(next)
    return next
  }

  async function issueBackendToken(args: {
    config: ExtensionConfig
    body: DevBootstrapTokenRequest | GoogleIdTokenTokenRequest
    bootstrapKey?: string
  }): Promise<TokenResponse> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    }
    if (args.bootstrapKey) {
      headers["X-Bootstrap-Key"] = args.bootstrapKey
    }

    const response = await fetchImpl(`${args.config.apiBaseUrl}/api/token`, {
      method: "POST",
      headers,
      body: JSON.stringify(args.body)
    })

    if (!response.ok) {
      let message = `token request failed (${response.status})`
      try {
        const payload = (await response.json()) as { message?: string; code?: string }
        message = payload.message ?? payload.code ?? message
      } catch {
        // Keep the fallback message when the backend body is not JSON.
      }
      throw new Error(message)
    }

    return (await response.json()) as TokenResponse
  }

  async function revokeBackendToken(config: ExtensionConfig, token: string): Promise<void> {
    try {
      await fetchImpl(`${config.apiBaseUrl}/api/token/revoke`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`
        }
      })
    } catch {
      // Local sign-out should not fail just because revoke is unavailable.
    }
  }

  async function issueDevBootstrapSession(
    config: ExtensionConfig,
    current: ExtensionAuthState
  ): Promise<EnsureAuthSessionResponse> {
    const devBootstrap = config.devBootstrap
    if (!devBootstrap) {
      return {
        ok: false,
        state: current,
        error: "No auth provider configured."
      }
    }

    const issued = await issueBackendToken({
      config,
      body: {
        grantType: "dev-bootstrap",
        bootstrapSubject: devBootstrap.bootstrapSubject,
        ...(devBootstrap.profile ? { profile: devBootstrap.profile } : {})
      },
      bootstrapKey: devBootstrap.bootstrapKey
    })
    const next = await writeState({
      status: "signed-in",
      provider: "dev-bootstrap",
      user: issued.user,
      session: {
        token: issued.token,
        expiresAt: issued.expiresAt
      }
    })
    return {
      ok: true,
      state: next,
      token: issued.token,
      expiresAt: issued.expiresAt,
      user: issued.user
    }
  }

  async function exchangeGoogleIdToken(
    config: ExtensionConfig,
    idToken: string
  ): Promise<EnsureAuthSessionResponse> {
    const issued = await issueBackendToken({
      config,
      body: {
        grantType: "google-id-token",
        idToken
      }
    })
    const next = await writeState({
      status: "signed-in",
      provider: "google",
      user: issued.user,
      session: {
        token: issued.token,
        expiresAt: issued.expiresAt
      }
    })
    return {
      ok: true,
      state: next,
      token: issued.token,
      expiresAt: issued.expiresAt,
      user: issued.user
    }
  }

  async function runGoogleOidcFlow(config: ExtensionConfig, interactive: boolean): Promise<string> {
    if (!config.googleOAuthClientId) {
      throw new Error("Google sign-in is not configured for this build.")
    }

    const redirectUri = getRedirectUrl("google-auth")
    const state = randomBase64Url()
    const nonce = randomBase64Url()
    const redirectUrl = await launchWebAuthFlow({
      url: buildGoogleAuthorizeUrl({
        clientId: config.googleOAuthClientId,
        redirectUri,
        state,
        nonce,
        interactive
      }),
      interactive
    })

    if (!redirectUrl) {
      throw new Error(interactive ? "Google sign-in was cancelled." : "Google session refresh failed.")
    }

    return parseGoogleAuthRedirect({
      redirectUrl,
      expectedState: state,
      expectedNonce: nonce
    })
  }

  async function transition(next: ExtensionAuthState): Promise<ExtensionAuthState> {
    return writeState(next)
  }

  async function getState(): Promise<ExtensionAuthState> {
    const config = await loadConfig()
    const current = await readPersistedAuthState(args.storage)

    if (config.devBootstrap && (!current.session || !isSessionFresh(current.session.expiresAt, now()))) {
      try {
        return (await issueDevBootstrapSession(config, current)).state
      } catch (error) {
        return transition(
          createErrorState(
            error instanceof Error ? error.message : "Failed to start the internal preview session.",
            "dev-bootstrap"
          )
        )
      }
    }

    if (!config.googleOAuthClientId && !config.devBootstrap) {
      return transition(createErrorState("Google sign-in is not configured for this build.", "google"))
    }

    if (current.status === "error") {
      return current
    }

    if (current.user && current.provider === "google") {
      return {
        ...current,
        status: "signed-in"
      }
    }

    return current
  }

  async function signInWithGoogle(): Promise<ExtensionAuthState> {
    if (signInInFlight) {
      return signInInFlight
    }

    signInInFlight = (async () => {
      const config = await loadConfig()
      if (!config.googleOAuthClientId) {
        return transition(createErrorState("Google sign-in is not configured for this build.", "google"))
      }

      await transition({
        status: "signing-in",
        provider: "google",
        user: null,
        session: null
      })

      try {
        const idToken = await runGoogleOidcFlow(config, true)
        return (await exchangeGoogleIdToken(config, idToken)).state
      } catch (error) {
        return transition(
          createErrorState(
            error instanceof Error ? error.message : "Google sign-in failed. Try again.",
            "google"
          )
        )
      }
    })().finally(() => {
      signInInFlight = null
    })

    return signInInFlight
  }

  async function ensureAuthSession(): Promise<EnsureAuthSessionResponse> {
    if (ensureInFlight) {
      return ensureInFlight
    }

    ensureInFlight = (async () => {
      const config = await loadConfig()
      const current = await readPersistedAuthState(args.storage)
      if (config.devBootstrap) {
        try {
          return await issueDevBootstrapSession(config, current)
        } catch (error) {
          const state = await transition(
            createErrorState(
              error instanceof Error ? error.message : "Failed to start the internal preview session.",
              "dev-bootstrap"
            )
          )
          return {
            ok: false,
            state,
            error: state.errorMessage ?? "Failed to start the internal preview session."
          }
        }
      }

      if (!config.googleOAuthClientId) {
        const state = await transition(
          createErrorState("Google sign-in is not configured for this build.", "google")
        )
        return {
          ok: false,
          state,
          error: state.errorMessage ?? "Google sign-in is not configured for this build."
        }
      }

      if (current.session && isSessionFresh(current.session.expiresAt, now()) && current.user) {
        const state =
          current.status === "signed-in"
            ? current
            : await transition({
                status: "signed-in",
                provider: "google",
                user: current.user,
                session: current.session
              })
        return {
          ok: true,
          state,
          token: current.session.token,
          expiresAt: current.session.expiresAt,
          user: current.user
        }
      }

      if (!current.user || current.provider !== "google") {
        const state = await transition(
          createSignedOutState("Sign in with Google to ask about the current page.")
        )
        return {
          ok: false,
          state,
          error: state.errorMessage ?? "Sign in with Google to continue."
        }
      }

      await transition({
        status: "refreshing",
        provider: "google",
        user: current.user,
        session: current.session
      })

      try {
        const idToken = await runGoogleOidcFlow(config, false)
        return await exchangeGoogleIdToken(config, idToken)
      } catch {
        const state = await transition(
          createSignedOutState("Your Google session expired. Sign in again to continue.")
        )
        return {
          ok: false,
          state,
          error: state.errorMessage ?? "Your Google session expired. Sign in again."
        }
      }
    })().finally(() => {
      ensureInFlight = null
    })

    return ensureInFlight
  }

  async function signOut(): Promise<ExtensionAuthState> {
    const config = await loadConfig()
    const current = await readPersistedAuthState(args.storage)
    if (current.session?.token) {
      await revokeBackendToken(config, current.session.token)
    }
    return transition(createSignedOutState())
  }

  return {
    getState,
    signInWithGoogle,
    ensureAuthSession,
    signOut
  }
}
