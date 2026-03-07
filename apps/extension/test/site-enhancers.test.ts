import { afterEach, describe, expect, it } from "vitest"
import { SemanticPipeline } from "../src/content/semantic/core/pipeline/SemanticPipeline"
import { SemanticCaptureSession } from "../src/content/semantic/session"
import { getCorpusScenario, type CorpusScenarioId } from "./corpus/scenarios"

function renderScenario(id: CorpusScenarioId): void {
  const scenario = getCorpusScenario(id)
  const parsed = new URL(scenario.url)
  window.history.replaceState({}, "", `${parsed.pathname}${parsed.search}${parsed.hash}`)
  document.body.innerHTML = scenario.html
}

function collectRegionShape(session: SemanticCaptureSession) {
  return session
    .getSkeleton()
    ?.regions.map((region) => ({
      id: region.id,
      primitive: region.primitive,
      subtype: region.subtype
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
}

function collectPipelineRegionShape() {
  const pipeline = new SemanticPipeline()
  return pipeline.build(document).regions
    .map((region) => ({
      id: region.id,
      primitive: region.primitive,
      subtype: region.subtype
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
}

describe("site enhancers", () => {
  afterEach(() => {
    window.getSelection()?.removeAllRanges()
  })

  it("refines docs labels without changing region semantics", () => {
    renderScenario("docs-landing")

    const expectedShape = collectPipelineRegionShape()
    const session = new SemanticCaptureSession(document, window)
    session.initialize()

    expect(collectRegionShape(session)).toEqual(expectedShape)

    const skeleton = session.getSkeleton()
    expect(skeleton?.regions.find((region) => region.primitive === "authored-block")).toMatchObject({
      category: "content.article",
      displayLabel: "Documentation article"
    })
    expect(
      skeleton?.regions.find(
        (region) => region.primitive === "navigation-cluster" && region.displayLabel === "Docs sidebar"
      )
    ).toBeTruthy()
    expect(
      skeleton?.regions.find(
        (region) => region.primitive === "repeated-item" && region.displayLabel === "Documentation cards"
      )
    ).toBeTruthy()

    const sidebar = document.querySelector("aside nav")
    expect(sidebar).toBeTruthy()

    const refinedSelection = session.refineSelectionTarget({
      regionId: sidebar?.getAttribute("data-semantic-region") ?? "",
      primitive: "navigation-cluster",
      category: "navigation.menu",
      nodeKind: "content",
      nodeId: sidebar?.getAttribute("data-semantic-node-id"),
      rootNodeId: sidebar?.getAttribute("data-semantic-node-id"),
      scopeRootId: sidebar?.getAttribute("data-semantic-scope-root-id"),
      label: "Menu",
      displayLabel: "Menu",
      text: sidebar?.textContent ?? ""
    })

    expect(refinedSelection.displayLabel).toBe("Docs sidebar")

    session.dispose()
  })

  it("refines search labels and result selection without changing region semantics", () => {
    renderScenario("search-results-with-filters")

    const expectedShape = collectPipelineRegionShape()
    const session = new SemanticCaptureSession(document, window)
    session.initialize()

    expect(collectRegionShape(session)).toEqual(expectedShape)

    const skeleton = session.getSkeleton()
    expect(
      skeleton?.regions.find((region) => region.primitive === "repeated-item" && region.displayLabel === "Search results")
    ).toBeTruthy()
    expect(
      skeleton?.regions.find(
        (region) => region.primitive === "interactive-block" && region.subtype === "search" && region.displayLabel === "Search query"
      )
    ).toBeTruthy()
    expect(
      skeleton?.regions.find(
        (region) => region.primitive === "interactive-block" && region.subtype === "filter" && region.displayLabel === "Search filters"
      )
    ).toBeTruthy()

    const resultCard = document.querySelector(".result-card")
    expect(resultCard).toBeTruthy()

    const refinedResult = session.refineSelectionTarget({
      regionId: resultCard?.getAttribute("data-semantic-region") ?? "",
      primitive: "repeated-item",
      subtype: "grid",
      category: "content.post",
      nodeKind: "content",
      nodeId: resultCard?.getAttribute("data-semantic-node-id"),
      rootNodeId: resultCard?.getAttribute("data-semantic-node-id"),
      scopeRootId: resultCard?.getAttribute("data-semantic-scope-root-id"),
      label: "Result card",
      displayLabel: "Result card",
      text: resultCard?.textContent ?? ""
    })

    expect(refinedResult.displayLabel).toBe("Search result")

    const filterPanel = document.querySelector(".filter-panel")
    expect(filterPanel).toBeTruthy()

    const refinedFilter = session.refineSelectionTarget({
      regionId: filterPanel?.getAttribute("data-semantic-region") ?? "",
      primitive: "interactive-block",
      subtype: "filter",
      category: "interactive.filter",
      nodeKind: "interactive",
      nodeId: filterPanel?.getAttribute("data-semantic-node-id"),
      rootNodeId: filterPanel?.getAttribute("data-semantic-node-id"),
      scopeRootId: filterPanel?.getAttribute("data-semantic-scope-root-id"),
      label: "Filter controls",
      displayLabel: "Filter controls",
      text: filterPanel?.textContent ?? ""
    })

    expect(refinedFilter.displayLabel).toBe("Search filters")

    session.dispose()
  })
})
