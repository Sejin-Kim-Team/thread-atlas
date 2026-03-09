import { randomUUID } from "node:crypto"
import { ensureDatabaseMigrations } from "../db/migrate"
import { getPool } from "../db/pool"
import {
  INSERT_MEMORY_RECORD_SQL,
  SELECT_MEMORY_RECORD_BY_ID_SQL,
  SELECT_MEMORY_RECORDS_BY_OWNER_AND_KIND_SQL,
  SELECT_MEMORY_RECORDS_BY_OWNER_SQL
} from "./memory-records-repository.queries"
import { ensureOwnerUserRow, normalizeLimit, normalizeText, type Queryable } from "./repository-helpers"

export type MemoryRecordKind =
  | "branch-summary"
  | "section-summary"
  | "claim-evidence-summary"

export interface MemoryRecordRow {
  id: string
  ownerUserId: string
  kind: MemoryRecordKind
  summary: string
  retrievalText: string
  canonicalUrl: string
  pageTitle?: string
  nodeAnchor?: Record<string, unknown>
  createdAt: string
}

export interface InsertMemoryRecordInput {
  id?: string
  ownerUserId: string
  kind: MemoryRecordKind
  summary: string
  retrievalText: string
  keywords?: string[]
  entities?: string[]
  sourceUrl: string
  sourceDomain?: string
  pageKind: "article" | "thread" | "post" | "generic"
  snapshotCapturedAt: string
  extractorId: string
  skeletonVersion: number
  pageId: string
  unitId?: string
  rootNodeIds?: string[]
  canonicalUrl: string
  pageTitle?: string
  pageAnchor?: string
  nodeAnchor?: Record<string, unknown>
  openMode?: "same-tab" | "new-tab" | "sidepanel-preview"
  evidence: Record<string, unknown>
  visual?: Record<string, unknown>
  kindPayload?: Record<string, unknown>
  writeSource?: "analyze" | "turn-completion" | "batch-repair"
  analysisId?: string
  createdAt?: string
}

interface MemoryRecordDbRow {
  id: string
  owner_user_id: string
  kind: MemoryRecordKind
  summary: string
  retrieval_text: string
  canonical_url: string
  page_title: string | null
  node_anchor: Record<string, unknown> | null
  created_at: Date | string
}

function resolveSourceDomain(sourceUrl: string, fallback: string | undefined): string {
  const normalizedFallback = normalizeText(fallback)
  if (normalizedFallback) {
    return normalizedFallback
  }
  try {
    const parsed = new URL(sourceUrl)
    return parsed.hostname || "unknown"
  } catch {
    return "unknown"
  }
}

function assertMemoryRecordKind(value: unknown): MemoryRecordKind {
  if (
    value === "branch-summary" ||
    value === "section-summary" ||
    value === "claim-evidence-summary"
  ) {
    return value
  }
  throw new Error("kind is invalid")
}

function assertRequiredText(value: unknown, label: string): string {
  const normalized = normalizeText(value)
  if (!normalized) {
    throw new Error(`${label} is required`)
  }
  return normalized
}

function toMemoryRecordRow(row: MemoryRecordDbRow): MemoryRecordRow {
  const result: MemoryRecordRow = {
    id: row.id,
    ownerUserId: row.owner_user_id,
    kind: row.kind,
    summary: row.summary,
    retrievalText: row.retrieval_text,
    canonicalUrl: row.canonical_url,
    createdAt: new Date(row.created_at).toISOString()
  }
  if (row.page_title) {
    result.pageTitle = row.page_title
  }
  if (row.node_anchor) {
    result.nodeAnchor = row.node_anchor
  }
  return result
}

async function resolveQueryable(db?: Queryable): Promise<Queryable> {
  return db ?? (await getPool())
}

