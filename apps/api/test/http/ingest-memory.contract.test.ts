import request from "supertest"
import { describe, expect, it } from "vitest"
import { createServer } from "../../src/server"
import { requireEnv } from "../helpers/env"
import { buildIngestMemoryRequest, buildStorableMemoryRecord } from "./helpers/payloads"

const BOOTSTRAP_KEY = requireEnv("AUTH_BOOTSTRAP_KEY")
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function issueToken(
  app: ReturnType<typeof createServer>,
  bootstrapSubject: string
): Promise<{ token: string; userId: string }> {
  const response = await request(app)
    .post("/api/token")
    .set("X-Bootstrap-Key", BOOTSTRAP_KEY)
    .send({
      grantType: "dev-bootstrap",
      bootstrapSubject
    })

  expect(response.status).toBe(200)
  expect(response.body.user?.id).toMatch(UUID_V4_REGEX)
  return {
    token: response.body.token as string,
    userId: response.body.user.id as string
  }
}

describe("POST /api/ingest/memory (hackathon contract)", () => {
  it("accepts storable memory records when ownerUserId matches local users.id", async () => {
    const app = createServer()
    const issued = await issueToken(app, "google-sub-ingest-alpha")
    const payload = buildIngestMemoryRequest(issued.userId)
    const response = await request(app)
      .post("/api/ingest/memory")
      .set("Authorization", `Bearer ${issued.token}`)
      .send(payload)

    expect(response.status).toBe(200)
    expect(response.body.acceptedIds).toContain(payload.records[0].id)
    expect(Array.isArray(response.body.rejected)).toBe(true)
  })

  it("rejects records with ownerUserId mismatch", async () => {
    const app = createServer()
    const issued = await issueToken(app, "google-sub-ingest-beta")
    const payload = {
      source: "analyze",
      records: [buildStorableMemoryRecord("00000000-0000-4000-8000-000000000999")]
    }

    const response = await request(app)
      .post("/api/ingest/memory")
      .set("Authorization", `Bearer ${issued.token}`)
      .send(payload)

    expect(response.status).toBe(403)
    expect(response.body).toMatchObject({
      code: "FORBIDDEN"
    })
  })

  it("rejects records with missing provenance", async () => {
    const app = createServer()
    const issued = await issueToken(app, "google-sub-ingest-gamma")
    const invalid = {
      ...buildStorableMemoryRecord(issued.userId),
      id: "mem-missing-provenance-1",
      provenance: undefined
    }

    const response = await request(app)
      .post("/api/ingest/memory")
      .set("Authorization", `Bearer ${issued.token}`)
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
    const issued = await issueToken(app, "google-sub-ingest-delta")
    const visualOnly = {
      ...buildStorableMemoryRecord(issued.userId),
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
      .set("Authorization", `Bearer ${issued.token}`)
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
