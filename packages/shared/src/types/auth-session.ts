export type TokenGrantType = "dev-bootstrap" | "google-id-token"

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