export async function insertMemoryRecord(
  input: InsertMemoryRecordInput,
  db?: Queryable
): Promise<MemoryRecordRow> {
  await ensureDatabaseMigrations()

  const queryable = await resolveQueryable(db)
  const ownerUserId = assertRequiredText(input.ownerUserId, "ownerUserId")
  const kind = assertMemoryRecordKind(input.kind)
  const summary = assertRequiredText(input.summary, "summary")
  const retrievalText = assertRequiredText(input.retrievalText, "retrievalText")
  const sourceUrl = assertRequiredText(input.sourceUrl, "sourceUrl")
  const pageKind = assertRequiredText(input.pageKind, "pageKind")
  const snapshotCapturedAt = assertRequiredText(input.snapshotCapturedAt, "snapshotCapturedAt")
  const extractorId = assertRequiredText(input.extractorId, "extractorId")
  const pageId = assertRequiredText(input.pageId, "pageId")
  const canonicalUrl = assertRequiredText(input.canonicalUrl, "canonicalUrl")
  const id = normalizeText(input.id) ?? randomUUID()
  const writeSource = normalizeText(input.writeSource) ?? "analyze"
  const sourceDomain = resolveSourceDomain(sourceUrl, input.sourceDomain)
  const createdAt = normalizeText(input.createdAt) ?? new Date().toISOString()

  await ensureOwnerUserRow(queryable, ownerUserId)

  const inserted = await queryable.query<MemoryRecordDbRow>(INSERT_MEMORY_RECORD_SQL, [
    id,
    ownerUserId,
    kind,
    summary,
    retrievalText,
    input.keywords ?? [],
    input.entities ?? [],
    sourceUrl,
    sourceDomain,
    pageKind,
    snapshotCapturedAt,
    extractorId,
    input.skeletonVersion,
    pageId,
    input.unitId ?? null,
    input.rootNodeIds ?? [],
    canonicalUrl,
    input.pageTitle ?? null,
    input.pageAnchor ?? null,
    input.nodeAnchor ? JSON.stringify(input.nodeAnchor) : null,
    input.openMode ?? null,
    JSON.stringify(input.evidence ?? {}),
    input.visual ? JSON.stringify(input.visual) : null,
    input.kindPayload ? JSON.stringify(input.kindPayload) : null,
    writeSource,
    input.analysisId ?? null,
    createdAt
  ])

  const row = inserted.rows[0]
  if (!row) {
    throw new Error("failed to insert memory record")
  }
  return toMemoryRecordRow(row)
}

export async function getMemoryRecordById(recordId: string): Promise<MemoryRecordRow | null> {
  await ensureDatabaseMigrations()
  const normalizedRecordId = normalizeText(recordId)
  if (!normalizedRecordId) {
    return null
  }
  const found = await (await getPool()).query<MemoryRecordDbRow>(SELECT_MEMORY_RECORD_BY_ID_SQL, [normalizedRecordId])
  const row = found.rows[0]
  if (!row) {
    return null
  }
  return toMemoryRecordRow(row)
}

export async function listMemoryRecordsByOwner(input: {
  ownerUserId: string
  limit?: number
}): Promise<MemoryRecordRow[]> {
  await ensureDatabaseMigrations()
  const ownerUserId = assertRequiredText(input.ownerUserId, "ownerUserId")
  const limit = normalizeLimit(input.limit, 8)
  const listed = await (await getPool()).query<MemoryRecordDbRow>(SELECT_MEMORY_RECORDS_BY_OWNER_SQL, [
    ownerUserId,
    limit
  ])
  return listed.rows.map(toMemoryRecordRow)
}

export async function listMemoryRecordsByOwnerAndKind(input: {
  ownerUserId: string
  kind: MemoryRecordKind
  limit?: number
}): Promise<MemoryRecordRow[]> {
  await ensureDatabaseMigrations()
  const ownerUserId = assertRequiredText(input.ownerUserId, "ownerUserId")
  const kind = assertMemoryRecordKind(input.kind)
  const limit = normalizeLimit(input.limit, 8)
  const listed = await (await getPool()).query<MemoryRecordDbRow>(
    SELECT_MEMORY_RECORDS_BY_OWNER_AND_KIND_SQL,
    [ownerUserId, kind, limit]
  )
  return listed.rows.map(toMemoryRecordRow)
}
