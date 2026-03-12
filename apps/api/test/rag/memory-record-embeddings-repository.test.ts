import { describe, expect, it } from "vitest"
import { queryDb } from "../../src/db/pool"

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

async function ensureMemoryRecordRow(recordId: string, ownerUserId: string): Promise<void> {
  await ensureUserRow(ownerUserId)
  await queryDb("delete from memory_record_embeddings where record_id = $1", [recordId])
  await queryDb("delete from memory_records where id = $1", [recordId])
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
      recordId,
      ownerUserId,
      "branch-summary",
      `record-${recordId.slice(0, 8)}`,
      `retrieval-${recordId.slice(0, 8)}`,
      "https://news.ycombinator.com/item?id=1",
      "news.ycombinator.com",
      "thread",
      "2026-03-07T10:00:00.000Z",
      "generic",
      1,
      "page-1",
      "https://news.ycombinator.com/item?id=1",
      JSON.stringify({ referencedNodeIds: ["comment-1"] }),
      "analyze",
      "2026-03-07T10:00:00.000Z"
    ]
  )
}

async function ensureEmbeddingRecordForeignKey(): Promise<void> {
  await queryDb(
    `
      delete from memory_record_embeddings mre
      where not exists (
        select 1
        from memory_records mr
        where mr.id = mre.record_id
      )
    `
  )
}

async function loadEmbeddingRepository() {
  try {
    return await import("../../src/rag/memory-record-embeddings-repository")
  } catch {
    throw new Error("memory-record-embeddings-repository module must exist for RAG persistence")
  }
}

describe("memory record embeddings repository contract (red)", () => {
  it("upserts and reads embedding by recordId", async () => {
    const repo = await loadEmbeddingRepository()
    await ensureEmbeddingRecordForeignKey()
    await ensureMemoryRecordRow(
      "00000000-0000-0000-0000-000000000201",
      "00000000-0000-0000-0000-000000000101"
    )

    expect(typeof repo.upsertMemoryRecordEmbedding).toBe("function")
    expect(typeof repo.getMemoryRecordEmbeddingByRecordId).toBe("function")

    await repo.upsertMemoryRecordEmbedding({
      recordId: "00000000-0000-0000-0000-000000000201",
      ownerUserId: "00000000-0000-0000-0000-000000000101",
      embeddingModel: "text-embedding-004",
      embeddingDims: 768,
      embedding: Array.from({ length: 768 }, (_, i) => (i % 7) / 10),
      contentHash: "hash-201"
    })

    const found = await repo.getMemoryRecordEmbeddingByRecordId("00000000-0000-0000-0000-000000000201")
    expect(found).toMatchObject({
      recordId: "00000000-0000-0000-0000-000000000201",
      ownerUserId: "00000000-0000-0000-0000-000000000101",
      embeddingModel: "text-embedding-004",
      embeddingDims: 768
    })
  })

  it("rejects embedding length mismatch", async () => {
    const repo = await loadEmbeddingRepository()

    await expect(
      repo.upsertMemoryRecordEmbedding({
        recordId: "00000000-0000-0000-0000-000000000202",
        ownerUserId: "00000000-0000-0000-0000-000000000101",
        embeddingModel: "text-embedding-004",
        embeddingDims: 768,
        embedding: [0.1, 0.2, 0.3],
        contentHash: "hash-202"
      })
    ).rejects.toThrow()
  })

  it("returns null for missing embedding row", async () => {
    const repo = await loadEmbeddingRepository()
    const missing = await repo.getMemoryRecordEmbeddingByRecordId("00000000-0000-0000-0000-000000000299")
    expect(missing).toBeNull()
  })

  it("rejects orphan embedding row without parent memory record", async () => {
    const repo = await loadEmbeddingRepository()
    await ensureEmbeddingRecordForeignKey()
    await ensureUserRow("00000000-0000-0000-0000-000000000101")
    await queryDb("delete from memory_record_embeddings where record_id = $1", [
      "00000000-0000-0000-0000-000000000298"
    ])
    await queryDb("delete from memory_records where id = $1", ["00000000-0000-0000-0000-000000000298"])

    await expect(
      repo.upsertMemoryRecordEmbedding({
        recordId: "00000000-0000-0000-0000-000000000298",
        ownerUserId: "00000000-0000-0000-0000-000000000101",
        embeddingModel: "text-embedding-004",
        embeddingDims: 768,
        embedding: Array.from({ length: 768 }, (_, i) => (i % 7) / 10),
        contentHash: "hash-298"
      })
    ).rejects.toThrow()
  })
})
