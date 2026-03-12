import { describe, expect, it, vi } from "vitest"
import { createAuthClient } from "../src/sidepanel/auth-client"

function createStorage(entries: Record<string, string | undefined>): Pick<Storage, "getItem"> {
  return {
    getItem(key: string): string | null {
      return entries[key] ?? null
    }
  }
}

function createJsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json(): Promise<unknown> {
      return body
    }
  } as Response
}

describe("auth client", () => {
  it("issues a dev-bootstrap token with bootstrap headers and optional profile", async () => {
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof init === "undefined") {
        fetchCalls.push({
          url: String(input)
        })
      } else {
        fetchCalls.push({
          url: String(input),
          init
        })
      }
      return createJsonResponse({
        token: "session-token",
        expiresAt: 1_799_999_999,
        user: {
          id: "user_bootstrap"
        }
      })
    })

    const client = createAuthClient({
      apiBaseUrl: "https://api.example.com",
      storage: createStorage({
        THREADATLAS_BOOTSTRAP_SUBJECT: "user_bootstrap",
        THREADATLAS_AUTH_BOOTSTRAP_KEY: "bootstrap-secret",
        THREADATLAS_AUTH_DISPLAY_NAME: "Sungwoo",
        THREADATLAS_AUTH_PRIMARY_EMAIL: "sungwoo@example.com"
      }),
      fetchImpl: fetchImpl as typeof fetch
    })

    const response = await client.issueToken()

    expect(response.token).toBe("session-token")
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchCalls[0]?.url).toBe("https://api.example.com/api/token")
    expect(fetchCalls[0]?.init).toMatchObject({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Bootstrap-Key": "bootstrap-secret"
      }
    })
    expect(JSON.parse(String(fetchCalls[0]?.init?.body))).toEqual({
      grantType: "dev-bootstrap",
      bootstrapSubject: "user_bootstrap",
      profile: {
        displayName: "Sungwoo",
        primaryEmail: "sungwoo@example.com"
      }
    })
  })

  it("issues a google-id-token session when a google token is configured", async () => {
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof init === "undefined") {
        fetchCalls.push({
          url: String(input)
        })
      } else {
        fetchCalls.push({
          url: String(input),
          init
        })
      }
      return createJsonResponse({
        token: "google-session-token",
        expiresAt: 1_799_999_999,
        user: {
          id: "user_google"
        }
      })
    })

    const client = createAuthClient({
      apiBaseUrl: "https://api.example.com",
      storage: createStorage({
        THREADATLAS_GOOGLE_ID_TOKEN: "google-id-token"
      }),
      fetchImpl: fetchImpl as typeof fetch
    })

    await client.issueToken()

    expect(JSON.parse(String(fetchCalls[0]?.init?.body))).toEqual({
      grantType: "google-id-token",
      idToken: "google-id-token"
    })
    expect(fetchCalls[0]?.init?.headers).toEqual({
      "Content-Type": "application/json"
    })
  })

  it("fails fast when both grant sources are configured without an explicit selector", async () => {
    const client = createAuthClient({
      apiBaseUrl: "https://api.example.com",
      storage: createStorage({
        THREADATLAS_GOOGLE_ID_TOKEN: "google-id-token",
        THREADATLAS_BOOTSTRAP_SUBJECT: "user_bootstrap",
        THREADATLAS_AUTH_BOOTSTRAP_KEY: "bootstrap-secret"
      }),
      fetchImpl: vi.fn() as unknown as typeof fetch
    })

    await expect(client.issueToken()).rejects.toThrow(
      "Both THREADATLAS_GOOGLE_ID_TOKEN and THREADATLAS_BOOTSTRAP_SUBJECT are configured."
    )
  })
})
