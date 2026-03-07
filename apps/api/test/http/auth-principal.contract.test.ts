import request from "supertest"
import { describe, expect, it } from "vitest"
import { createServer } from "../../src/server"
import { requireEnv } from "../helpers/env"
import { buildAnalyzeRequest, buildIngestMemoryRequest } from "./helpers/payloads"

const BOOTSTRAP_KEY = requireEnv("AUTH_BOOTSTRAP_KEY")
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function issueTransitionToken(
  app: ReturnType<typeof createServer>,
  bootstrapSubject: string
): Promise<{ token: string; userId: string }> {
  const response = await request(app)
    .post("/api/token")
    .set("X-Bootstrap-Key", BOOTSTRAP_KEY)
    .send({
      grantType: "dev-bootstrap",
      bootstrapSubject,
      profile: {
        displayName: "Bootstrap User"
      }
    })

  expect(response.status).toBe(200)
  expect(response.body.user?.id).toMatch(UUID_V4_REGEX)
  return {
    token: response.body.token as string,
    userId: response.body.user.id as string
  }
}

describe("HTTP auth principal contract (red)", () => {
  it("rejects /api/analyze when principal is missing", async () => {
    const app = createServer()
    const response = await request(app).post("/api/analyze").send(buildAnalyzeRequest("seed"))

    expect(response.status).toBe(401)
    expect(response.body).toMatchObject({
      code: "UNAUTHORIZED"
    })
  })

  it("accepts /api/ingest/memory when ownerUserId matches local users.id principal", async () => {
    const app = createServer()
    const issued = await issueTransitionToken(app, "google-sub-auth-alpha")

    const response = await request(app)
      .post("/api/ingest/memory")
      .set("Authorization", `Bearer ${issued.token}`)
      .send(buildIngestMemoryRequest(issued.userId))

    expect(response.status).toBe(200)
    expect(response.body.acceptedIds).toContain("mem-branch-101")
  })

  it("rejects /api/ingest/memory when local principal and ownerUserId mismatch", async () => {
    const app = createServer()
    const issued = await issueTransitionToken(app, "google-sub-auth-beta")

    const response = await request(app)
      .post("/api/ingest/memory")
      .set("Authorization", `Bearer ${issued.token}`)
      .send(buildIngestMemoryRequest("00000000-0000-4000-8000-000000000999"))

    expect(response.status).toBe(403)
    expect(response.body).toMatchObject({
      code: "FORBIDDEN"
    })
  })

  it("issues principal-bound tokens for different users", async () => {
    const app = createServer()

    const a = await request(app)
      .post("/api/token")
      .set("X-Bootstrap-Key", BOOTSTRAP_KEY)
      .send({
        grantType: "dev-bootstrap",
        bootstrapSubject: "google-sub-auth-gamma"
      })
    const b = await request(app)
      .post("/api/token")
      .set("X-Bootstrap-Key", BOOTSTRAP_KEY)
      .send({
        grantType: "dev-bootstrap",
        bootstrapSubject: "google-sub-auth-delta"
      })

    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(a.body.user.id).toMatch(UUID_V4_REGEX)
    expect(b.body.user.id).toMatch(UUID_V4_REGEX)
    expect(a.body.user.id).not.toBe(b.body.user.id)
    expect(a.body.token).not.toBe(b.body.token)
  })

  it("rejects /api/analyze when token is invalid", async () => {
    const app = createServer()
    const response = await request(app)
      .post("/api/analyze")
      .set("Authorization", "Bearer invalid-token")
      .send(buildAnalyzeRequest("seed"))

    expect(response.status).toBe(401)
    expect(response.body).toMatchObject({
      code: "UNAUTHORIZED"
    })
  })

  it("rejects /api/ingest/memory when principal is missing", async () => {
    const app = createServer()
    const response = await request(app)
      .post("/api/ingest/memory")
      .send(buildIngestMemoryRequest("user_alpha"))

    expect(response.status).toBe(401)
    expect(response.body).toMatchObject({
      code: "UNAUTHORIZED"
    })
  })
})
