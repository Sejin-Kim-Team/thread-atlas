import request from "supertest"
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { createServer } from "../../src/server"
import { requireEnv } from "../helpers/env"
import { buildAnalyzeRequest } from "./helpers/payloads"

const previousTriggerMode = process.env.ENRICH_TRIGGER_MODE

async function issueAuthHeader(app: ReturnType<typeof createServer>): Promise<string> {
  const tokenResponse = await request(app)
    .post("/api/token")
    .set("X-Bootstrap-Key", requireEnv("AUTH_BOOTSTRAP_KEY"))
    .send({
      grantType: "dev-bootstrap",
      bootstrapSubject: "google-sub-shared-alignment"
    })

  return `Bearer ${tokenResponse.body.token as string}`
}

describe("POST /api/analyze shared input alignment", () => {
  beforeEach(() => {
    process.env.ENRICH_TRIGGER_MODE = "rule"
  })

  afterAll(() => {
    if (previousTriggerMode === undefined) {
      delete process.env.ENRICH_TRIGGER_MODE
      return
    }
    process.env.ENRICH_TRIGGER_MODE = previousTriggerMode
  })

  it("accepts richer shared providedPack fields without breaking analyze contract", async () => {
    const app = createServer()
    const authorization = await issueAuthHeader(app)
    const payload = buildAnalyzeRequest("seed")

    const response = await request(app)
      .post("/api/analyze")
      .set("Authorization", authorization)
      .send(payload)

    expect(response.status).toBe(200)
    expect(response.body.mode).toBe("seed")
    expect(Array.isArray(response.body.summaryCandidates)).toBe(true)
  })
})
