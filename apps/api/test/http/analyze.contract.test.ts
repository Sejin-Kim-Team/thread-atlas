import request from "supertest"
import { describe, expect, it } from "vitest"
import { createServer } from "../../src/server"
import { requireEnv } from "../helpers/env"
import { buildAnalyzeRequest } from "./helpers/payloads"

async function issueAuthHeader(app: ReturnType<typeof createServer>): Promise<string> {
  const tokenResponse = await request(app)
    .post("/api/token")
    .set("X-Bootstrap-Key", requireEnv("AUTH_BOOTSTRAP_KEY"))
    .send({
      grantType: "dev-bootstrap",
      bootstrapSubject: "google-sub-analyze-sungwoo"
    })
  return `Bearer ${tokenResponse.body.token as string}`
}

describe("POST /api/analyze (hackathon contract)", () => {
  it("mode=seed returns required summaryCandidates and no legacy cache fields", async () => {
    const app = createServer()
    const authorization = await issueAuthHeader(app)
    const response = await request(app)
      .post("/api/analyze")
      .set("Authorization", authorization)
      .send(buildAnalyzeRequest("seed"))

    expect(response.status).toBe(200)
    expect(response.body.mode).toBe("seed")
    expect(typeof response.body.analysisId).toBe("string")
    expect(["discussion", "authored", "interactive", "generic"]).toContain(
      response.body.normalizedMode
    )
    expect(Array.isArray(response.body.summaryCandidates)).toBe(true)
    if (response.body.visualSummaries !== undefined) {
      expect(Array.isArray(response.body.visualSummaries)).toBe(true)
    }
    expect(response.body.persistedSessionCache).toBeUndefined()
    expect(response.body.persistSessionCache).toBeUndefined()
    expect(response.body.snapshot).toBeUndefined()
  })

  it("mode=memory-candidate returns required summaryCandidates", async () => {
    const app = createServer()
    const authorization = await issueAuthHeader(app)
    const response = await request(app)
      .post("/api/analyze")
      .set("Authorization", authorization)
      .send(buildAnalyzeRequest("memory-candidate"))

    expect(response.status).toBe(200)
    expect(response.body.mode).toBe("memory-candidate")
    expect(typeof response.body.analysisId).toBe("string")
    expect(Array.isArray(response.body.summaryCandidates)).toBe(true)
  })

  it("mode=visual-summary returns required visualSummaries", async () => {
    const app = createServer()
    const authorization = await issueAuthHeader(app)
    const response = await request(app)
      .post("/api/analyze")
      .set("Authorization", authorization)
      .send(buildAnalyzeRequest("visual-summary"))

    expect(response.status).toBe(200)
    expect(response.body.mode).toBe("visual-summary")
    expect(typeof response.body.analysisId).toBe("string")
    expect(Array.isArray(response.body.visualSummaries)).toBe(true)
  })

  it("returns INVALID_SNAPSHOT when snapshot is missing", async () => {
    const app = createServer()
    const authorization = await issueAuthHeader(app)
    const response = await request(app)
      .post("/api/analyze")
      .set("Authorization", authorization)
      .send({
        tabId: 128,
        mode: "seed"
      })

    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(response.status).toBeLessThan(500)
    expect(response.body).toMatchObject({
      code: "INVALID_SNAPSHOT"
    })
  })

  it("returns INVALID_EVENT when tabId is missing", async () => {
    const app = createServer()
    const authorization = await issueAuthHeader(app)
    const requestBody = buildAnalyzeRequest("seed")
    const { tabId: _ignored, ...withoutTabId } = requestBody

    const response = await request(app)
      .post("/api/analyze")
      .set("Authorization", authorization)
      .send(withoutTabId)

    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(response.status).toBeLessThan(500)
    expect(response.body).toMatchObject({
      code: "INVALID_EVENT"
    })
  })
})
