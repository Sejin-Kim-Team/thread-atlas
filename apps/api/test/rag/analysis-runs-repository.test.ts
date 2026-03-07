import { describe, expect, it } from "vitest"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function loadAnalysisRunsRepository() {
  try {
    return await import("../../src/rag/analysis-runs-repository")
  } catch {
    throw new Error("analysis-runs-repository module must exist for RAG persistence")
  }
}

describe("analysis runs repository contract (red)", () => {
  it("inserts an analysis run and returns run id", async () => {
    const repo = await loadAnalysisRunsRepository()

    expect(typeof repo.insertAnalysisRun).toBe("function")

    const inserted = await repo.insertAnalysisRun({
      ownerUserId: "00000000-0000-0000-0000-000000000301",
      tabId: 11,
      mode: "seed",
      snapshotPageId: "page-seed-1",
      snapshotUrl: "https://example.com/a",
      normalizedMode: "discussion",
      summaryCandidates: [{ id: "cand-1", summary: "seed summary" }],
      visualSummaries: []
    })

    expect(inserted.id).toMatch(UUID_RE)
    expect(typeof inserted.createdAt).toBe("string")
  })

  it("lists analysis runs by owner and mode", async () => {
    const repo = await loadAnalysisRunsRepository()

    expect(typeof repo.listAnalysisRunsByOwner).toBe("function")

    const rows = await repo.listAnalysisRunsByOwner({
      ownerUserId: "00000000-0000-0000-0000-000000000301",
      mode: "seed",
      limit: 10
    })
    expect(Array.isArray(rows)).toBe(true)
  })

  it("returns empty list when no run exists for owner", async () => {
    const repo = await loadAnalysisRunsRepository()
    const rows = await repo.listAnalysisRunsByOwner({
      ownerUserId: "00000000-0000-0000-0000-000000000399",
      limit: 5
    })
    expect(rows).toEqual([])
  })
})

