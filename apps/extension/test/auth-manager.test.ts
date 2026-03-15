import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ExtensionConfig, KeyValueStorage } from "../src/common/extension-config"
import { createExtensionAuthManager } from "../src/background/auth-manager"

function createJsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json(): Promise<unknown> {
      return body
    }
  } as Response
}

function encodeJwtPayload(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: "none", typ: "JWT" }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
  const body = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
  return `${header}.${body}.signature`
}

function createStorage(seed: Record<string, unknown> = {}): KeyValueStorage & { data: Record<string, unknown> } {
  const data = { ...seed }
  return {
    data,
    async get(keys: string[]) {
      return Object.fromEntries(keys.map((key) => [key, data[key]]))
    },
    async set(values: Record<string, unknown>) {
      Object.assign(data, values)
    },
    async remove(keys: string[]) {
      for (const key of keys) {
        delete data[key]
      }
    }
  }
}

const baseConfig: ExtensionConfig = {
  apiBaseUrl: "https://api.example.com",
  googleOAuthClientId: "google-client-id.apps.googleusercontent.com",
  devBootstrap: null
}

describe("extension auth manager", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("completes interactive Google sign-in and persists a signed-in session", async () => {
    const storage = createStorage()
    const broadcasts: string[] = []
    const fetchImpl = vi.fn(async () =>
      createJsonResponse({
        token: "app-session-token",
        expiresAt: 1_800_000_000,
        user: {
          id: "user-1",
          displayName: "Sungwoo",
          primaryEmail: "sungwoo@example.com"
        }
      })
    )
    const launchWebAuthFlow = vi.fn(async ({ url }: { url: string; interactive: boolean }) => {
      const authorizeUrl = new URL(url)
      const nonce = authorizeUrl.searchParams.get("nonce")
      const state = authorizeUrl.searchParams.get("state")
      return `https://threadatlas.chromiumapp.org/google-auth#id_token=${encodeJwtPayload({
        nonce,
        sub: "google-subject-1"
      })}&state=${state}`
    })

    const manager = createExtensionAuthManager({
      storage,
      loadConfig: async () => baseConfig,
      fetchImpl: fetchImpl as typeof fetch,
      launchWebAuthFlow,
      getRedirectUrl: (path) => `https://threadatlas.chromiumapp.org/${path ?? ""}`,
      broadcastAuthState(state) {
        broadcasts.push(state.status)
      }
    })

    const state = await manager.signInWithGoogle()

    expect(launchWebAuthFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        interactive: true
      })
    )
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(state).toMatchObject({
      status: "signed-in",
      provider: "google",
      user: {
        id: "user-1",
        primaryEmail: "sungwoo@example.com"
      },
      session: {
        token: "app-session-token",
        expiresAt: 1_800_000_000
      }
    })
    expect(broadcasts).toEqual(["signing-in", "signed-in"])
  })

  it("reuses a fresh cached app session without reauthenticating", async () => {
    const storage = createStorage({
      THREADATLAS_AUTH_STATE: {
        status: "signed-in",
        provider: "google",
        user: {
          id: "user-1"
        },
        session: {
          token: "cached-session-token",
          expiresAt: Math.floor(Date.now() / 1000) + 3600
        }
      }
    })
    const fetchImpl = vi.fn()
    const launchWebAuthFlow = vi.fn()
    const manager = createExtensionAuthManager({
      storage,
      loadConfig: async () => baseConfig,
      fetchImpl: fetchImpl as typeof fetch,
      launchWebAuthFlow
    })

    const response = await manager.ensureAuthSession()

    expect(response).toMatchObject({
      ok: true,
      token: "cached-session-token"
    })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(launchWebAuthFlow).not.toHaveBeenCalled()
  })

  it("silently refreshes an expired Google-backed session when needed", async () => {
    const storage = createStorage({
      THREADATLAS_AUTH_STATE: {
        status: "signed-in",
        provider: "google",
        user: {
          id: "user-1",
          primaryEmail: "sungwoo@example.com"
        },
        session: {
          token: "expired-token",
          expiresAt: Math.floor(Date.now() / 1000) - 1
        }
      }
    })
    const fetchImpl = vi.fn(async () =>
      createJsonResponse({
        token: "renewed-session-token",
        expiresAt: Math.floor(Date.now() / 1000) + 7200,
        user: {
          id: "user-1",
          primaryEmail: "sungwoo@example.com"
        }
      })
    )
    const launchWebAuthFlow = vi.fn(async ({ url }: { url: string; interactive: boolean }) => {
      const authorizeUrl = new URL(url)
      const nonce = authorizeUrl.searchParams.get("nonce")
      const state = authorizeUrl.searchParams.get("state")
      return `https://threadatlas.chromiumapp.org/google-auth#id_token=${encodeJwtPayload({
        nonce,
        sub: "google-subject-1"
      })}&state=${state}`
    })

    const manager = createExtensionAuthManager({
      storage,
      loadConfig: async () => baseConfig,
      fetchImpl: fetchImpl as typeof fetch,
      launchWebAuthFlow,
      getRedirectUrl: (path) => `https://threadatlas.chromiumapp.org/${path ?? ""}`
    })

    const response = await manager.ensureAuthSession()

    expect(launchWebAuthFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        interactive: false
      })
    )
    expect(response).toMatchObject({
      ok: true,
      token: "renewed-session-token"
    })
  })

  it("falls back to signed-out when silent refresh fails", async () => {
    const storage = createStorage({
      THREADATLAS_AUTH_STATE: {
        status: "signed-in",
        provider: "google",
        user: {
          id: "user-1"
        },
        session: {
          token: "expired-token",
          expiresAt: Math.floor(Date.now() / 1000) - 1
        }
      }
    })
    const manager = createExtensionAuthManager({
      storage,
      loadConfig: async () => baseConfig,
      fetchImpl: vi.fn() as unknown as typeof fetch,
      launchWebAuthFlow: vi.fn(async () => undefined)
    })

    const response = await manager.ensureAuthSession()

    expect(response).toMatchObject({
      ok: false,
      state: {
        status: "signed-out"
      },
      error: "Your Google session expired. Sign in again to continue."
    })
  })

  it("signs out locally and revokes the current backend session", async () => {
    const storage = createStorage({
      THREADATLAS_AUTH_STATE: {
        status: "signed-in",
        provider: "google",
        user: {
          id: "user-1"
        },
        session: {
          token: "session-token",
          expiresAt: Math.floor(Date.now() / 1000) + 3600
        }
      }
    })
    const fetchImpl = vi.fn(async () => createJsonResponse({}, 204))
    const manager = createExtensionAuthManager({
      storage,
      loadConfig: async () => baseConfig,
      fetchImpl: fetchImpl as typeof fetch
    })

    const state = await manager.signOut()

    expect(fetchImpl).toHaveBeenCalledWith("https://api.example.com/api/token/revoke", {
      method: "POST",
      headers: {
        Authorization: "Bearer session-token"
      }
    })
    expect(state).toEqual({
      status: "signed-out",
      provider: null,
      user: null,
      session: null
    })
  })
})
