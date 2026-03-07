export type MemoryRecordKind =
  | "branch-summary"
  | "section-summary"
  | "claim-evidence-summary"

export interface MemoryRecord {
  id: string
  ownerUserId?: string
  kind?: string
  summary?: string
  provenance?: {
    sourceUrl?: string
    pageKind?: "article" | "thread" | "post" | "generic"
    snapshotCapturedAt?: string
    extractorId?: string
    skeletonVersion?: number
  }
  visual?: {
    kind: "chart-summary" | "diagram-summary" | "ui-visual-summary"
    summaryText: string
    extractedLabels: string[]
  }
}

export interface IngestMemoryRequestBody {
  records: MemoryRecord[]
  source: "analyze" | "turn-completion" | "batch-repair"
}

export type RejectReason =
  | "invalid-kind"
  | "missing-provenance"
  | "visual-only"
  | "not-storable"

export interface IngestMemoryResponseBody {
  acceptedIds: string[]
  rejected: Array<{
    id: string
    reason: RejectReason
  }>
}

