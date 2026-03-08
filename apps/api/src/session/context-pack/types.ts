import type {
  ContextRelation,
  PageKind,
  SemanticNode,
  SemanticSnapshot,
  ContextPack
} from "@threadatlas/shared"

export type AnalyzeMode = "seed" | "memory-candidate" | "visual-summary"

export type NormalizedMode = "discussion" | "authored" | "interactive" | "generic"

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

// shared 입력 계약을 BE가 직접 사용하도록 re-export 한다.
export type {
  ContextPack,
  ContextRelation,
  PageKind,
  SemanticNode,
  SemanticSnapshot
}
