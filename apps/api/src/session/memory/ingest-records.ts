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

const ALLOWED_SOURCES: IngestMemoryRequestBody["source"][] = [
  "analyze",
  "turn-completion",
  "batch-repair"
]

function hasCompleteProvenance(record: MemoryRecord): boolean {
  const provenance = record.provenance
  if (!provenance) {
    return false
  }

  return Boolean(
    provenance.sourceUrl &&
      provenance.pageKind &&
      provenance.snapshotCapturedAt &&
      provenance.extractorId &&
      provenance.skeletonVersion
  )
}

function isVisualOnly(record: MemoryRecord): boolean {
  const summary = (record.summary ?? "").trim()
  return summary.length === 0 && Boolean(record.visual)
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

export function ingestMemoryRecords(
  body: IngestMemoryRequestBody,
  principalUserId: string
): IngestMemoryResponseBody {
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

    acceptedIds.push(record.id)
  }

  return {
    acceptedIds,
    rejected
  }
}
