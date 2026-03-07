export type AnalyzeMode = "seed" | "memory-candidate" | "visual-summary"

export type NormalizedMode = "discussion" | "authored" | "interactive" | "generic"

export type PageKind = "article" | "thread" | "post" | "generic"
export type SemanticNodeKind = "content" | "comment" | "interactive"
export type ContextRelation = "parent" | "child" | "sibling" | "container" | "ancestor"

export interface SemanticNode {
  kind: SemanticNodeKind
  id: string
  text?: string
  label?: string
  parentId?: string
}

export interface SemanticSnapshot {
  page: {
    id: string
    url: string
    title?: string
    kind: PageKind
  }
  focus: {
    nodeId: string
    node: SemanticNode
    region: string
  }
  context: Array<{
    relation: ContextRelation
    node: SemanticNode
    distance: number
  }>
  meta: {
    capturedAt: string
    skeletonVersion: number
    extractorId: string
  }
}

export interface ContextPack {
  version: 1
  page: {
    id: string
    url: string
    title?: string
    kind: PageKind
  }
  focus: {
    id: string
    kind: SemanticNodeKind
    text: string
  }
  provenance: {
    extractorId: string
    capturedAt: string
    skeletonVersion: number
  }
}

export type MemoryRecordKind =
  | "branch-summary"
  | "section-summary"
  | "claim-evidence-summary"

export interface SummaryCandidate {
  kind: MemoryRecordKind
  summary: string
  rootNodeIds: string[]
  confidence: number
}

export interface VisualDerivedSummary {
  kind: "chart-summary" | "diagram-summary" | "ui-visual-summary"
  summaryText: string
  extractedLabels: string[]
}

export interface AnalyzeRequestBody {
  tabId: number
  snapshot?: SemanticSnapshot
  providedPack?: ContextPack
  mode?: AnalyzeMode
}

export type AnalyzeResponseBody =
  | {
      mode: "seed"
      analysisId: string
      normalizedMode: NormalizedMode
      summaryCandidates: SummaryCandidate[]
      visualSummaries?: VisualDerivedSummary[]
    }
  | {
      mode: "memory-candidate"
      analysisId: string
      normalizedMode: NormalizedMode
      summaryCandidates: SummaryCandidate[]
      visualSummaries?: VisualDerivedSummary[]
    }
  | {
      mode: "visual-summary"
      analysisId: string
      normalizedMode: NormalizedMode
      visualSummaries: VisualDerivedSummary[]
      summaryCandidates?: SummaryCandidate[]
    }

export interface SnapshotValidationResult {
  ok: boolean
  errors: string[]
}
