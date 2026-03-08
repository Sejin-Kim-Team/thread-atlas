import request from "supertest"
import { describe, expect, it } from "vitest"
import { createServer } from "../../src/server"
import { requireEnv } from "../helpers/env"

describe("POST /api/token", () => {
  const BOOTSTRAP_KEY = requireEnv("AUTH_BOOTSTRAP_KEY")
  const UUID_V4_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

  it("issues app session token from dev-bootstrap grant", async () => {
    const app = createServer()
    const response = await request(app)
      .post("/api/token")
      .set("X-Bootstrap-Key", BOOTSTRAP_KEY)
      .send({
        grantType: "dev-bootstrap",
        bootstrapSubject: "google-sub-10001",
        profile: {
          displayName: "Sungwoo",
          primaryEmail: "sungwoo@example.com"
        }
      })

    expect(response.status).toBe(200)
    expect(typeof response.body.token).toBe("string")
    expect(typeof response.body.expiresAt).toBe("number")
    expect(response.body.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000))
    expect(typeof response.body.user?.id).toBe("string")
    expect(response.body.user.id).toMatch(UUID_V4_REGEX)
    expect(response.body.userId).toBeUndefined()
  })

  it("rejects token issue when bootstrap key is missing", async () => {
    const app = createServer()
    const response = await request(app).post("/api/token").send({
      grantType: "dev-bootstrap",
      bootstrapSubject: "google-sub-10002"
    })

    expect(response.status).toBe(403)
    expect(response.body).toMatchObject({
      code: "FORBIDDEN"
    })
  })

  it("returns 503 when AUTH_BOOTSTRAP_KEY is not configured", async () => {
    const previous = process.env.AUTH_BOOTSTRAP_KEY
    delete process.env.AUTH_BOOTSTRAP_KEY
    try {
      const app = createServer()
      const response = await request(app)
        .post("/api/token")
        .send({
          grantType: "dev-bootstrap",
          bootstrapSubject: "google-sub-10002"
        })

      expect(response.status).toBe(503)
      expect(response.body).toMatchObject({
        code: "SERVICE_UNAVAILABLE"
      })
    } finally {
      process.env.AUTH_BOOTSTRAP_KEY = previous
    }
  })

  it("rejects invalid google-id-token grant request with unauthorized", async () => {
    const app = createServer()
    const response = await request(app)
      .post("/api/token")
      .set("X-Bootstrap-Key", BOOTSTRAP_KEY)
      .send({
        grantType: "google-id-token",
        idToken: "dummy-token"
      })

    expect(response.status).toBe(401)
    expect(response.body).toMatchObject({
      code: "UNAUTHORIZED"
    })
  })

  it("reuses same local user identity for same bootstrapSubject and issues new session token", async () => {
    const app = createServer()
    const body = {
      grantType: "dev-bootstrap",
      bootstrapSubject: "google-sub-10003",
      profile: {
        displayName: "Sungwoo"
      }
    }

    const first = await request(app)
      .post("/api/token")
      .set("X-Bootstrap-Key", BOOTSTRAP_KEY)
      .send(body)

    const second = await request(app)
      .post("/api/token")
      .set("X-Bootstrap-Key", BOOTSTRAP_KEY)
      .send(body)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(first.body.user.id).toMatch(UUID_V4_REGEX)
    expect(second.body.user.id).toMatch(UUID_V4_REGEX)
    expect(first.body.user.id).toBe(second.body.user.id)
    expect(first.body.token).not.toBe(second.body.token)
    expect(typeof first.body.expiresAt).toBe("number")
    expect(typeof second.body.expiresAt).toBe("number")
    expect(first.body.userId).toBeUndefined()
    expect(second.body.userId).toBeUndefined()
  })

  it("rejects dev-bootstrap when bootstrapSubject is blank", async () => {
    const app = createServer()
    const response = await request(app)
      .post("/api/token")
      .set("X-Bootstrap-Key", BOOTSTRAP_KEY)
      .send({
        grantType: "dev-bootstrap",
        bootstrapSubject: "   "
      })

    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({
      code: "INVALID_EVENT"
    })
  })

  it("rejects legacy userId-only payload after canonical contract migration", async () => {
    const app = createServer()
    const response = await request(app).post("/api/token").send({
      userId: "user_sungwoo"
    })

    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({
      code: "INVALID_EVENT"
    })
  })
})
