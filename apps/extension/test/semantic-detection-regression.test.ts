import { afterEach, describe, expect, it } from "vitest"
import { buildCanonicalRegionDump } from "../src/content/semantic/core/observability"
import { SemanticPipeline } from "../src/content/semantic/core/pipeline/SemanticPipeline"
import { SemanticCaptureSession } from "../src/content/semantic/session"
import { getCorpusScenario, type CorpusScenarioId } from "./corpus/scenarios"

function renderScenario(id: CorpusScenarioId): void {
  const scenario = getCorpusScenario(id)
  const parsed = new URL(scenario.url)
  window.history.replaceState({}, "", `${parsed.pathname}${parsed.search}${parsed.hash}`)
  document.body.innerHTML = scenario.html
}

function getCanonicalRegions(id: CorpusScenarioId) {
  renderScenario(id)
  const pipeline = new SemanticPipeline()
  pipeline.build(document)
  return buildCanonicalRegionDump(pipeline.createRegionDump(document)).regions
}

describe("semantic detection regression", () => {
  afterEach(() => {
    window.getSelection()?.removeAllRanges()
  })

  it("keeps deep and collapsed thread fixtures as nested repeated items", () => {
    for (const id of ["hn-item-deep", "hn-thread-collapsed", "reddit-thread-prep"] as const) {
      const regions = getCanonicalRegions(id)
      expect(
        regions.some(
          (region) =>
            region.primitive === "repeated-item" &&
            region.subtype === "nested" &&
            region.normalizedKind === "thread"
        ),
        `${id} should keep a nested thread region`
      ).toBe(true)
    }
  })

  it("keeps navigation trees and footer resources out of repeated-item detection", () => {
    for (const id of ["docs-sidebar-tree-negative", "article-toc-negative", "footer-link-cloud-negative"] as const) {
      const regions = getCanonicalRegions(id)
      expect(
        regions.some((region) => region.primitive === "repeated-item"),
        `${id} should not create repeated-item regions`
      ).toBe(false)
    }
  })

  it("preserves irregular grids and dashboard tables as assembled repeated items", () => {
    const irregularGrid = getCanonicalRegions("irregular-card-grid").find(
      (region) => region.primitive === "repeated-item"
    )
    expect(irregularGrid).toMatchObject({
      subtype: "grid",
      assembledItemCount: 4
    })

    const dashboardTable = getCanonicalRegions("dashboard-table").find(
      (region) => region.primitive === "repeated-item"
    )
    expect(dashboardTable).toMatchObject({
      subtype: "flat",
      assembledItemCount: 4
    })
  })

  it("classifies interactive corpus fixtures by cluster subtype", () => {
    const expectations: Array<{
      id: CorpusScenarioId
      subtype: string
      category: string
    }> = [
      { id: "filter-panel", subtype: "filter", category: "interactive.filter" },
      { id: "sort-tabs", subtype: "sort", category: "interactive.sort" },
      { id: "command-palette-trigger", subtype: "search", category: "interactive.search" },
      { id: "multi-field-form", subtype: "form", category: "interactive.form" },
      { id: "action-toolbar", subtype: "action-group", category: "interactive.action" }
    ]

    for (const expectation of expectations) {
      const interactiveRegion = getCanonicalRegions(expectation.id).find(
        (region) => region.primitive === "interactive-block"
      )
      expect(interactiveRegion, `${expectation.id} should have an interactive region`).toMatchObject({
        subtype: expectation.subtype,
        category: expectation.category
      })
    }
  })

  it("captures command palette triggers as interactive search controls", () => {
    renderScenario("command-palette-trigger")

    const session = new SemanticCaptureSession(document, window)
    session.initialize()

    const button = document.querySelector("button[aria-label='Search docs']")
    expect(button).toBeTruthy()

    const result = session.captureSnapshot({
      source: "sidepanel",
      activeElement: button ?? document.body,
      selection: window.getSelection(),
      triggerTarget: button ?? null,
      selectedElement: button ?? null,
      lastHoveredElement: button ?? null
    })

    expect(result.error).toBeNull()
    expect(result.snapshot?.focus.region).toBe("interactive-block-1")
    expect(result.snapshot?.focus.node).toMatchObject({
      kind: "interactive",
      action: "search"
    })

    session.dispose()
  })

  it("keeps search layouts split between results, search, and filter clusters", () => {
    const regions = getCanonicalRegions("search-results-with-filters")

    expect(
      regions.filter((region) => region.primitive === "interactive-block" && region.subtype === "search").length
    ).toBe(1)
    expect(
      regions.filter((region) => region.primitive === "interactive-block" && region.subtype === "filter").length
    ).toBe(1)
    expect(
      regions.some(
        (region) =>
          region.primitive === "repeated-item" &&
          region.subtype === "grid" &&
          region.assembledItemCount === 3
      )
    ).toBe(true)
  })
})
