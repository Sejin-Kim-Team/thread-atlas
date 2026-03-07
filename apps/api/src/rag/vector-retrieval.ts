import { ensureDatabaseMigrations } from "../db/migrate"
import { getPool } from "../db/pool"
import { normalizeLimit, normalizeText } from "./repository-helpers"
import { SEARCH_BY_VECTOR_SQL } from "./vector-retrieval.queries"

const CANONICAL_EMBEDDING_DIMS = 768
const DEFAULT_TOP_K = 8

export interface SearchByVectorInput {
  ownerUserId: string
  queryEmbedding: number[]
  topK?: number
}

export interface VectorSearchRow {
  recordId: string
  ownerUserId: string
  similarityScore: number
}

interface VectorSearchDbRow {
  record_id: string
  owner_user_id: string
  similarity_score: number | string
}

function assertOwnerUserId(ownerUserId: unknown): string {
  const normalized = normalizeText(ownerUserId)
  if (!normalized) {
    throw new Error("ownerUserId is required")
  }
  return normalized
}

function assertEmbeddingDimensions(queryEmbedding: number[]): void {
  if (!Array.isArray(queryEmbedding) || queryEmbedding.length !== CANONICAL_EMBEDDING_DIMS) {
    throw new Error("queryEmbedding length mismatch")
  }
  for (const value of queryEmbedding) {
    if (!Number.isFinite(value)) {
      throw new Error("queryEmbedding includes non-finite value")
    }
  }
}

function toVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`
}

export async function searchByVector(input: SearchByVectorInput): Promise<VectorSearchRow[]> {
  await ensureDatabaseMigrations()
  const ownerUserId = assertOwnerUserId(input.ownerUserId)
  assertEmbeddingDimensions(input.queryEmbedding)
  const topK = normalizeLimit(input.topK, DEFAULT_TOP_K)

  const result = await getPool().query<VectorSearchDbRow>(SEARCH_BY_VECTOR_SQL, [
    ownerUserId,
    toVectorLiteral(input.queryEmbedding),
    topK
  ])

  return result.rows.map((row) => ({
    recordId: row.record_id,
    ownerUserId: row.owner_user_id,
    similarityScore: Number(row.similarity_score)
  }))
}
