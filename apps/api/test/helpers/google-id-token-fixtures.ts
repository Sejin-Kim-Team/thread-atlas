interface JwtLikePayload {
  [key: string]: unknown
}

function encodeBase64UrlJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url")
}

function buildJwtLikeToken(payload: JwtLikePayload): string {
  const header = {
    alg: "RS256",
    typ: "JWT",
    kid: "fixture-google-key-id"
  }

  return `${encodeBase64UrlJson(header)}.${encodeBase64UrlJson(payload)}.fixture-signature`
}

const nowEpochSeconds = Math.floor(Date.now() / 1000)
export const GOOGLE_ID_TOKEN_FIXTURE_AUDIENCE =
  "threadatlas-google-client-id.apps.googleusercontent.com"

const baseClaims = {
  iss: "https://accounts.google.com",
  aud: GOOGLE_ID_TOKEN_FIXTURE_AUDIENCE,
  email: "spark@example.com",
  email_verified: true,
  name: "Spark",
  picture: "https://example.com/avatar.png"
}

export const googleIdTokenFixtures = {
  validPrimary: buildJwtLikeToken({
    ...baseClaims,
    sub: "google-sub-realization-001",
    iat: nowEpochSeconds - 30,
    exp: nowEpochSeconds + 60 * 60
  }),
  validReloginSameSub: buildJwtLikeToken({
    ...baseClaims,
    sub: "google-sub-realization-001",
    iat: nowEpochSeconds - 10,
    exp: nowEpochSeconds + 60 * 60 + 120,
    jti: "relogin-002"
  }),
  expired: buildJwtLikeToken({
    ...baseClaims,
    sub: "google-sub-realization-002",
    iat: nowEpochSeconds - 60 * 60 * 2,
    exp: nowEpochSeconds - 60
  }),
  malformed: "not-a-google-id-token"
}

export function buildGoogleIdTokenGrantRequest(idToken: string) {
  return {
    grantType: "google-id-token" as const,
    idToken
  }
}
