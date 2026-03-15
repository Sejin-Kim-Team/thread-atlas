import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createAuthClient } from "../src/sidepanel/auth-client"

describe("auth client", () => {
  const sendMessage = vi.fn()

  beforeEach(() => {
    sendMessage.mockReset()
    vi.stubGlobal("chrome", {
      runtime: {
        lastError: undefined,
        sendMessage
      }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("requests current auth state from the background runtime", async () => {
    sendMessage.mockImplementation((message: unknown, callback: (response: unknown) => void) => {
      expect(message).toEqual({ type: "GET_AUTH_STATE" })
      callback({
        status: "signed-out",
        provider: null,
        user: null,
        session: null
      })
    })

    const client = createAuthClient()
    await expect(client.getAuthState()).resolves.toEqual({
      status: "signed-out",
      provider: null,
      user: null,
      session: null
    })
  })

  it("converts ENSURE_AUTH_SESSION responses into TokenResponse", async () => {
    sendMessage.mockImplementation((message: unknown, callback: (response: unknown) => void) => {
      expect(message).toEqual({ type: "ENSURE_AUTH_SESSION" })
      callback({
        ok: true,
        state: {
          status: "signed-in",
          provider: "google",
          user: {
            id: "user-1"
          },
          session: {
            token: "session-token",
            expiresAt: 1_799_999_999
          }
        },
        token: "session-token",
        expiresAt: 1_799_999_999,
        user: {
          id: "user-1"
        }
      })
    })

    const client = createAuthClient()
    await expect(client.issueToken()).resolves.toEqual({
      token: "session-token",
      expiresAt: 1_799_999_999,
      user: {
        id: "user-1"
      }
    })
  })

  it("surfaces background auth failures as user-facing errors", async () => {
    sendMessage.mockImplementation((_message: unknown, callback: (response: unknown) => void) => {
      callback({
        ok: false,
        state: {
          status: "signed-out",
          provider: null,
          user: null,
          session: null,
          errorMessage: "Sign in with Google to ask about the current page."
        },
        error: "Sign in with Google to ask about the current page."
      })
    })

    const client = createAuthClient()
    await expect(client.issueToken()).rejects.toThrow(
      "Sign in with Google to ask about the current page."
    )
  })
})
