import { randomUUID } from "node:crypto"
import { ensureDatabaseMigrations } from "../db/migrate"
import { getPool } from "../db/pool"
import {
  INSERT_ANALYSIS_RUN_SQL,
  SELECT_ANALYSIS_RUNS_BY_OWNER_SQL
} from "./analysis-runs-repository.queries"
import { ensureOwnerUserRow, normalizeLimit, normalizeText, type Queryable } from "./repository-helpers"

export type AnalysisRunMode = "seed" | "memory-candidate" | "visual-summary"
export type AnalysisRunNormalizedMode = "discussion" | "authored" | "interactive" | "generic"

export interface InsertAnalysisRunInput {
  ownerUserId: string
  tabId: number
  mode: AnalysisRunMode
  snapshotPageId: string
  snapshotUrl: string
  normalizedMode: AnalysisRunNormalizedMode
  summaryCandidates: unknown[]
  visualSummaries: unknown[]
  createdAt?: string
}

export interface AnalysisRunRow {
  id: string
  ownerUserId: string
  tabId: number
  mode: AnalysisRunMode
  snapshotPageId: string
  snapshotUrl: string
  normalizedMode: AnalysisRunNormalizedMode
  summaryCandidates: unknown[]
  visualSummaries: unknown[]
  createdAt: string
}

interface AnalysisRunDbRow {
  id: string
  owner_user_id: string
  tab_id: number
  mode: AnalysisRunMode
  snapshot_page_id: string
  snapshot_url: string
  normalized_mode: AnalysisRunNormalizedMode
  summary_candidates: unknown[]
  visual_summaries: unknown[]
  created_at: Date | string
}

function assertRequiredText(value: unknown, label: string): string {
  const normalized = normalizeText(value)
  if (!normalized) {
    throw new Error(`${label} is required`)
  }
  return normalized
}

function assertMode(value: unknown): AnalysisRunMode {
  if (value === "seed" || value === "memory-candidate" || value === "visual-summary") {
    return value
  }
  throw new Error("mode is invalid")
}

function assertNormalizedMode(value: unknown): AnalysisRunNormalizedMode {
  if (value === "discussion" || value === "authored" || value === "interactive" || value === "generic") {
    return value
  }
  throw new Error("normalizedMode is invalid")
}

function toAnalysisRunRow(row: AnalysisRunDbRow): AnalysisRunRow {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    tabId: row.tab_id,
    mode: row.mode,
    snapshotPageId: row.snapshot_page_id,
    snapshotUrl: row.snapshot_url,
    normalizedMode: row.normalized_mode,
    summaryCandidates: row.summary_candidates,
    visualSummaries: row.visual_summaries,
    createdAt: new Date(row.created_at).toISOString()
  }
}

async function resolveQueryable(db?: Queryable): Promise<Queryable> {
  return db ?? (await getPool())
}

export async function insertAnalysisRun(
  input: InsertAnalysisRunInput,
  db?: Queryable
): Promise<Pick<AnalysisRunRow, "id" | "createdAt">> {
  await ensureDatabaseMigrations()
  const queryable = await resolveQueryable(db)
  const ownerUserId = assertRequiredText(input.ownerUserId, "ownerUserId")

  await ensureOwnerUserRow(queryable, ownerUserId)

  const inserted = await queryable.query<AnalysisRunDbRow>(INSERT_ANALYSIS_RUN_SQL, [
    randomUUID(),
    ownerUserId,
    input.tabId,
    assertMode(input.mode),
    assertRequiredText(input.snapshotPageId, "snapshotPageId"),
    assertRequiredText(input.snapshotUrl, "snapshotUrl"),
    assertNormalizedMode(input.normalizedMode),
    JSON.stringify(input.summaryCandidates ?? []),
    JSON.stringify(input.visualSummaries ?? []),
    normalizeText(input.createdAt) ?? new Date().toISOString()
  ])
  const row = inserted.rows[0]
  if (!row) {
    throw new Error("failed to insert analysis run")
  }
  const converted = toAnalysisRunRow(row)
  return {
    id: converted.id,
    createdAt: converted.createdAt
  }
}

export async function listAnalysisRunsByOwner(input: {
  ownerUserId: string
  mode?: AnalysisRunMode
  limit?: number
}): Promise<AnalysisRunRow[]> {
  await ensureDatabaseMigrations()
  const ownerUserId = assertRequiredText(input.ownerUserId, "ownerUserId")
  const limit = normalizeLimit(input.limit, 8)
  const mode = input.mode ? assertMode(input.mode) : null
  const listed = await (await getPool()).query<AnalysisRunDbRow>(SELECT_ANALYSIS_RUNS_BY_OWNER_SQL, [
    ownerUserId,
    mode,
    limit
  ])
  return listed.rows.map(toAnalysisRunRow)
}
