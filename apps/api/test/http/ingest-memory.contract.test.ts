import request from "supertest"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createServer } from "../../src/server"
import { requireEnv } from "../helpers/env"
import { buildIngestMemoryRequest, buildStorableMemoryRecord } from "./helpers/payloads"

const BOOTSTRAP_KEY = requireEnv("AUTH_BOOTSTRAP_KEY")
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

vi.mock("../../src/rag/vertex-embedding-adapter", () => {
  const dims = 768
  const model = "gemini-embedding-001"
  return {
    CANONICAL_VERTEX_EMBEDDING_MODEL: model,
    CANONICAL_VERTEX_EMBEDDING_DIMS: dims,
    isEmbeddingProviderError: (error: unknown) =>
      Boolean(
        error &&
          typeof error === "object" &&
          "code" in error &&
          (error as { code?: string }).code?.startsWith("EMBEDDING_PROVIDER_")
      ),
    embedTextWithVertex: vi.fn(async () => ({
      embeddingModel: model,
      embeddingDims: dims,
      embedding: Array.from({ length: dims }, () => 0.02)
    }))
  }
})

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
  beforeEach(() => {
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "thread-atlas")
    vi.stubEnv("GOOGLE_CLOUD_LOCATION", "us-central1")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("accepts storable memory records when ownerUserId matches local users.id", async () => {
    const app = createServer()
    const issued = await issueToken(app, "google-sub-ingest-alpha")
    const payload = buildIngestMemoryRequest(issued.userId)
    const firstRecord = payload.records[0]
    const response = await request(app)
      .post("/api/ingest/memory")
      .set("Authorization", `Bearer ${issued.token}`)
      .send(payload)

    expect(response.status).toBe(200)
    expect(firstRecord).toBeDefined()
    expect(response.body.acceptedIds).toContain(firstRecord!.id)
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

  it("rejects records with invalid provenance.pageKind", async () => {
    const app = createServer()
    const issued = await issueToken(app, "google-sub-ingest-epsilon")
    const invalid = buildStorableMemoryRecord(issued.userId) as Record<string, unknown>
    invalid.id = "mem-invalid-page-kind-1"
    invalid.provenance = {
      ...(invalid.provenance as Record<string, unknown>),
      pageKind: "forum"
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
        id: "mem-invalid-page-kind-1",
        reason: "missing-provenance"
      })
    )
  })

  it("rejects records with non-numeric provenance.skeletonVersion", async () => {
    const app = createServer()
    const issued = await issueToken(app, "google-sub-ingest-theta")
    const invalid = buildStorableMemoryRecord(issued.userId) as Record<string, unknown>
    invalid.id = "mem-invalid-skeleton-version-1"
    invalid.provenance = {
      ...(invalid.provenance as Record<string, unknown>),
      skeletonVersion: "v8"
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
        id: "mem-invalid-skeleton-version-1",
        reason: "missing-provenance"
      })
    )
  })

  it("rejects records with invalid provenance.snapshotCapturedAt", async () => {
    const app = createServer()
    const issued = await issueToken(app, "google-sub-ingest-iota")
    const invalid = buildStorableMemoryRecord(issued.userId) as Record<string, unknown>
    invalid.id = "mem-invalid-captured-at-1"
    invalid.provenance = {
      ...(invalid.provenance as Record<string, unknown>),
      snapshotCapturedAt: "not-a-date"
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
        id: "mem-invalid-captured-at-1",
        reason: "missing-provenance"
      })
    )
  })

  it("rejects records with unsupported navigation.openMode", async () => {
    const app = createServer()
    const issued = await issueToken(app, "google-sub-ingest-kappa")
    const invalid = buildStorableMemoryRecord(issued.userId) as Record<string, unknown>
    invalid.id = "mem-invalid-open-mode-1"
    invalid.navigation = {
      ...(invalid.navigation as Record<string, unknown>),
      openMode: "popup"
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
        id: "mem-invalid-open-mode-1",
        reason: "not-storable"
      })
    )
  })

  it("rejects records with invalid createdAt instead of returning 500", async () => {
    const app = createServer()
    const issued = await issueToken(app, "google-sub-ingest-lambda")
    const invalid = buildStorableMemoryRecord(issued.userId) as Record<string, unknown>
    invalid.id = "mem-invalid-created-at-1"
    invalid.createdAt = "not-a-date"

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
        id: "mem-invalid-created-at-1",
        reason: "not-storable"
      })
    )
  })

  it("rejects records with blank persistence fields instead of returning 500", async () => {
    const app = createServer()
    const issued = await issueToken(app, "google-sub-ingest-zeta")
    const invalid = buildStorableMemoryRecord(issued.userId) as Record<string, unknown>
    invalid.id = "mem-blank-persistence-1"
    invalid.source = {
      ...(invalid.source as Record<string, unknown>),
      pageId: "   "
    }
    invalid.navigation = {
      ...(invalid.navigation as Record<string, unknown>),
      canonicalUrl: "   "
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
        id: "mem-blank-persistence-1",
        reason: "not-storable"
      })
    )
  })
})
