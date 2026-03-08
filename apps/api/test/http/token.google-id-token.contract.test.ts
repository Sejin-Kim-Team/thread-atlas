import request from "supertest"
import { describe, expect, it } from "vitest"
import { createServer } from "../../src/server"
import {
  buildGoogleIdTokenGrantRequest,
  googleIdTokenFixtures
} from "../helpers/google-id-token-fixtures"

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe("POST /api/token google-id-token contract (red)", () => {
  it("returns 200 with token/expiresAt/user.id when Google id token verification succeeds", async () => {
    const app = createServer()
    const response = await request(app)
      .post("/api/token")
      .send(buildGoogleIdTokenGrantRequest(googleIdTokenFixtures.validPrimary))

    expect(response.status).toBe(200)
    expect(typeof response.body.token).toBe("string")
    expect(typeof response.body.expiresAt).toBe("number")
    expect(response.body.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000))
    expect(typeof response.body.user?.id).toBe("string")
    expect(response.body.user.id).toMatch(UUID_V4_REGEX)
  })

  it("keeps same local user id and issues a new app token on relogin for same Google sub", async () => {
    const app = createServer()
    const first = await request(app)
      .post("/api/token")
      .send(buildGoogleIdTokenGrantRequest(googleIdTokenFixtures.validPrimary))
    const second = await request(app)
      .post("/api/token")
      .send(buildGoogleIdTokenGrantRequest(googleIdTokenFixtures.validReloginSameSub))

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(first.body.user.id).toMatch(UUID_V4_REGEX)
    expect(second.body.user.id).toMatch(UUID_V4_REGEX)
    expect(first.body.user.id).toBe(second.body.user.id)
    expect(first.body.token).not.toBe(second.body.token)
  })

  it("returns 200 for concurrent logins with same Google sub and reuses one local user id", async () => {
    const app = createServer()
    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        request(app)
          .post("/api/token")
          .send(buildGoogleIdTokenGrantRequest(googleIdTokenFixtures.validPrimary))
      )
    )

    expect(responses.every((response) => response.status === 200)).toBe(true)

    const userIds = new Set(responses.map((response) => response.body.user?.id))
    expect(userIds.size).toBe(1)

    const tokens = new Set(responses.map((response) => response.body.token))
    expect(tokens.size).toBe(responses.length)
  })

  it("returns 401 when id token is invalid or expired", async () => {
    const app = createServer()

    for (const idToken of [googleIdTokenFixtures.malformed, googleIdTokenFixtures.expired]) {
      const response = await request(app)
        .post("/api/token")
        .send(buildGoogleIdTokenGrantRequest(idToken))

      expect(response.status).toBe(401)
      expect(response.body).toMatchObject({
        code: "UNAUTHORIZED"
      })
    }
  })

  it("returns 503 when google verifier is unavailable", async () => {
    const previous = process.env.GOOGLE_OAUTH_CLIENT_ID
    delete process.env.GOOGLE_OAUTH_CLIENT_ID
    try {
      const app = createServer()
      const response = await request(app)
        .post("/api/token")
        .send(buildGoogleIdTokenGrantRequest(googleIdTokenFixtures.validPrimary))

      expect(response.status).toBe(503)
      expect(response.body).toMatchObject({
        code: "SERVICE_UNAVAILABLE"
      })
    } finally {
      if (previous === undefined) {
        delete process.env.GOOGLE_OAUTH_CLIENT_ID
      } else {
        process.env.GOOGLE_OAUTH_CLIENT_ID = previous
      }
    }
  })
})
