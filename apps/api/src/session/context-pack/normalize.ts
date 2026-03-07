import type {
  AnalyzeMode,
  ContextPack,
  NormalizedMode,
  SemanticSnapshot,
  SummaryCandidate,
  VisualDerivedSummary
} from "./types"

function inferNormalizedMode(snapshot: SemanticSnapshot): NormalizedMode {
  if (snapshot.focus.node.kind === "comment") {
    return "discussion"
  }
  if (snapshot.focus.node.kind === "interactive") {
    return "interactive"
  }
  if (snapshot.page.kind === "article") {
    return "authored"
  }
  return "generic"
}

function candidateKindForMode(normalizedMode: NormalizedMode): SummaryCandidate["kind"] {
  if (normalizedMode === "discussion") {
    return "branch-summary"
  }
  if (normalizedMode === "authored") {
    return "section-summary"
  }
  return "claim-evidence-summary"
}

function summarizeFocusNode(snapshot: SemanticSnapshot, pack: ContextPack): string {
  const focusText = pack.focus.text?.trim()
  if (focusText && focusText.length > 0) {
    return focusText.slice(0, 220)
  }
  return `${snapshot.page.title ?? "Untitled page"} focus summary`
}

function buildSummaryCandidates(
  snapshot: SemanticSnapshot,
  pack: ContextPack,
  normalizedMode: NormalizedMode
): SummaryCandidate[] {
  return [
    {
      kind: candidateKindForMode(normalizedMode),
      summary: summarizeFocusNode(snapshot, pack),
      rootNodeIds: [snapshot.focus.nodeId],
      confidence: 0.72
    }
  ]
}

function buildVisualSummaries(snapshot: SemanticSnapshot): VisualDerivedSummary[] {
  const extractedLabels =
    snapshot.focus.node.kind === "interactive" && snapshot.focus.node.label
      ? [snapshot.focus.node.label]
      : []
  return [
    {
      kind: "ui-visual-summary",
      summaryText: `Visual context around ${snapshot.focus.region}`,
      extractedLabels
    }
  ]
}

export function normalizeForAnalyze(
  snapshot: SemanticSnapshot,
  pack: ContextPack,
  mode: AnalyzeMode
): {
  normalizedMode: NormalizedMode
  summaryCandidates: SummaryCandidate[]
  visualSummaries: VisualDerivedSummary[]
} {
  const normalizedMode = inferNormalizedMode(snapshot)
  const summaryCandidates = buildSummaryCandidates(snapshot, pack, normalizedMode)
  const visualSummaries = mode === "visual-summary" ? buildVisualSummaries(snapshot) : []

  return {
    normalizedMode,
    summaryCandidates,
    visualSummaries
  }
}
