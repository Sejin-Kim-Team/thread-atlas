import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  clientQuery: vi.fn(),
  release: vi.fn(),
  insertMemoryRecord: vi.fn(),
  upsertMemoryRecordEmbedding: vi.fn(),
  embedTextWithVertex: vi.fn(),
  ensureDatabaseMigrations: vi.fn()
}))

vi.mock("../../src/db/pool", () => ({
  getPool: () => ({
    connect: mocks.connect
  })
}))

vi.mock("../../src/db/migrate", () => ({
  ensureDatabaseMigrations: mocks.ensureDatabaseMigrations
}))

vi.mock("../../src/rag/memory-records-repository", () => ({
  insertMemoryRecord: mocks.insertMemoryRecord
}))

vi.mock("../../src/rag/memory-record-embeddings-repository", () => ({
  upsertMemoryRecordEmbedding: mocks.upsertMemoryRecordEmbedding
}))

vi.mock("../../src/rag/vertex-embedding-adapter", () => ({
  embedTextWithVertex: mocks.embedTextWithVertex,
  isEmbeddingProviderError: (error: unknown) =>
    Boolean(
      error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: string }).code?.startsWith("EMBEDDING_PROVIDER_")
    )
}))

function buildRecord(ownerUserId: string, id = "mem-record-1") {
  return {
    id,
    ownerUserId,
    kind: "branch-summary",
    summary: "branch summary",
    keywords: ["websocket"],
    entities: ["WebSocket"],
    provenance: {
      sourceUrl: "https://news.ycombinator.com/item?id=43199999",
      pageKind: "thread" as const,
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
      openMode: "new-tab" as const
    },
    evidence: {
      textSpans: ["branch summary"],
      referencedNodeIds: ["comment-43199977"]
    }
  }
}

