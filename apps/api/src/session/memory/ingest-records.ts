import type { PoolClient } from "pg"
import { getPool } from "../../db/pool"
import { buildEmbeddingHash } from "../../rag/embedding"
import { upsertMemoryRecordEmbedding } from "../../rag/memory-record-embeddings-repository"
import {
  insertMemoryRecord,
  type InsertMemoryRecordInput,
  type MemoryRecordKind as RagMemoryRecordKind
} from "../../rag/memory-records-repository"
import {
  embedTextWithVertex,
  isEmbeddingProviderError
} from "../../rag/vertex-embedding-adapter"
import type {
  IngestMemoryRequestBody,
  IngestMemoryResponseBody,
  MemoryRecord,
  MemoryRecordKind,
  RejectReason
} from "./types"

const ALLOWED_KINDS: MemoryRecordKind[] = [
  "branch-summary",
  "section-summary",
  "claim-evidence-summary"
]

const ALLOWED_PAGE_KINDS = ["article", "thread", "post", "generic"] as const
const ALLOWED_OPEN_MODES = ["same-tab", "new-tab", "sidepanel-preview"] as const

const ALLOWED_SOURCES: IngestMemoryRequestBody["source"][] = [
  "analyze",
  "turn-completion",
  "batch-repair"
]

function hasNonBlankText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isPageKind(value: unknown): value is "article" | "thread" | "post" | "generic" {
  return typeof value === "string" && ALLOWED_PAGE_KINDS.includes(value as (typeof ALLOWED_PAGE_KINDS)[number])
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
}

function isValidTimestamp(value: unknown): value is string {
  return hasNonBlankText(value) && !Number.isNaN(Date.parse(value))
}

function isOpenMode(value: unknown): value is "same-tab" | "new-tab" | "sidepanel-preview" {
  return typeof value === "string" && ALLOWED_OPEN_MODES.includes(value as (typeof ALLOWED_OPEN_MODES)[number])
}

function hasCompleteProvenance(record: MemoryRecord): boolean {
  const provenance = record.provenance
  if (!provenance) {
    return false
  }

  return Boolean(
    hasNonBlankText(provenance.sourceUrl) &&
      isPageKind(provenance.pageKind) &&
      isValidTimestamp(provenance.snapshotCapturedAt) &&
      hasNonBlankText(provenance.extractorId) &&
      isPositiveInteger(provenance.skeletonVersion)
  )
}

function isVisualOnly(record: MemoryRecord): boolean {
  const summary = (record.summary ?? "").trim()
  return summary.length === 0 && Boolean(record.visual)
}

function hasPersistenceFields(record: MemoryRecord): boolean {
  return Boolean(
    hasNonBlankText(record.source?.pageId) &&
      hasNonBlankText(record.navigation?.canonicalUrl) &&
      record.evidence &&
      typeof record.evidence === "object"
  )
}

function hasSupportedNavigation(record: MemoryRecord): boolean {
  const openMode = record.navigation?.openMode
  return openMode == null || isOpenMode(openMode)
}

function normalizeTextItems(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return []
  }
  return values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}

function buildCanonicalRetrievalText(record: MemoryRecord): string {
  const lines: string[] = []
  const summary = (record.summary ?? "").trim()
  if (summary) {
    lines.push(summary)
  }

  const keywords = normalizeTextItems(record.keywords)
  if (keywords.length > 0) {
    lines.push(`keywords: ${keywords.join(", ")}`)
  }

  const entities = normalizeTextItems(record.entities)
  if (entities.length > 0) {
    lines.push(`entities: ${entities.join(", ")}`)
  }

  const textSpans = normalizeTextItems(record.evidence?.textSpans)
  if (textSpans.length > 0) {
    lines.push(`evidence: ${textSpans.join("; ")}`)
  }

  const visualSummary = (record.visual?.summaryText ?? "").trim()
  if (visualSummary) {
    lines.push(`visual: ${visualSummary}`)
  }

  return lines.join("\n").trim()
}

async function withRecordTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    // 메모리 레코드와 임베딩은 단일 원자 단위로 저장한다.
    await client.query("begin")
    const result = await fn(client)
    await client.query("commit")
    return result
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}

