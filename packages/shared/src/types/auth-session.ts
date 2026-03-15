export type TokenGrantType = "dev-bootstrap" | "google-id-token"

export type ExtensionAuthStatus =
  | "signed-out"
  | "signing-in"
  | "signed-in"
  | "refreshing"
  | "error"

export type ExtensionAuthProvider = "google" | "dev-bootstrap"

export interface TokenUser {
  id: string
  displayName?: string
  primaryEmail?: string
  avatarUrl?: string
}

export type DevBootstrapTokenRequest = {
  grantType: "dev-bootstrap"
  bootstrapSubject: string
  profile?: {
    displayName?: string
    primaryEmail?: string
    avatarUrl?: string
  }
}

export type GoogleIdTokenTokenRequest = {
  grantType: "google-id-token"
  idToken: string
}

export type TokenRequest = DevBootstrapTokenRequest | GoogleIdTokenTokenRequest

export interface TokenResponse {
  token: string
  expiresAt: number
  user: TokenUser
}

export interface ExtensionAuthSession {
  token: string
  expiresAt: number
}

export interface ExtensionAuthState {
  status: ExtensionAuthStatus
  provider: ExtensionAuthProvider | null
  user: TokenUser | null
  session: ExtensionAuthSession | null
  errorMessage?: string
}

export interface EnsureAuthSessionResponse {
  ok: boolean
  state: ExtensionAuthState
  token?: string
  expiresAt?: number
  user?: TokenUser
  error?: string
}
