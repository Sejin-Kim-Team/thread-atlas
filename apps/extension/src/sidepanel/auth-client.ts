import type { EnsureAuthSessionResponse, ExtensionAuthState, TokenResponse } from "@threadatlas/shared"
import type { SidePanelToServiceWorkerMessage } from "@threadatlas/shared/runtime"

export interface AuthClient {
  getAuthState(): Promise<ExtensionAuthState>
  signInWithGoogle(): Promise<ExtensionAuthState>
  signOut(): Promise<ExtensionAuthState>
  issueToken(): Promise<TokenResponse>
}

async function sendRuntimeMessage<TResponse>(message: SidePanelToServiceWorkerMessage): Promise<TResponse> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
      reject(new Error("chrome.runtime.sendMessage unavailable"))
      return
    }

    chrome.runtime.sendMessage(message, (response: TResponse) => {
      const runtimeError = chrome.runtime.lastError
      if (runtimeError) {
        reject(new Error(runtimeError.message))
        return
      }
      resolve(response)
    })
  })
}

export function createAuthClient(): AuthClient {
  return {
    async getAuthState(): Promise<ExtensionAuthState> {
      return sendRuntimeMessage<ExtensionAuthState>({ type: "GET_AUTH_STATE" })
    },
    async signInWithGoogle(): Promise<ExtensionAuthState> {
      return sendRuntimeMessage<ExtensionAuthState>({ type: "SIGN_IN_WITH_GOOGLE" })
    },
    async signOut(): Promise<ExtensionAuthState> {
      return sendRuntimeMessage<ExtensionAuthState>({ type: "SIGN_OUT" })
    },
    async issueToken(): Promise<TokenResponse> {
      const response = await sendRuntimeMessage<EnsureAuthSessionResponse>({
        type: "ENSURE_AUTH_SESSION"
      })
      if (!response.ok || !response.token || !response.user || typeof response.expiresAt !== "number") {
        throw new Error(
          response.error ??
            response.state.errorMessage ??
            "No authenticated ThreadAtlas session is available."
        )
      }

      return {
        token: response.token,
        expiresAt: response.expiresAt,
        user: response.user
      }
    }
  }
}
