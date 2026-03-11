import type { VisualDerivedSummary } from "../visual/types"

export type MemoryRecordKind =
  | "branch-summary"
  | "section-summary"
  | "claim-evidence-summary"

export interface MemoryRecord {
  id: string
  ownerUserId?: string
  kind?: string
  summary?: string
  keywords?: string[]
  entities?: string[]
  provenance?: {
    sourceUrl?: string
    pageKind?: "article" | "thread" | "post" | "generic"
    snapshotCapturedAt?: string
    extractorId?: string
    skeletonVersion?: number
  }
  source?: {
    pageId?: string
    unitId?: string
    rootNodeIds?: string[]
  }
  navigation?: {
    canonicalUrl?: string
    pageTitle?: string
    pageAnchor?: string
    nodeAnchor?: Record<string, unknown>
    openMode?: "same-tab" | "new-tab" | "sidepanel-preview"
  }
  evidence?: {
    textSpans?: string[]
    referencedNodeIds?: string[]
    [key: string]: unknown
  }
  visual?: VisualDerivedSummary
  kindPayload?: Record<string, unknown>
  createdAt?: string
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
