import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"
import { queryDb } from "../../src/db/pool"

function buildEmbeddingVector(dimensions = 768, base = 0.01): number[] {
  return Array.from({ length: dimensions }, (_, index) => (index === 0 ? base : 0))
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

async function insertVectorFixture(input: {
  recordId: string
  ownerUserId: string
  createdAt: string
  embeddingBase?: number
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
      input.recordId,
      input.ownerUserId,
      "branch-summary",
      `record-${input.recordId.slice(0, 8)}`,
      `retrieval-${input.recordId.slice(0, 8)}`,
      "https://news.ycombinator.com/item?id=43199999",
      "news.ycombinator.com",
      "thread",
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
      toVectorLiteral(buildEmbeddingVector(768, input.embeddingBase ?? 0.01)),
      `hash-${input.recordId}`
    ]
  )
}

async function loadVectorRetrievalModule() {
  try {
    return await import("../../src/rag/vector-retrieval")
  } catch {
    throw new Error("vector-retrieval module must exist for pgvector retrieval adapter")
  }
}

describe("vector retrieval adapter contract (red)", () => {
  it("exposes pgvector query interface and keeps owner scope", async () => {
    const adapter = await loadVectorRetrievalModule()

    expect(typeof adapter.searchByVector).toBe("function")

    // RED 의도: pgvector 기반 조회 테이블/인터페이스가 실제로 존재해야 한다.
    const tableCheck = await queryDb<{ regclass: string | null }>(
      "select to_regclass('public.memory_record_embeddings') as regclass"
    )
    expect(tableCheck.rows[0]?.regclass).toBeTruthy()

    const ownerA = "00000000-0000-4000-8000-00000000d001"
    const ownerB = "00000000-0000-4000-8000-00000000e001"
    const ownerARecord = randomUUID()
    const ownerBRecord = randomUUID()

    await insertVectorFixture({
      recordId: ownerARecord,
      ownerUserId: ownerA,
      createdAt: "2026-03-06T00:00:00.000Z",
      embeddingBase: 0.2
    })
    await insertVectorFixture({
      recordId: ownerBRecord,
      ownerUserId: ownerB,
      createdAt: "2026-03-07T00:00:00.000Z",
      embeddingBase: 0.2
    })

    const result = await adapter.searchByVector({
      ownerUserId: ownerA,
      queryEmbedding: buildEmbeddingVector(768, 0.2),
      topK: 5
    })

    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBeGreaterThan(0)
    expect(
      result.map((item: { ownerUserId: string }) => item.ownerUserId).every((owner) => owner === ownerA)
    ).toBe(true)
  })

  it("rejects embedding length mismatch", async () => {
    const adapter = await loadVectorRetrievalModule()

    await expect(
      adapter.searchByVector({
        ownerUserId: "00000000-0000-4000-8000-00000000f001",
        queryEmbedding: [0.1, 0.2, 0.3],
        topK: 8
      })
    ).rejects.toThrow()
  })

  it("applies top-k limit to vector lookup result", async () => {
    const adapter = await loadVectorRetrievalModule()
    const ownerId = "00000000-0000-4000-8000-00000000a111"

    for (let i = 0; i < 4; i += 1) {
      await insertVectorFixture({
        recordId: randomUUID(),
        ownerUserId: ownerId,
        createdAt: `2026-03-0${i + 1}T00:00:00.000Z`,
        embeddingBase: 0.15
      })
    }

    const result = await adapter.searchByVector({
      ownerUserId: ownerId,
      queryEmbedding: buildEmbeddingVector(768, 0.15),
      topK: 2
    })

    expect(result.length).toBeLessThanOrEqual(2)
  })

  it("applies pageKind and sourceDomain filters before vector limit", async () => {
    const adapter = await loadVectorRetrievalModule()
    const ownerId = randomUUID()
    const matchingRecordId = randomUUID()

    for (let index = 0; index < 16; index += 1) {
      const distractorId = randomUUID()
      await insertVectorFixture({
        recordId: distractorId,
        ownerUserId: ownerId,
        createdAt: `2026-03-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
        embeddingBase: 0.2
      })
      await queryDb("update memory_records set page_kind = 'article' where id = $1", [distractorId])
    }

    await insertVectorFixture({
      recordId: matchingRecordId,
      ownerUserId: ownerId,
      createdAt: "2026-03-20T00:00:00.000Z",
      embeddingBase: 0.15
    })

    const result = await adapter.searchByVector({
      ownerUserId: ownerId,
      queryEmbedding: buildEmbeddingVector(768, 0.2),
      topK: 1,
      pageKind: "thread",
      sourceDomain: "news.ycombinator.com"
    })

    expect(result).toHaveLength(1)
    expect(result[0]?.recordId).toBe(matchingRecordId)
  })
})
