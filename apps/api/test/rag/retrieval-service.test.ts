import { randomUUID } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { queryDb } from "../../src/db/pool"

const embedTextWithVertexMock = vi.fn(async (text: string) => {
  if (!process.env.GOOGLE_CLOUD_PROJECT || !process.env.GOOGLE_CLOUD_LOCATION) {
    const error = new Error("GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION are required")
    ;(error as Error & { code: string }).code = "EMBEDDING_PROVIDER_CONFIG_MISSING"
    throw error
  }
  const vector = Array.from({ length: 768 }, (_, index) =>
    index === 0 ? Math.min(1, text.length / 100) : 0.01
  )
  return {
    embeddingModel: "gemini-embedding-001",
    embeddingDims: 768,
    embedding: vector
  }
})

vi.mock("../../src/rag/vertex-embedding-adapter", () => ({
  CANONICAL_VERTEX_EMBEDDING_MODEL: "gemini-embedding-001",
  CANONICAL_VERTEX_EMBEDDING_DIMS: 768,
  embedTextWithVertex: embedTextWithVertexMock
}))

type MemoryKind = "branch-summary" | "section-summary" | "claim-evidence-summary"

function buildEmbeddingVector(dimensions = 768, value = 0.01): number[] {
  return Array.from({ length: dimensions }, (_, index) => (index === 0 ? value : 0.01))
}

function toVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`
}

async function ensureUserRow(userId: string): Promise<void> {
  await queryDb(
    `
      insert into users (id, display_name)
      values ($1, $2)
      on conflict (id) do nothing
    `,
    [userId, `user-${userId.slice(0, 8)}`]
  )
}

async function insertMemoryRecordFixture(input: {
  id: string
  ownerUserId: string
  kind: MemoryKind
  summary: string
  createdAt: string
  pageKind?: "article" | "thread" | "post" | "generic"
  sourceDomain?: string
}): Promise<void> {
  await ensureUserRow(input.ownerUserId)
  await queryDb(
    `
      insert into memory_records (
        id, owner_user_id, kind, summary, retrieval_text,
        source_url, source_domain, page_kind, snapshot_captured_at,
        extractor_id, skeleton_version, page_id, canonical_url, evidence,
        write_source, created_at
      ) values (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9,
        $10, $11, $12, $13, $14::jsonb,
        $15, $16
      )
    `,
    [
      input.id,
      input.ownerUserId,
      input.kind,
      input.summary,
      input.summary,
      "https://news.ycombinator.com/item?id=43199999",
      input.sourceDomain ?? "news.ycombinator.com",
      input.pageKind ?? "thread",
      "2026-03-05T09:10:00.000Z",
      "generic+hacker-news-enhancer",
      8,
      "hn-43199999",
      "https://news.ycombinator.com/item?id=43199999",
      JSON.stringify({ referencedNodeIds: ["comment-1"] }),
      "analyze",
      input.createdAt
    ]
  )
}

async function insertEmbeddingFixture(input: {
  recordId: string
  ownerUserId: string
  value?: number
}): Promise<void> {
  await queryDb(
    `
      insert into memory_record_embeddings (
        record_id, owner_user_id, embedding_model, embedding_dims, embedding, content_hash
      ) values (
        $1, $2, $3, $4, $5::vector, $6
      )
    `,
    [
      input.recordId,
      input.ownerUserId,
      "text-embedding-004",
      768,
      toVectorLiteral(buildEmbeddingVector(768, input.value ?? 0.01)),
      `hash-${input.recordId}`
    ]
  )
}

async function loadRetrievalServiceModule() {
  try {
    return await import("../../src/rag/retrieval-service")
  } catch {
    throw new Error("retrieval-service module must exist for owner-scoped retrieval")
  }
}

describe("retrieval service contract (red)", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "thread-atlas")
    vi.stubEnv("GOOGLE_CLOUD_LOCATION", "us-central1")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    embedTextWithVertexMock.mockClear()
  })

  it("applies owner scope + page/domain filter + recent-first + top-k", async () => {
    const retrieval = await loadRetrievalServiceModule()

    expect(typeof retrieval.retrieveMemoryCandidates).toBe("function")

    // RED 의도: 실제 DB 기반 retrieval 동작을 고정한다.
    const tableCheck = await queryDb<{ regclass: string | null }>(
      "select to_regclass('public.memory_records') as regclass"
    )
    expect(tableCheck.rows[0]?.regclass).toBeTruthy()

    const ownerA = randomUUID()
    const ownerB = randomUUID()
    const oldBranch = randomUUID()
    const newBranch = randomUUID()
    const wrongPageKind = randomUUID()
    const wrongSourceDomain = randomUUID()
    const otherOwner = randomUUID()

    await insertMemoryRecordFixture({
      id: oldBranch,
      ownerUserId: ownerA,
      kind: "branch-summary",
      summary: "ownerA branch shared",
      createdAt: "2026-03-01T00:00:00.000Z"
    })
    await insertEmbeddingFixture({ recordId: oldBranch, ownerUserId: ownerA, value: 0.01 })

    await insertMemoryRecordFixture({
      id: newBranch,
      ownerUserId: ownerA,
      kind: "branch-summary",
      summary: "ownerA branch shared",
      createdAt: "2026-03-06T00:00:00.000Z"
    })
    await insertEmbeddingFixture({ recordId: newBranch, ownerUserId: ownerA, value: 0.01 })

    await insertMemoryRecordFixture({
      id: wrongPageKind,
      ownerUserId: ownerA,
      kind: "section-summary",
      summary: "ownerA article summary",
      createdAt: "2026-03-07T00:00:00.000Z"
    })
    await insertEmbeddingFixture({ recordId: wrongPageKind, ownerUserId: ownerA, value: 0.01 })
    await queryDb("update memory_records set page_kind = 'article' where id = $1", [wrongPageKind])

    await insertMemoryRecordFixture({
      id: wrongSourceDomain,
      ownerUserId: ownerA,
      kind: "branch-summary",
      summary: "ownerA other domain summary",
      createdAt: "2026-03-08T00:00:00.000Z"
    })
    await insertEmbeddingFixture({ recordId: wrongSourceDomain, ownerUserId: ownerA, value: 0.01 })
    await queryDb("update memory_records set source_domain = 'example.com' where id = $1", [wrongSourceDomain])

    await insertMemoryRecordFixture({
      id: otherOwner,
      ownerUserId: ownerB,
      kind: "branch-summary",
      summary: "ownerB branch",
      createdAt: "2026-03-07T00:00:00.000Z"
    })
    await insertEmbeddingFixture({ recordId: otherOwner, ownerUserId: ownerB, value: 0.01 })

    const result = await retrieval.retrieveMemoryCandidates({
      ownerUserId: ownerA,
      queryText: "ownerA branch shared",
      limit: 2,
      pageKind: "thread",
      sourceDomain: "news.ycombinator.com"
    })

    expect(embedTextWithVertexMock).toHaveBeenCalledWith(
      "ownerA branch shared",
      "RETRIEVAL_QUERY"
    )

    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBeLessThanOrEqual(2)
    expect(result.map((candidate: { ownerUserId: string }) => candidate.ownerUserId)).toEqual([
      ownerA,
      ownerA
    ])
    expect(result.map((candidate: { kind: MemoryKind }) => candidate.kind)).toEqual([
      "branch-summary",
      "branch-summary"
    ])
    expect(result.map((candidate: { recordId: string }) => candidate.recordId)).toEqual([
      newBranch,
      oldBranch
    ])
  })

  it("rejects blank ownerUserId", async () => {
    const retrieval = await loadRetrievalServiceModule()

    await expect(
      retrieval.retrieveMemoryCandidates({
        ownerUserId: "  ",
        queryText: "websocket",
        limit: 8
      })
    ).rejects.toThrow()
  })

  it("defaults top-k to 8 when limit is omitted", async () => {
    const retrieval = await loadRetrievalServiceModule()

    expect(typeof retrieval.retrieveMemoryCandidates).toBe("function")

    const ownerId = randomUUID()
    const recordIds = Array.from({ length: 10 }, () => randomUUID())

    for (const [index, recordId] of recordIds.entries()) {
      await insertMemoryRecordFixture({
        id: recordId,
        ownerUserId: ownerId,
        kind: "branch-summary",
        summary: `ownerC branch ${index}`,
        createdAt: `2026-03-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`
      })
      await insertEmbeddingFixture({
        recordId,
        ownerUserId: ownerId,
        value: 0.02
      })
    }

    const result = await retrieval.retrieveMemoryCandidates({
      ownerUserId: ownerId,
      queryText: "ownerC branch"
    })
    expect(embedTextWithVertexMock).toHaveBeenCalledWith("ownerC branch", "RETRIEVAL_QUERY")
    expect(result.length).toBeLessThanOrEqual(8)
  })

  it("does not lose filtered matches to unfiltered vector top-k truncation", async () => {
    const retrieval = await loadRetrievalServiceModule()
    const ownerId = randomUUID()
    const matchingRecord = randomUUID()

    for (let index = 0; index < 16; index += 1) {
      const distractorId = randomUUID()
      await insertMemoryRecordFixture({
        id: distractorId,
        ownerUserId: ownerId,
        kind: "branch-summary",
        summary: `filtered distractor ${index}`,
        createdAt: `2026-03-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
        pageKind: "article"
      })
      await insertEmbeddingFixture({
        recordId: distractorId,
        ownerUserId: ownerId,
        value: 0.24
      })
    }

    await insertMemoryRecordFixture({
      id: matchingRecord,
      ownerUserId: ownerId,
      kind: "branch-summary",
      summary: "thread only matching candidate",
      createdAt: "2026-03-20T00:00:00.000Z",
      pageKind: "thread",
      sourceDomain: "news.ycombinator.com"
    })
    await insertEmbeddingFixture({
      recordId: matchingRecord,
      ownerUserId: ownerId,
      value: 0.2
    })

    const result = await retrieval.retrieveMemoryCandidates({
      ownerUserId: ownerId,
      queryText: "12345678901234567890",
      limit: 1,
      pageKind: "thread",
      sourceDomain: "news.ycombinator.com"
    })

    expect(result).toHaveLength(1)
    expect(result[0]?.recordId).toBe(matchingRecord)
  })

  it("requires provider config because query embedding must come from Vertex", async () => {
    const retrieval = await loadRetrievalServiceModule()
    const ownerId = randomUUID()
    const recordId = randomUUID()
    await insertMemoryRecordFixture({
      id: recordId,
      ownerUserId: ownerId,
      kind: "branch-summary",
      summary: "owner retrieval sample",
      createdAt: "2026-03-10T00:00:00.000Z"
    })
    await insertEmbeddingFixture({
      recordId,
      ownerUserId: ownerId,
      value: 0.03
    })
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "")
    vi.stubEnv("GOOGLE_CLOUD_LOCATION", "")

    await expect(
      retrieval.retrieveMemoryCandidates({
        ownerUserId: ownerId,
        queryText: "owner retrieval sample",
        limit: 3
      })
    ).rejects.toMatchObject({
      code: "EMBEDDING_PROVIDER_CONFIG_MISSING"
    })
  })
})
