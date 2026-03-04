import type { StateSnapshot } from "@threadatlas/shared"

export async function searchThread(_query: string, snapshot: StateSnapshot) {
  return {
    matches: snapshot.semantics?.keyComments ?? [],
    conclusion: "stubbed search_thread result"
  }
}

export async function searchMemory(_query: string) {
  return {
    matches: []
  }
}

export async function analyzeClaims(claimIds: string[]) {
  return {
    evidenceAnalysis: claimIds.map((claimId) => ({
      claimId,
      strongestRebuttal: null,
      strength: "unknown"
    }))
  }
}

export async function compareClaims(claimA: string, claimB: string) {
  return {
    similarity: "stub",
    commonGround: [],
    differences: [claimA, claimB],
    evolution: "stub"
  }
}
