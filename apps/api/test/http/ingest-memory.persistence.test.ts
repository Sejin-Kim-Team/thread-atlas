import { randomUUID } from "node:crypto"
import request from "supertest"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createServer } from "../../src/server"
import { queryDb } from "../../src/db/pool"
import { embedTextWithVertex } from "../../src/rag/vertex-embedding-adapter"
import { requireEnv } from "../helpers/env"

const BOOTSTRAP_KEY = requireEnv("AUTH_BOOTSTRAP_KEY")
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const embedTextWithVertexMock = vi.hoisted(() => vi.fn())

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
    embedTextWithVertex: embedTextWithVertexMock
  }
})

interface IssuedToken {
  token: string
  userId: string
}

function buildStorableRecord(ownerUserId: string, recordId = randomUUID()) {
  return {
    id: recordId,
    ownerUserId,
    kind: "branch-summary",
    summary: "웹소켓이 인터럽트 처리와 양방향 업데이트에서 유리하다는 요약",
    keywords: ["websocket", "sse", "interruption", "bidirectional"],
    entities: ["WebSocket", "SSE"],
    provenance: {
      sourceUrl: "https://news.ycombinator.com/item?id=43199999",
      pageKind: "thread",
      snapshotCapturedAt: "2026-03-05T09:10:00.000Z",
      extractorId: "generic+hacker-news-enhancer",
      skeletonVersion: 8
    },
    source: {
      pageId: "hn-43199999",
      rootNodeIds: ["comment-43199977"],
      unitId: "branch-43199977"
    },
    navigation: {
      canonicalUrl: "https://news.ycombinator.com/item?id=43199999",
      pageTitle: "Show HN: Live Voice Browser Assistant",
      nodeAnchor: {
        commentId: "comment-43199977",
        textQuote: "bidirectional update and interrupt handling"
      },
      openMode: "new-tab"
    },
    evidence: {
      textSpans: ["bidirectional update and interrupt handling", "WebSocket fits better than SSE"],
      referencedNodeIds: ["comment-43199977", "comment-43199990"]
    },
    createdAt: "2026-03-05T09:12:00.000Z"
  }
}

async function issueToken(
  app: ReturnType<typeof createServer>,
  bootstrapSubject: string
): Promise<IssuedToken> {
  const response = await request(app)
    .post("/api/token")
    .set("X-Bootstrap-Key", BOOTSTRAP_KEY)
    .send({
      grantType: "dev-bootstrap",
      bootstrapSubject
    })

  expect(response.status).toBe(200)
  expect(typeof response.body.token).toBe("string")
  expect(typeof response.body.user?.id).toBe("string")

  return {
    token: response.body.token as string,
    userId: response.body.user.id as string
  }
}