async function persistMemoryRecord(input: {
  record: MemoryRecord
  principalUserId: string
  source: IngestMemoryRequestBody["source"]
}): Promise<string> {
  const retrievalText = buildCanonicalRetrievalText(input.record)
  if (!retrievalText) {
    throw new Error("retrievalText is empty")
  }

  // 외부 embedding RPC는 트랜잭션 밖에서 수행해 DB connection 점유 시간을 줄인다.
  const embeddingResult = await embedTextWithVertex(
    retrievalText,
    "RETRIEVAL_DOCUMENT"
  )

  return withRecordTransaction(async (client) => {
    const insertInput: InsertMemoryRecordInput = {
      id: input.record.id,
      ownerUserId: input.principalUserId,
      kind: input.record.kind as RagMemoryRecordKind,
      summary: input.record.summary ?? "",
      retrievalText,
      keywords: normalizeTextItems(input.record.keywords),
      entities: normalizeTextItems(input.record.entities),
      sourceUrl: input.record.provenance?.sourceUrl ?? "",
      pageKind: (input.record.provenance?.pageKind ?? "generic") as "article" | "thread" | "post" | "generic",
      snapshotCapturedAt: input.record.provenance?.snapshotCapturedAt ?? "",
      extractorId: input.record.provenance?.extractorId ?? "",
      skeletonVersion: input.record.provenance?.skeletonVersion ?? 0,
      pageId: input.record.source?.pageId ?? "",
      rootNodeIds: normalizeTextItems(input.record.source?.rootNodeIds),
      canonicalUrl: input.record.navigation?.canonicalUrl ?? "",
      evidence: input.record.evidence ?? {},
      writeSource: input.source
    }
    if (input.record.source?.unitId) {
      insertInput.unitId = input.record.source.unitId
    }
    if (input.record.navigation?.pageTitle) {
      insertInput.pageTitle = input.record.navigation.pageTitle
    }
    if (input.record.navigation?.pageAnchor) {
      insertInput.pageAnchor = input.record.navigation.pageAnchor
    }
    if (input.record.navigation?.nodeAnchor) {
      insertInput.nodeAnchor = input.record.navigation.nodeAnchor
    }
    if (input.record.navigation?.openMode) {
      insertInput.openMode = input.record.navigation.openMode
    }
    if (input.record.visual) {
      insertInput.visual = input.record.visual as unknown as Record<string, unknown>
    }
    if (input.record.kindPayload) {
      insertInput.kindPayload = input.record.kindPayload
    }
    if (input.record.createdAt) {
      insertInput.createdAt = input.record.createdAt
    }

    const inserted = await insertMemoryRecord(insertInput, client)
    await upsertMemoryRecordEmbedding(
      {
        recordId: inserted.id,
        ownerUserId: input.principalUserId,
        embeddingModel: embeddingResult.embeddingModel,
        embeddingDims: embeddingResult.embeddingDims,
        embedding: embeddingResult.embedding,
        contentHash: buildEmbeddingHash(retrievalText)
      },
      client
    )

    return inserted.id
  })
}

function validateRecord(record: MemoryRecord, principalUserId: string): RejectReason | null {
  if (!record.id) {
    return "not-storable"
  }

  if (!record.kind || !ALLOWED_KINDS.includes(record.kind as MemoryRecordKind)) {
    return "invalid-kind"
  }

  if (!record.ownerUserId || record.ownerUserId !== principalUserId) {
    return "not-storable"
  }

  if (!hasCompleteProvenance(record)) {
    return "missing-provenance"
  }

  if (isVisualOnly(record)) {
    return "visual-only"
  }

  if (!hasPersistenceFields(record)) {
    return "not-storable"
  }

  if (!hasSupportedNavigation(record)) {
    return "not-storable"
  }

  if (!(record.summary ?? "").trim()) {
    return "not-storable"
  }

  return null
}

export function validateIngestRequest(body: unknown): body is IngestMemoryRequestBody {
  if (!body || typeof body !== "object") {
    return false
  }

  const candidate = body as Partial<IngestMemoryRequestBody>
  if (!Array.isArray(candidate.records)) {
    return false
  }

  if (!candidate.source || !ALLOWED_SOURCES.includes(candidate.source)) {
    return false
  }

  return true
}

export async function ingestMemoryRecords(
  body: IngestMemoryRequestBody,
  principalUserId: string
): Promise<IngestMemoryResponseBody> {
  const acceptedIds: string[] = []
  const rejected: IngestMemoryResponseBody["rejected"] = []

  for (const record of body.records) {
    const reason = validateRecord(record, principalUserId)
    if (reason) {
      rejected.push({
        id: record.id || "unknown",
        reason
      })
      continue
    }

    try {
      const persistedId = await persistMemoryRecord({
        record,
        principalUserId,
        source: body.source
      })
      acceptedIds.push(persistedId)
    } catch (error) {
      if (!isEmbeddingProviderError(error)) {
        throw error
      }

      // provider 오류는 해당 레코드만 reject하고 다음 배치를 계속 처리한다.
      rejected.push({
        id: record.id || "unknown",
        reason: "not-storable"
      })
    }
  }

  return {
    acceptedIds,
    rejected
  }
}
