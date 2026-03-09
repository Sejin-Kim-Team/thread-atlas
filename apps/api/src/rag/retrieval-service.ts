import { ensureDatabaseMigrations } from "../db/migrate"
import { getPool } from "../db/pool"
import { createLogger } from "../runtime/logger"
import { normalizeLimit, normalizeText } from "./repository-helpers"
import { SELECT_RETRIEVAL_CANDIDATE_ROWS_SQL } from "./retrieval-service.queries"
import { embedTextWithVertex } from "./vertex-embedding-adapter"
import { searchByVector } from "./vector-retrieval"

const DEFAULT_TOP_K = 8
const logger = createLogger("rag/retrieval-service")

export interface RetrieveMemoryInput {
  ownerUserId: string
  queryText: string
  limit?: number
  pageKind?: "article" | "thread" | "post" | "generic"
  sourceDomain?: string
}

export interface RetrievedMemoryCandidate {
  recordId: string
  ownerUserId: string
  summary: string
  kind: "branch-summary" | "section-summary" | "claim-evidence-summary"
  canonicalUrl: string
  pageTitle?: string
  nodeAnchor?: Record<string, unknown>
  openMode?: "same-tab" | "new-tab" | "sidepanel-preview"
  similarityScore: number
}

interface RetrievalCandidateDbRow {
  record_id: string
  owner_user_id: string
  summary: string
  retrieval_text: string
  kind: "branch-summary" | "section-summary" | "claim-evidence-summary"
  canonical_url: string
  page_title: string | null
  node_anchor: Record<string, unknown> | null
  open_mode: "same-tab" | "new-tab" | "sidepanel-preview" | null
  source_domain: string
  page_kind: "article" | "thread" | "post" | "generic"
  created_at: Date | string
}

function assertRequiredText(value: unknown, label: string): string {
  const normalized = normalizeText(value)
  if (!normalized) {
    throw new Error(`${label} is required`)
  }
  return normalized
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
}

function computeLexicalScore(queryText: string, retrievalText: string): number {
  const queryTokens = new Set(tokenize(queryText))
  if (queryTokens.size === 0) {
    return 0
  }
  const candidateTokens = new Set(tokenize(retrievalText))
  if (candidateTokens.size === 0) {
    return 0
  }
  let overlap = 0
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) {
      overlap += 1
    }
  }
  return overlap / queryTokens.size
}

export async function retrieveMemoryCandidates(
  input: RetrieveMemoryInput
): Promise<RetrievedMemoryCandidate[]> {
  await ensureDatabaseMigrations()
  const ownerUserId = assertRequiredText(input.ownerUserId, "ownerUserId")
  const queryText = assertRequiredText(input.queryText, "queryText")
  const limit = normalizeLimit(input.limit, DEFAULT_TOP_K)
  const pageKind = normalizeText(input.pageKind) as
    | "article"
    | "thread"
    | "post"
    | "generic"
    | null
  const sourceDomain = normalizeText(input.sourceDomain)
  const vectorTopK = Math.max(limit * 4, 16)
  const queryEmbeddingResult = await embedTextWithVertex(
    queryText,
    "RETRIEVAL_QUERY"
  )
  logger.info("memory-retrieval-started", {
    ownerUserId,
    limit,
    pageKind: pageKind ?? "any",
    sourceDomain: sourceDomain ?? "any",
    queryLength: queryText.length
  })
  const vectorSearchInput: {
    ownerUserId: string
    queryEmbedding: number[]
    topK: number
    pageKind?: "article" | "thread" | "post" | "generic"
    sourceDomain?: string
  } = {
    ownerUserId,
    queryEmbedding: queryEmbeddingResult.embedding,
    topK: vectorTopK
  }
  if (pageKind) {
    vectorSearchInput.pageKind = pageKind
  }
  if (sourceDomain) {
    vectorSearchInput.sourceDomain = sourceDomain
  }

  const vectorHits = await searchByVector(vectorSearchInput)
  if (vectorHits.length === 0) {
    logger.info("memory-retrieval-empty", {
      ownerUserId,
      pageKind: pageKind ?? "any",
      sourceDomain: sourceDomain ?? "any"
    })
    return []
  }

  const vectorScoreByRecordId = new Map(
    vectorHits.map((hit) => [hit.recordId, hit.similarityScore] as const)
  )
  const result = await (await getPool()).query<RetrievalCandidateDbRow>(SELECT_RETRIEVAL_CANDIDATE_ROWS_SQL, [
    ownerUserId,
    vectorHits.map((hit) => hit.recordId),
    pageKind,
    sourceDomain ?? null
  ])
  const ranked = result.rows.map((row) => {
    const vectorScore = vectorScoreByRecordId.get(row.record_id) ?? 0
    const lexicalScore = computeLexicalScore(queryText, row.retrieval_text)
    // 벡터 유사도와 텍스트 겹침을 함께 사용해 해커톤 수준의 lightweight rerank를 만든다.
    const similarityScore = Number((vectorScore * 0.8 + lexicalScore * 0.2).toFixed(6))
    const candidate: RetrievedMemoryCandidate = {
      recordId: row.record_id,
      ownerUserId: row.owner_user_id,
      summary: row.summary,
      kind: row.kind,
      canonicalUrl: row.canonical_url,
      similarityScore
    }
    if (row.page_title) {
      candidate.pageTitle = row.page_title
    }
    if (row.node_anchor) {
      candidate.nodeAnchor = row.node_anchor
    }
    if (row.open_mode) {
      candidate.openMode = row.open_mode
    }
    return candidate
  })

  ranked.sort((a, b) => {
    if (a.similarityScore !== b.similarityScore) {
      return b.similarityScore - a.similarityScore
    }
    const createdAtA = result.rows.find((row) => row.record_id === a.recordId)?.created_at
    const createdAtB = result.rows.find((row) => row.record_id === b.recordId)?.created_at
    return new Date(createdAtB ?? 0).getTime() - new Date(createdAtA ?? 0).getTime()
  })

  const selected = ranked.slice(0, limit)
  logger.info("memory-retrieval-completed", {
    ownerUserId,
    vectorHitCount: vectorHits.length,
    selectedCount: selected.length,
    topRecordId: selected[0]?.recordId ?? null,
    topSimilarityScore: selected[0]?.similarityScore ?? null
  })
  return selected
}