describe("POST /api/ingest/memory (persistence red)", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "thread-atlas")
    vi.stubEnv("GOOGLE_CLOUD_LOCATION", "us-central1")
    vi.mocked(embedTextWithVertex).mockImplementation(async (text: string) => {
      if (!process.env.GOOGLE_CLOUD_PROJECT || !process.env.GOOGLE_CLOUD_LOCATION) {
        const error = new Error("GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION are required")
        ;(error as Error & { code: string }).code = "EMBEDDING_PROVIDER_CONFIG_MISSING"
        throw error
      }
      if (text.includes("force-provider-failure")) {
        const error = new Error("provider request failed")
        ;(error as Error & { code: string }).code = "EMBEDDING_PROVIDER_REQUEST_FAILED"
        throw error
      }
      return {
        embeddingModel: "gemini-embedding-001",
        embeddingDims: 768,
        embedding: Array.from({ length: 768 }, () => 0.01)
      }
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.mocked(embedTextWithVertex).mockReset()
  })

  it("writes accepted record to DB memory tables", async () => {
    const app = createServer()
    const issued = await issueToken(app, "google-sub-ingest-persistence-alpha")
    const record = buildStorableRecord(issued.userId)

    const response = await request(app)
      .post("/api/ingest/memory")
      .set("Authorization", `Bearer ${issued.token}`)
      .send({
        source: "analyze",
        records: [record]
      })

    expect(response.status).toBe(200)
    expect(response.body.acceptedIds).toContain(record.id)

    // RED 의도: 인메모리 승인만이 아니라 실제 DB write가 되어야 한다.
    const memoryRecordsTable = await queryDb<{ regclass: string | null }>(
      "select to_regclass('public.memory_records') as regclass"
    )
    expect(memoryRecordsTable.rows[0]?.regclass).toBeTruthy()

    const writtenRecord = await queryDb<{
      id: string
      owner_user_id: string
      retrieval_text: string
    }>(
      "select id, owner_user_id, retrieval_text from memory_records where id = $1",
      [record.id]
    )
    expect(writtenRecord.rowCount).toBe(1)
    expect(writtenRecord.rows[0]?.owner_user_id).toBe(issued.userId)
    expect((writtenRecord.rows[0]?.retrieval_text ?? "").trim().length).toBeGreaterThan(0)

    const embeddingsTable = await queryDb<{ regclass: string | null }>(
      "select to_regclass('public.memory_record_embeddings') as regclass"
    )
    expect(embeddingsTable.rows[0]?.regclass).toBeTruthy()

    const writtenEmbedding = await queryDb<{
      record_id: string
      owner_user_id: string
      embedding_dims: number
      embedding_model: string
    }>(
      "select record_id, owner_user_id, embedding_dims, embedding_model from memory_record_embeddings where record_id = $1",
      [record.id]
    )
    expect(writtenEmbedding.rowCount).toBe(1)
    expect(writtenEmbedding.rows[0]).toMatchObject({
      record_id: record.id,
      owner_user_id: issued.userId,
      embedding_dims: 768,
      // 해커톤 스펙: 실제 Vertex embedding 모델 식별자가 저장되어야 한다.
      embedding_model: "gemini-embedding-001"
    })
  })

  it("rejects owner mismatch with 403", async () => {
    const app = createServer()
    const issued = await issueToken(app, "google-sub-ingest-persistence-beta")

    const response = await request(app)
      .post("/api/ingest/memory")
      .set("Authorization", `Bearer ${issued.token}`)
      .send({
        source: "analyze",
        records: [buildStorableRecord("00000000-0000-4000-8000-000000000999")]
      })

    expect(response.status).toBe(403)
    expect(response.body).toMatchObject({
      code: "FORBIDDEN"
    })
  })

  it("rejects visual-only record", async () => {
    const app = createServer()
    const issued = await issueToken(app, "google-sub-ingest-persistence-gamma")
    const visualOnly = buildStorableRecord(issued.userId)
    visualOnly.summary = ""
    visualOnly.visual = {
      kind: "chart-summary",
      summaryText: "line chart shows rising trend",
      extractedLabels: ["Q1", "Q2"]
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
        id: visualOnly.id,
        reason: "visual-only"
      })
    )
  })

  it("rejects record with incomplete provenance", async () => {
    const app = createServer()
    const issued = await issueToken(app, "google-sub-ingest-persistence-delta")
    const missingProvenance = buildStorableRecord(issued.userId) as Record<string, unknown>
    delete missingProvenance.provenance

    const response = await request(app)
      .post("/api/ingest/memory")
      .set("Authorization", `Bearer ${issued.token}`)
      .send({
        source: "analyze",
        records: [missingProvenance]
      })

    expect(response.status).toBe(200)
    expect(response.body.acceptedIds).toEqual([])
    expect(response.body.rejected).toContainEqual(
      expect.objectContaining({
        id: missingProvenance.id,
        reason: "missing-provenance"
      })
    )
  })

  it("rejects provider config failure per record instead of failing the full batch", async () => {
    const app = createServer()
    const issued = await issueToken(app, "google-sub-ingest-persistence-epsilon")
    const record = buildStorableRecord(issued.userId)
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "")
    vi.stubEnv("GOOGLE_CLOUD_LOCATION", "")

    const response = await request(app)
      .post("/api/ingest/memory")
      .set("Authorization", `Bearer ${issued.token}`)
      .send({
        source: "analyze",
        records: [record]
      })

    expect(response.status).toBe(200)
    expect(response.body.acceptedIds).toEqual([])
    expect(response.body.rejected).toContainEqual(
      expect.objectContaining({
        id: record.id,
        reason: "not-storable"
      })
    )
  })

  it("does not leave partial memory_records row when provider config is missing", async () => {
    const app = createServer()
    const issued = await issueToken(app, "google-sub-ingest-persistence-zeta")
    const record = buildStorableRecord(issued.userId)
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "")
    vi.stubEnv("GOOGLE_CLOUD_LOCATION", "")

    await request(app)
      .post("/api/ingest/memory")
      .set("Authorization", `Bearer ${issued.token}`)
      .send({
        source: "analyze",
        records: [record]
      })

    const writtenRecord = await queryDb<{
      id: string
    }>("select id from memory_records where id = $1", [record.id])

    expect(writtenRecord.rowCount).toBe(0)
  })

  it("keeps earlier accepted ids when a later record hits embedding provider failure", async () => {
    const app = createServer()
    const issued = await issueToken(app, "google-sub-ingest-persistence-theta")
    const acceptedRecord = buildStorableRecord(issued.userId)
    const failedRecord = buildStorableRecord(issued.userId)
    failedRecord.summary = "force-provider-failure"

    const response = await request(app)
      .post("/api/ingest/memory")
      .set("Authorization", `Bearer ${issued.token}`)
      .send({
        source: "analyze",
        records: [acceptedRecord, failedRecord]
      })

    expect(response.status).toBe(200)
    expect(response.body.acceptedIds).toEqual([acceptedRecord.id])
    expect(response.body.rejected).toContainEqual(
      expect.objectContaining({
        id: failedRecord.id,
        reason: "not-storable"
      })
    )

    const acceptedRow = await queryDb<{ id: string }>("select id from memory_records where id = $1", [
      acceptedRecord.id
    ])
    const failedRow = await queryDb<{ id: string }>("select id from memory_records where id = $1", [
      failedRecord.id
    ])
    expect(acceptedRow.rowCount).toBe(1)
    expect(failedRow.rowCount).toBe(0)
  })

  it("rejects duplicate record ids per record instead of failing the full batch", async () => {
    const app = createServer()
    const issued = await issueToken(app, "google-sub-ingest-persistence-kappa")
    const duplicateId = randomUUID()
    const firstRecord = buildStorableRecord(issued.userId, duplicateId)
    const duplicateRecord = buildStorableRecord(issued.userId, duplicateId)

    const response = await request(app)
      .post("/api/ingest/memory")
      .set("Authorization", `Bearer ${issued.token}`)
      .send({
        source: "analyze",
        records: [firstRecord, duplicateRecord]
      })

    expect(response.status).toBe(200)
    expect(response.body.acceptedIds).toEqual([duplicateId])
    expect(response.body.rejected).toContainEqual(
      expect.objectContaining({
        id: duplicateId,
        reason: "not-storable"
      })
    )

    const writtenRows = await queryDb<{ id: string }>("select id from memory_records where id = $1", [
      duplicateId
    ])
    expect(writtenRows.rowCount).toBe(1)
  })

  it("returns the persisted generated id when request id is blank", async () => {
    const app = createServer()
    const issued = await issueToken(app, "google-sub-ingest-persistence-iota")
    const record = buildStorableRecord(issued.userId, "   ")

    const response = await request(app)
      .post("/api/ingest/memory")
      .set("Authorization", `Bearer ${issued.token}`)
      .send({
        source: "analyze",
        records: [record]
      })

    expect(response.status).toBe(200)
    expect(response.body.acceptedIds).toHaveLength(1)
    const persistedId = response.body.acceptedIds[0] as string
    expect(persistedId).toMatch(UUID_V4_REGEX)
    expect(persistedId).not.toBe(record.id)

    const writtenRecord = await queryDb<{
      id: string
      owner_user_id: string
    }>("select id, owner_user_id from memory_records where id = $1", [persistedId])

    expect(writtenRecord.rowCount).toBe(1)
    expect(writtenRecord.rows[0]).toMatchObject({
      id: persistedId,
      owner_user_id: issued.userId
    })
  })
})