describe("ingestMemoryRecords", () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.connect.mockReset()
    mocks.clientQuery.mockReset()
    mocks.release.mockReset()
    mocks.insertMemoryRecord.mockReset()
    mocks.upsertMemoryRecordEmbedding.mockReset()
    mocks.embedTextWithVertex.mockReset()
    mocks.ensureDatabaseMigrations.mockReset()

    mocks.connect.mockResolvedValue({
      query: mocks.clientQuery,
      release: mocks.release
    })
    mocks.clientQuery.mockResolvedValue({
      rowCount: 0,
      rows: []
    })
    mocks.insertMemoryRecord.mockResolvedValue({
      id: "mem-record-1"
    })
    mocks.upsertMemoryRecordEmbedding.mockResolvedValue(undefined)
    mocks.ensureDatabaseMigrations.mockResolvedValue(undefined)
    mocks.embedTextWithVertex.mockResolvedValue({
      embeddingModel: "gemini-embedding-001",
      embeddingDims: 768,
      embedding: Array.from({ length: 768 }, () => 0.01)
    })
  })

  it("downgrades embedding provider failures to per-record rejection", async () => {
    const error = new Error("provider request failed")
    ;(error as Error & { code: string }).code = "EMBEDDING_PROVIDER_REQUEST_FAILED"
    mocks.embedTextWithVertex.mockRejectedValueOnce(error)

    const { ingestMemoryRecords } = await import("../../src/session/memory/ingest-records")
    const response = await ingestMemoryRecords(
      {
        source: "analyze",
        records: [buildRecord("00000000-0000-4000-8000-000000000111")]
      },
      "00000000-0000-4000-8000-000000000111"
    )

    expect(response.acceptedIds).toEqual([])
    expect(response.rejected).toContainEqual({
      id: "mem-record-1",
      reason: "not-storable"
    })
  })

  it("propagates infrastructure persistence failures", async () => {
    mocks.insertMemoryRecord.mockRejectedValueOnce(new Error("database unavailable"))

    const { ingestMemoryRecords } = await import("../../src/session/memory/ingest-records")

    await expect(
      ingestMemoryRecords(
        {
          source: "analyze",
          records: [buildRecord("00000000-0000-4000-8000-000000000112")]
        },
        "00000000-0000-4000-8000-000000000112"
      )
    ).rejects.toThrow("database unavailable")
  })

  it("rejects records with non-numeric skeletonVersion before DB write", async () => {
    const invalidRecord = buildRecord(
      "00000000-0000-4000-8000-000000000114"
    ) as Record<string, unknown>
    invalidRecord.provenance = {
      ...(invalidRecord.provenance as Record<string, unknown>),
      skeletonVersion: "v8"
    }

    const { ingestMemoryRecords } = await import("../../src/session/memory/ingest-records")
    const response = await ingestMemoryRecords(
      {
        source: "analyze",
        records: [invalidRecord as unknown as ReturnType<typeof buildRecord>]
      },
      "00000000-0000-4000-8000-000000000114"
    )

    expect(response.acceptedIds).toEqual([])
    expect(response.rejected).toContainEqual({
      id: "mem-record-1",
      reason: "missing-provenance"
    })
    expect(mocks.insertMemoryRecord).not.toHaveBeenCalled()
    expect(mocks.upsertMemoryRecordEmbedding).not.toHaveBeenCalled()
  })

  it("returns persisted id when repository normalizes blank record id", async () => {
    mocks.insertMemoryRecord.mockResolvedValueOnce({
      id: "generated-memory-id"
    })

    const { ingestMemoryRecords } = await import("../../src/session/memory/ingest-records")
    const response = await ingestMemoryRecords(
      {
        source: "analyze",
        records: [buildRecord("00000000-0000-4000-8000-000000000115", "   ")]
      },
      "00000000-0000-4000-8000-000000000115"
    )

    expect(response.acceptedIds).toEqual(["generated-memory-id"])
    expect(response.rejected).toEqual([])
  })

  it("rejects records with invalid snapshotCapturedAt before DB write", async () => {
    const invalidRecord = buildRecord(
      "00000000-0000-4000-8000-000000000116"
    ) as Record<string, unknown>
    invalidRecord.provenance = {
      ...(invalidRecord.provenance as Record<string, unknown>),
      snapshotCapturedAt: "not-a-date"
    }

    const { ingestMemoryRecords } = await import("../../src/session/memory/ingest-records")
    const response = await ingestMemoryRecords(
      {
        source: "analyze",
        records: [invalidRecord as unknown as ReturnType<typeof buildRecord>]
      },
      "00000000-0000-4000-8000-000000000116"
    )

    expect(response.acceptedIds).toEqual([])
    expect(response.rejected).toContainEqual({
      id: "mem-record-1",
      reason: "missing-provenance"
    })
    expect(mocks.insertMemoryRecord).not.toHaveBeenCalled()
  })

  it("rejects records with unsupported navigation openMode before DB write", async () => {
    const invalidRecord = buildRecord(
      "00000000-0000-4000-8000-000000000117"
    ) as Record<string, unknown>
    invalidRecord.navigation = {
      ...(invalidRecord.navigation as Record<string, unknown>),
      openMode: "popup"
    }

    const { ingestMemoryRecords } = await import("../../src/session/memory/ingest-records")
    const response = await ingestMemoryRecords(
      {
        source: "analyze",
        records: [invalidRecord as unknown as ReturnType<typeof buildRecord>]
      },
      "00000000-0000-4000-8000-000000000117"
    )

    expect(response.acceptedIds).toEqual([])
    expect(response.rejected).toContainEqual({
      id: "mem-record-1",
      reason: "not-storable"
    })
    expect(mocks.insertMemoryRecord).not.toHaveBeenCalled()
  })

  it("rejects records with invalid createdAt before DB write", async () => {
    const invalidRecord = buildRecord(
      "00000000-0000-4000-8000-000000000118"
    ) as Record<string, unknown>
    invalidRecord.createdAt = "not-a-date"

    const { ingestMemoryRecords } = await import("../../src/session/memory/ingest-records")
    const response = await ingestMemoryRecords(
      {
        source: "analyze",
        records: [invalidRecord as unknown as ReturnType<typeof buildRecord>]
      },
      "00000000-0000-4000-8000-000000000118"
    )

    expect(response.acceptedIds).toEqual([])
    expect(response.rejected).toContainEqual({
      id: "mem-record-1",
      reason: "not-storable"
    })
    expect(mocks.insertMemoryRecord).not.toHaveBeenCalled()
  })

  it("downgrades duplicate record id conflicts to per-record rejection", async () => {
    const duplicateError = new Error("duplicate key value violates unique constraint")
    Object.assign(duplicateError, {
      code: "23505",
      constraint: "memory_records_pkey",
      table: "memory_records"
    })
    mocks.insertMemoryRecord
      .mockResolvedValueOnce({ id: "mem-record-1" })
      .mockRejectedValueOnce(duplicateError)

    const { ingestMemoryRecords } = await import("../../src/session/memory/ingest-records")
    const response = await ingestMemoryRecords(
      {
        source: "analyze",
        records: [
          buildRecord("00000000-0000-4000-8000-000000000120", "mem-record-1"),
          buildRecord("00000000-0000-4000-8000-000000000120", "mem-record-1")
        ]
      },
      "00000000-0000-4000-8000-000000000120"
    )

    expect(response.acceptedIds).toEqual(["mem-record-1"])
    expect(response.rejected).toContainEqual({
      id: "mem-record-1",
      reason: "not-storable"
    })
  })

  it("ensures migrations before acquiring transaction connection", async () => {
    const calls: string[] = []
    mocks.ensureDatabaseMigrations.mockImplementationOnce(async () => {
      calls.push("migrate")
    })
    mocks.connect.mockImplementationOnce(async () => {
      calls.push("connect")
      return {
        query: mocks.clientQuery,
        release: mocks.release
      }
    })

    const { ingestMemoryRecords } = await import("../../src/session/memory/ingest-records")
    const response = await ingestMemoryRecords(
      {
        source: "analyze",
        records: [buildRecord("00000000-0000-4000-8000-000000000119")]
      },
      "00000000-0000-4000-8000-000000000119"
    )

    expect(response.acceptedIds).toEqual(["mem-record-1"])
    expect(calls).toEqual(["migrate", "connect"])
  })

  it("calls embedding provider before opening DB transaction", async () => {
    const calls: string[] = []
    mocks.embedTextWithVertex.mockImplementationOnce(async () => {
      calls.push("embed")
      return {
        embeddingModel: "gemini-embedding-001",
        embeddingDims: 768,
        embedding: Array.from({ length: 768 }, () => 0.01)
      }
    })
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql === "begin") {
        calls.push("begin")
      }
      return {
        rowCount: 0,
        rows: []
      }
    })

    const { ingestMemoryRecords } = await import("../../src/session/memory/ingest-records")
    const response = await ingestMemoryRecords(
      {
        source: "analyze",
        records: [buildRecord("00000000-0000-4000-8000-000000000113")]
      },
      "00000000-0000-4000-8000-000000000113"
    )

    expect(response.acceptedIds).toEqual(["mem-record-1"])
    expect(calls.slice(0, 2)).toEqual(["embed", "begin"])
  })
})
