import type { SemanticSnapshot } from "@threadatlas/shared"
import type { VisualDerivedSummary, VisualSummaryKind } from "./types"

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }
  const normalized = value.replace(/\s+/g, " ").trim()
  return normalized.length > 0 ? normalized : null
}

function uniqueText(values: Array<string | null | undefined>, limit = 8): string[] {
  const deduped = new Set<string>()
  for (const value of values) {
    const normalized = normalizeText(value)
    if (!normalized) {
      continue
    }
    deduped.add(normalized)
    if (deduped.size >= limit) {
      break
    }
  }
  return [...deduped]
}

function inferChartType(haystack: string): NonNullable<VisualDerivedSummary["chart"]>["chartType"] {
  if (haystack.includes("line")) {
    return "line"
  }
  if (haystack.includes("bar")) {
    return "bar"
  }
  if (haystack.includes("pie")) {
    return "pie"
  }
  if (haystack.includes("scatter")) {
    return "scatter"
  }
  if (haystack.includes("table")) {
    return "table-like"
  }
  return "unknown"
}

function inferVisualKind(snapshot: SemanticSnapshot): VisualSummaryKind {
  const focusNode = snapshot.focus.node
  const haystack = [
    snapshot.page.title,
    focusNode.kind,
    "label" in focusNode ? focusNode.label : undefined,
    "text" in focusNode ? focusNode.text : undefined,
    snapshot.focus.region
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase()

  if (/(chart|graph|line|bar|pie|scatter|table|차트|그래프|표)/.test(haystack)) {
    return "chart-summary"
  }
  if (/(diagram|flow|architecture|topology|structure|다이어그램|흐름도|구조도)/.test(haystack)) {
    return "diagram-summary"
  }
  return "ui-visual-summary"
}

export function buildVisualDerivedSummary(input: VisualDerivedSummary): VisualDerivedSummary {
  const summaryText = normalizeText(input.summaryText) ?? "Visual context summary unavailable."
  const extractedLabels = uniqueText(input.extractedLabels)
  const extractedText = uniqueText(input.extractedText ?? [], 12)

  const summary: VisualDerivedSummary = {
    kind: input.kind,
    summaryText,
    extractedLabels
  }

  if (extractedText.length > 0) {
    summary.extractedText = extractedText
  }
  if (input.chart) {
    summary.chart = input.chart
  }
  if (input.diagram) {
    summary.diagram = input.diagram
  }
  if (input.uiVisual) {
    summary.uiVisual = input.uiVisual
  }

  return summary
}

export function buildVisualSummariesFromSnapshot(snapshot: SemanticSnapshot): VisualDerivedSummary[] {
  const focusNode = snapshot.focus.node
  const focusText = "text" in focusNode ? normalizeText(focusNode.text) : null
  const focusLabel = "label" in focusNode ? normalizeText(focusNode.label) : null
  const pageTitle = normalizeText(snapshot.page.title)
  const visualKind = inferVisualKind(snapshot)
  const extractedLabels = uniqueText([focusLabel, pageTitle])
  const extractedText = uniqueText([focusText])

  if (visualKind === "chart-summary") {
    const haystack = [pageTitle, focusLabel, focusText].filter(Boolean).join(" ").toLowerCase()
    const chart: NonNullable<VisualDerivedSummary["chart"]> = {
      trend: "unknown",
      comparedSeries: extractedLabels
    }
    const chartType = inferChartType(haystack)
    if (chartType) {
      chart.chartType = chartType
    }
    return [
      buildVisualDerivedSummary({
        kind: visualKind,
        summaryText:
          focusText ??
          `Chart-like visual context is present around ${snapshot.focus.region}.`,
        extractedLabels,
        extractedText,
        chart
      })
    ]
  }

  if (visualKind === "diagram-summary") {
    return [
      buildVisualDerivedSummary({
        kind: visualKind,
        summaryText:
          focusText ??
          `Diagram-like visual context is present around ${snapshot.focus.region}.`,
        extractedLabels,
        extractedText,
        diagram: {
          entities: extractedLabels
        }
      })
    ]
  }

  return [
    buildVisualDerivedSummary({
      kind: "ui-visual-summary",
      summaryText:
        focusText ??
        focusLabel ??
        `Visible UI context is centered on ${snapshot.focus.region}.`,
      extractedLabels,
      extractedText,
      uiVisual: {
        visibleControls: extractedLabels,
        visibleSections: uniqueText([snapshot.focus.region, pageTitle], 4)
      }
    })
  ]
}
