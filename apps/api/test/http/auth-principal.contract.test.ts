import request from "supertest"
import { describe, expect, it } from "vitest"
import { createServer } from "../../src/server"
import { buildAnalyzeRequest, buildIngestMemoryRequest } from "./helpers/payloads"

describe("HTTP auth principal contract (red)", () => {
  it("rejects /api/analyze when principal is missing", async () => {
    const app = createServer()
    const response = await request(app).post("/api/analyze").send(buildAnalyzeRequest("seed"))

    expect(response.status).toBe(401)
    expect(response.body).toMatchObject({
      code: "UNAUTHORIZED"
    })
  })

  it("accepts /api/ingest/memory when ownerUserId matches token principal", async () => {
    const app = createServer()

    const tokenResponse = await request(app).post("/api/token").send({ userId: "user_alpha" })
    expect(tokenResponse.status).toBe(200)

    const response = await request(app)
      .post("/api/ingest/memory")
      .set("Authorization", `Bearer ${tokenResponse.body.token as string}`)
      .send(buildIngestMemoryRequest("user_alpha"))

    expect(response.status).toBe(200)
    expect(response.body.acceptedIds).toContain("mem-branch-101")
  })

  it("rejects /api/ingest/memory when token principal and ownerUserId mismatch", async () => {
    const app = createServer()

    const tokenResponse = await request(app).post("/api/token").send({ userId: "user_alpha" })
    expect(tokenResponse.status).toBe(200)

    const response = await request(app)
      .post("/api/ingest/memory")
      .set("Authorization", `Bearer ${tokenResponse.body.token as string}`)
      .send(buildIngestMemoryRequest("user_beta"))

    expect(response.status).toBe(403)
    expect(response.body).toMatchObject({
      code: "FORBIDDEN"
    })
  })

  it("issues principal-bound tokens for different users", async () => {
    const app = createServer()

    const a = await request(app).post("/api/token").send({ userId: "user_alpha" })
    const b = await request(app).post("/api/token").send({ userId: "user_beta" })

    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
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
