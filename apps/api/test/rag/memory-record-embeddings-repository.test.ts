import { describe, expect, it } from "vitest"

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
})

