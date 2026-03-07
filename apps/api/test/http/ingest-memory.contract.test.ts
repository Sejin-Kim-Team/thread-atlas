import request from "supertest"
import { describe, expect, it } from "vitest"
import { createServer } from "../../src/server"
import { buildIngestMemoryRequest, buildStorableMemoryRecord } from "./helpers/payloads"

async function issueToken(app: ReturnType<typeof createServer>, userId = "user_sungwoo"): Promise<string> {
  const response = await request(app).post("/api/token").send({ userId })
  return response.body.token as string
}

describe("POST /api/ingest/memory (hackathon contract)", () => {
  it("accepts storable memory records", async () => {
    const app = createServer()
    const token = await issueToken(app, "user_sungwoo")
    const payload = buildIngestMemoryRequest()
    const response = await request(app)
      .post("/api/ingest/memory")
      .set("Authorization", `Bearer ${token}`)
      .send(payload)

    expect(response.status).toBe(200)
    expect(response.body.acceptedIds).toContain(payload.records[0].id)
    expect(Array.isArray(response.body.rejected)).toBe(true)
  })

  it("rejects records with ownerUserId mismatch", async () => {
    const app = createServer()
    const token = await issueToken(app, "user_sungwoo")
    const payload = {
      source: "analyze",
      records: [buildStorableMemoryRecord("another_user")]
    }

    const response = await request(app)
      .post("/api/ingest/memory")
      .set("Authorization", `Bearer ${token}`)
      .send(payload)

    expect(response.status).toBe(403)
    expect(response.body).toMatchObject({
      code: "FORBIDDEN"
    })
  })

  it("rejects records with missing provenance", async () => {
    const app = createServer()
    const token = await issueToken(app, "user_sungwoo")
    const invalid = {
      ...buildStorableMemoryRecord(),
      id: "mem-missing-provenance-1",
      provenance: undefined
    }

    const response = await request(app)
      .post("/api/ingest/memory")
      .set("Authorization", `Bearer ${token}`)
      .send({
        source: "analyze",
        records: [invalid]
      })

    expect(response.status).toBe(200)
    expect(response.body.acceptedIds).toEqual([])
    expect(response.body.rejected).toContainEqual(
      expect.objectContaining({
        id: "mem-missing-provenance-1",
        reason: "missing-provenance"
      })
    )
  })

  it("rejects visual-only records", async () => {
    const app = createServer()
    const token = await issueToken(app, "user_sungwoo")
    const visualOnly = {
      ...buildStorableMemoryRecord(),
      id: "mem-visual-only-1",
      summary: "",
      visual: {
        kind: "chart-summary",
        summaryText: "line chart shows rising trend",
        extractedLabels: ["Q1", "Q2"]
      }
    }

    const response = await request(app)
      .post("/api/ingest/memory")
      .set("Authorization", `Bearer ${token}`)
      .send({
        source: "analyze",
        records: [visualOnly]
      })

    expect(response.status).toBe(200)
    expect(response.body.acceptedIds).toEqual([])
    expect(response.body.rejected).toContainEqual(
      expect.objectContaining({
        id: "mem-visual-only-1",
        reason: "visual-only"
      })
    )
  })
})
