import { ensureDatabaseMigrations } from "../db/migrate"
import { getPool } from "../db/pool"
import {
  SELECT_MEMORY_RECORD_EMBEDDING_BY_RECORD_ID_SQL,
  UPSERT_MEMORY_RECORD_EMBEDDING_SQL
} from "./memory-record-embeddings-repository.queries"
import { ensureOwnerUserRow, normalizeText, type Queryable } from "./repository-helpers"

const CANONICAL_EMBEDDING_DIMS = 768

export interface UpsertMemoryRecordEmbeddingInput {
  recordId: string
  ownerUserId: string
  embeddingModel: string
  embeddingDims: number
  embedding: number[]
  contentHash: string
}

export interface MemoryRecordEmbeddingRow {
  recordId: string
  ownerUserId: string
  embeddingModel: string
  embeddingDims: number
  embedding: number[]
  contentHash: string
  createdAt: string
}

interface MemoryRecordEmbeddingDbRow {
  record_id: string
  owner_user_id: string
  embedding_model: string
  embedding_dims: number
  embedding: string | number[]
  content_hash: string
  created_at: Date | string
}

function assertRequiredText(value: unknown, label: string): string {
  const normalized = normalizeText(value)
  if (!normalized) {
    throw new Error(`${label} is required`)
  }
  return normalized
}

function assertEmbeddingVector(input: { embeddingDims: number; embedding: number[] }): void {
  if (!Number.isInteger(input.embeddingDims) || input.embeddingDims !== CANONICAL_EMBEDDING_DIMS) {
    throw new Error("embeddingDims must be 768")
  }
  if (!Array.isArray(input.embedding) || input.embedding.length !== input.embeddingDims) {
    throw new Error("embedding length mismatch")
  }
}

function toVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`
}

function parseVector(raw: string | number[]): number[] {
  if (Array.isArray(raw)) {
    return raw
  }
  const trimmed = raw.trim()
  const withoutBrackets = trimmed.replace(/^\[/, "").replace(/\]$/, "")
  if (!withoutBrackets) {
    return []
  }
  return withoutBrackets.split(",").map((value) => Number(value))
}

function toMemoryRecordEmbeddingRow(row: MemoryRecordEmbeddingDbRow): MemoryRecordEmbeddingRow {
  return {
    recordId: row.record_id,
    ownerUserId: row.owner_user_id,
    embeddingModel: row.embedding_model,
    embeddingDims: row.embedding_dims,
    embedding: parseVector(row.embedding),
    contentHash: row.content_hash,
    createdAt: new Date(row.created_at).toISOString()
  }
}

async function resolveQueryable(db?: Queryable): Promise<Queryable> {
  return db ?? (await getPool())
}

export async function upsertMemoryRecordEmbedding(
  input: UpsertMemoryRecordEmbeddingInput,
  db?: Queryable
): Promise<MemoryRecordEmbeddingRow> {
  await ensureDatabaseMigrations()
  assertEmbeddingVector(input)

  const queryable = await resolveQueryable(db)
  const recordId = assertRequiredText(input.recordId, "recordId")
  const ownerUserId = assertRequiredText(input.ownerUserId, "ownerUserId")
  const embeddingModel = assertRequiredText(input.embeddingModel, "embeddingModel")
  const contentHash = assertRequiredText(input.contentHash, "contentHash")

  await ensureOwnerUserRow(queryable, ownerUserId)

  const upserted = await queryable.query<MemoryRecordEmbeddingDbRow>(UPSERT_MEMORY_RECORD_EMBEDDING_SQL, [
    recordId,
    ownerUserId,
    embeddingModel,
    input.embeddingDims,
    toVectorLiteral(input.embedding),
    contentHash
  ])

  const row = upserted.rows[0]
  if (!row) {
    throw new Error("failed to upsert memory embedding")
  }
  return toMemoryRecordEmbeddingRow(row)
}

export async function getMemoryRecordEmbeddingByRecordId(
  recordId: string
): Promise<MemoryRecordEmbeddingRow | null> {
  await ensureDatabaseMigrations()
  const normalizedRecordId = normalizeText(recordId)
  if (!normalizedRecordId) {
    return null
  }
  const found = await (await getPool()).query<MemoryRecordEmbeddingDbRow>(
    SELECT_MEMORY_RECORD_EMBEDDING_BY_RECORD_ID_SQL,
    [normalizedRecordId]
  )
  const row = found.rows[0]
  if (!row) {
    return null
  }
  return toMemoryRecordEmbeddingRow(row)
}
