import { describe, expect, it } from "vitest"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function loadMemoryRecordsRepository() {
  try {
    return await import("../../src/rag/memory-records-repository")
  } catch {
    throw new Error("memory-records-repository module must exist for RAG persistence")
  }
}

describe("memory records repository contract (red)", () => {
  it("inserts a memory record and reads it by id", async () => {
    const repo = await loadMemoryRecordsRepository()

    expect(typeof repo.insertMemoryRecord).toBe("function")
    expect(typeof repo.getMemoryRecordById).toBe("function")

    const inserted = await repo.insertMemoryRecord({
      ownerUserId: "00000000-0000-0000-0000-000000000101",
      kind: "branch-summary",
      summary: "ws is better for interruption",
      retrievalText: "websocket interruption bidirectional updates",
      sourceUrl: "https://news.ycombinator.com/item?id=1",
      pageKind: "thread",
      snapshotCapturedAt: "2026-03-07T10:00:00.000Z",
      extractorId: "generic",
      skeletonVersion: 1,
      pageId: "page-1",
      canonicalUrl: "https://news.ycombinator.com/item?id=1",
      evidence: { referencedNodeIds: ["comment-1"] }
    })

    expect(inserted.id).toMatch(UUID_RE)

    const found = await repo.getMemoryRecordById(inserted.id)
    expect(found).toMatchObject({
      id: inserted.id,
      ownerUserId: "00000000-0000-0000-0000-000000000101",
      kind: "branch-summary"
    })
  })

  it("lists records by owner and by owner+kind", async () => {
    const repo = await loadMemoryRecordsRepository()

    expect(typeof repo.listMemoryRecordsByOwner).toBe("function")
    expect(typeof repo.listMemoryRecordsByOwnerAndKind).toBe("function")

    const byOwner = await repo.listMemoryRecordsByOwner({
      ownerUserId: "00000000-0000-0000-0000-000000000101",
      limit: 10
    })
    expect(Array.isArray(byOwner)).toBe(true)

    const byOwnerAndKind = await repo.listMemoryRecordsByOwnerAndKind({
      ownerUserId: "00000000-0000-0000-0000-000000000101",
      kind: "branch-summary",
      limit: 10
    })
    expect(Array.isArray(byOwnerAndKind)).toBe(true)
  })

  it("returns null for non-existing record id", async () => {
    const repo = await loadMemoryRecordsRepository()
    const missing = await repo.getMemoryRecordById("00000000-0000-0000-0000-000000000999")
    expect(missing).toBeNull()
  })
})

