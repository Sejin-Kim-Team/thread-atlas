import type { StateSnapshot, Claim, KeyComment } from "@threadatlas/shared"
import { createLogger } from "../runtime/logger"

const logger = createLogger("agent/internal-tools")

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScoredClaimMatch {
  claimId: string
  statement: string
  stance: string
  score: number
  relatedCommentIds: string[]
}

export interface ClaimAnalysis {
  claimId: string
  statement: string
  strength: "strong" | "moderate" | "weak" | "unknown"
  strongestRebuttal: string | null
  evidenceSummary: string
}

// ---------------------------------------------------------------------------
// searchThread – local token-overlap scoring against snapshot semantics
// ---------------------------------------------------------------------------

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1)
  )
}

function tokenOverlapScore(queryTokens: Set<string>, text: string): number {
  if (queryTokens.size === 0) return 0
  const textTokens = tokenize(text)
  let overlap = 0
  for (const token of queryTokens) {
    if (textTokens.has(token)) overlap += 1
  }
  return overlap / queryTokens.size
}

function findRelatedComments(claimId: string, keyComments: KeyComment[]): string[] {
  return keyComments
    .filter((kc) => kc.claimId === claimId)
    .map((kc) => kc.commentId)
}

export async function searchThread(
  query: string,
  snapshot: StateSnapshot
): Promise<{ matches: ScoredClaimMatch[]; conclusion: string }> {
  const claims = snapshot.semantics?.claims ?? []
  const keyComments = snapshot.semantics?.keyComments ?? []

  if (claims.length === 0) {
    return { matches: [], conclusion: "No claims available in current thread semantics" }
  }

  const queryTokens = tokenize(query)

  const scored: ScoredClaimMatch[] = claims
    .map((claim) => ({
      claimId: claim.id,
      statement: claim.statement,
      stance: claim.stance,
      score: tokenOverlapScore(queryTokens, claim.statement + " " + claim.evidence.join(" ")),
      relatedCommentIds: findRelatedComments(claim.id, keyComments)
    }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)

  return {
    matches: scored,
    conclusion: `Found ${scored.length} matches across ${claims.length} claims`
  }
}

// ---------------------------------------------------------------------------
// searchMemory – delegates to RAG retrieval pipeline
// ---------------------------------------------------------------------------

export async function searchMemory(
  query: string,
  ownerUserId: string
): Promise<{ matches: Array<{ recordId: string; summary: string; kind: string; similarityScore: number }> }> {
  try {
    const { retrieveMemoryCandidates } = await import("../rag/retrieval-service")
    const candidates = await retrieveMemoryCandidates({
      ownerUserId,
      queryText: query,
      limit: 5
    })
    return {
      matches: candidates.map((c) => ({
        recordId: c.recordId,
        summary: c.summary,
        kind: c.kind,
        similarityScore: c.similarityScore
      }))
    }
  } catch (error) {
    logger.warn("search-memory-failed", { ownerUserId, error })
    return { matches: [] }
  }
}

// ---------------------------------------------------------------------------
// analyzeClaims – Gemini evaluates evidence strength per claim
// ---------------------------------------------------------------------------

function extractJsonObject(rawText: string): string | null {
  const normalized = rawText.trim()
  if (normalized.startsWith("{") && normalized.endsWith("}")) {
    return normalized
  }
  const match = normalized.match(/\{[\s\S]*\}/)
  return match ? match[0] : null
}

function safeParseClaim(json: string, claimId: string, statement: string): ClaimAnalysis {
  try {
    const parsed = JSON.parse(json)
    return {
      claimId,
      statement,
      strength: ["strong", "moderate", "weak"].includes(parsed.strength) ? parsed.strength : "unknown",
      strongestRebuttal: typeof parsed.strongestRebuttal === "string" ? parsed.strongestRebuttal : null,
      evidenceSummary: typeof parsed.evidenceSummary === "string" ? parsed.evidenceSummary : "Analysis unavailable"
    }
  } catch {
    return { claimId, statement, strength: "unknown", strongestRebuttal: null, evidenceSummary: "Analysis unavailable" }
  }
}

export async function analyzeClaims(
  claimIds: string[],
  snapshot: StateSnapshot,
  generateText: (prompt: string) => Promise<string>
): Promise<{ evidenceAnalysis: ClaimAnalysis[] }> {
  const allClaims = snapshot.semantics?.claims ?? []
  const claimMap = new Map<string, Claim>(allClaims.map((c) => [c.id, c]))

  const results: ClaimAnalysis[] = []

  for (const claimId of claimIds) {
    const claim = claimMap.get(claimId)
    if (!claim) {
      results.push({
        claimId,
        statement: "",
        strength: "unknown",
        strongestRebuttal: null,
        evidenceSummary: `Claim ${claimId} not found in current thread`
      })
      continue
    }

    try {
      const prompt = [
        "Evaluate the evidence strength for this claim from an online discussion.",
        `Claim (${claim.stance}): "${claim.statement}"`,
        `Evidence: ${claim.evidence.join("; ") || "none provided"}`,
        `Counter-arguments: ${claim.counters.join("; ") || "none"}`,
        "Respond with JSON: {\"strength\": \"strong\"|\"moderate\"|\"weak\", \"strongestRebuttal\": string|null, \"evidenceSummary\": string}"
      ].join("\n")

      const raw = await generateText(prompt)
      const jsonStr = extractJsonObject(raw)
      results.push(
        jsonStr
          ? safeParseClaim(jsonStr, claimId, claim.statement)
          : { claimId, statement: claim.statement, strength: "unknown", strongestRebuttal: null, evidenceSummary: "Parse failed" }
      )
    } catch (error) {
      logger.warn("analyze-claim-failed", { claimId, error })
      results.push({ claimId, statement: claim.statement, strength: "unknown", strongestRebuttal: null, evidenceSummary: "Analysis failed" })
    }
  }

  return { evidenceAnalysis: results }
}

// ---------------------------------------------------------------------------
// compareClaims – Gemini compares two claim statements
// ---------------------------------------------------------------------------

export async function compareClaims(
  claimA: string,
  claimB: string,
  generateText: (prompt: string) => Promise<string>
): Promise<{ similarity: string; commonGround: string[]; differences: string[]; evolution: string }> {
  const fallback = {
    similarity: "unknown",
    commonGround: [] as string[],
    differences: [claimA, claimB],
    evolution: "Comparison unavailable"
  }

  try {
    const prompt = [
      "Compare these two claims from an online discussion and analyze their relationship.",
      `Claim A: "${claimA}"`,
      `Claim B: "${claimB}"`,
      "Respond with JSON: {\"similarity\": string, \"commonGround\": string[], \"differences\": string[], \"evolution\": string}"
    ].join("\n")

    const raw = await generateText(prompt)
    const jsonStr = extractJsonObject(raw)
    if (!jsonStr) return fallback

    const parsed = JSON.parse(jsonStr)
    return {
      similarity: typeof parsed.similarity === "string" ? parsed.similarity : "unknown",
      commonGround: Array.isArray(parsed.commonGround) ? parsed.commonGround.filter((s: unknown) => typeof s === "string") : [],
      differences: Array.isArray(parsed.differences) ? parsed.differences.filter((s: unknown) => typeof s === "string") : [claimA, claimB],
      evolution: typeof parsed.evolution === "string" ? parsed.evolution : "Comparison unavailable"
    }
  } catch (error) {
    logger.warn("compare-claims-failed", { error })
    return fallback
  }
}
