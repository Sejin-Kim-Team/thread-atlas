import request from "supertest"
import { describe, expect, it } from "vitest"
import { createServer } from "../../src/server"
import { requireEnv } from "../helpers/env"

const BOOTSTRAP_KEY = requireEnv("AUTH_BOOTSTRAP_KEY")

describe("principal resolver and token transition contract (red)", () => {
  it("issues app session token via dev-bootstrap grant and returns local user id", async () => {
    const app = createServer()

    const response = await request(app)
      .post("/api/token")
      .set("X-Bootstrap-Key", BOOTSTRAP_KEY)
      .send({
        grantType: "dev-bootstrap",
        bootstrapSubject: "bootstrap-alpha",
        profile: {
          displayName: "Alpha",
          primaryEmail: "alpha@example.com"
        }
      })

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      token: expect.any(String),
      expiresAt: expect.any(String),
      user: {
        id: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        )
      }
    })
  })

  it("returns 403 when dev-bootstrap key is missing or invalid", async () => {
    const app = createServer()

    const response = await request(app).post("/api/token").send({
      grantType: "dev-bootstrap",
      bootstrapSubject: "bootstrap-alpha"
    })

    expect(response.status).toBe(403)
    expect(response.body).toMatchObject({
      code: "FORBIDDEN"
    })
  })

  it("returns 501 for google-id-token grant before oauth verifier is implemented", async () => {
    const app = createServer()

    const response = await request(app).post("/api/token").send({
      grantType: "google-id-token",
      provider: "google",
      idToken: "dummy.google.id.token"
    })

    expect(response.status).toBe(501)
    expect(response.body).toMatchObject({
      code: "NOT_IMPLEMENTED"
    })
  })

  it("keeps stable local user identity across server recreation for same bootstrap subject", async () => {
    const firstApp = createServer()
    const secondApp = createServer()
    const body = {
      grantType: "dev-bootstrap",
      bootstrapSubject: "bootstrap-stable",
      profile: {
        displayName: "Stable User"
      }
    }

    const first = await request(firstApp)
      .post("/api/token")
      .set("X-Bootstrap-Key", BOOTSTRAP_KEY)
      .send(body)
    const second = await request(secondApp)
      .post("/api/token")
      .set("X-Bootstrap-Key", BOOTSTRAP_KEY)
      .send(body)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(first.body.user.id).toBe(second.body.user.id)
  })
})
