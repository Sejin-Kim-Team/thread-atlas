export type VisualSummaryKind =
  | "chart-summary"
  | "diagram-summary"
  | "ui-visual-summary"

export interface VisualDerivedSummary {
  kind: VisualSummaryKind
  summaryText: string
  extractedLabels: string[]
  extractedText?: string[]
  chart?: {
    chartType?: "line" | "bar" | "pie" | "scatter" | "table-like" | "unknown"
    trend?: "up" | "down" | "flat" | "mixed" | "unknown"
    comparedSeries?: string[]
  }
  diagram?: {
    entities?: string[]
    relations?: string[]
  }
  uiVisual?: {
    visibleControls?: string[]
    visibleSections?: string[]
  }
}

export interface NormalizedEnrichDetail {
  textPreview?: string
  htmlPreview?: string
  attributes?: Record<string, string>
  bounds?: {
    x: number
    y: number
    width: number
    height: number
  }
}

export interface NormalizedEnrichEvidence {
  requestKind: "node-screenshot" | "visible-region" | "node-detail"
  targetRef: Record<string, unknown>
  capturedAt: string
  detail?: NormalizedEnrichDetail
  image?: {
    mimeType: "image/png" | "image/jpeg"
    imageBytes: string
  }
}

export interface VisualReasonerInput {
  intentText: string
  focusText: string
  requestKind: NormalizedEnrichEvidence["requestKind"]
  targetRef: Record<string, unknown>
  detail?: NormalizedEnrichDetail
  image?: NormalizedEnrichEvidence["image"]
}

export interface VisualReasonerOutput {
  visualSummary: VisualDerivedSummary
  answerSupplement?: string
}
