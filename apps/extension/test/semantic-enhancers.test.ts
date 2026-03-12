import type { SemanticRegionRef, SemanticSkeleton } from "@threadatlas/shared/browser-runtime"
import type { SemanticSelectionTarget } from "@threadatlas/shared/runtime"
import { afterEach, describe, expect, it } from "vitest"
import { GenericSemanticExtractor } from "../src/content/semantic/generic-semantic-extractor"
import { createDefaultRecognizers } from "../src/content/semantic/core/detection/recognizers"
import { SemanticPipeline } from "../src/content/semantic/core/pipeline/SemanticPipeline"
import { getCorpusScenario } from "./corpus/scenarios"

function setPage(url: string, html: string): void {
  const nextUrl = new URL(url)
  const currentOrigin = new URL(window.location.href).origin
  const target =
    nextUrl.origin === currentOrigin ? nextUrl.href : `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`
  window.history.replaceState({}, "", target)
  document.body.innerHTML = html
}

function inventoryOf(
  regions: Array<{
    id: string
    primitive: string
    subtype?: string
  }>
): Array<{ id: string; primitive: string; subtype?: string }> {
  return [...regions]
    .map((region) => ({
      id: region.id,
      primitive: region.primitive,
      ...(region.subtype ? { subtype: region.subtype } : {})
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
}

function buildRawAndEnhanced(url: string, html: string): {
  extractor: GenericSemanticExtractor
  skeleton: SemanticSkeleton
  rawInventory: Array<{ id: string; primitive: string; subtype?: string }>
  enhancedInventory: Array<{ id: string; primitive: string; subtype?: string }>
} {
  setPage(url, html)

  const pipeline = new SemanticPipeline(createDefaultRecognizers())
  const rawInventory = inventoryOf(pipeline.build(document).regions)

  const extractor = new GenericSemanticExtractor()
  const skeleton = extractor.buildSkeleton(document)
  const enhancedInventory = inventoryOf(skeleton.regions)

  return {
    extractor,
    skeleton,
    rawInventory,
    enhancedInventory
  }
}

function getRegionRef(
  skeleton: SemanticSkeleton,
  predicate: (region: SemanticSkeleton["regions"][number]) => boolean
): SemanticRegionRef {
  const region = skeleton.regions.find(predicate)
  expect(region).toBeTruthy()
  return region!
}

function buildSelectionTarget(
  region: SemanticRegionRef,
  nodeId: string,
  text: string
): SemanticSelectionTarget {
  return {
    regionId: region.id,
    primitive: region.primitive,
    ...(region.subtype ? { subtype: region.subtype } : {}),
    category: region.category,
    nodeKind: "content",
    nodeId,
    rootNodeId: null,
    scopeRootId: null,
    label: region.displayLabel ?? "Semantic item",
    displayLabel: region.displayLabel ?? "Semantic item",
    text
  }
}

function buildReferenceMarkup(): string {
  return `
    <header>
      <nav aria-label="Breadcrumb">
        <a href="/docs">Docs</a>
        <a href="/docs/reference">Reference</a>
        <a href="/docs/reference/cli">CLI</a>
      </nav>
    </header>
    <div class="docs-layout reference-layout">
      <aside>
        <nav aria-label="Reference sections">
          <a href="#flags">Flags</a>
          <a href="#config">Configuration</a>
          <a href="#examples">Examples</a>
        </nav>
      </aside>
      <main>
        <article>
          <h1>CLI Reference</h1>
          <p>Use the CLI to capture, inspect, and replay semantic snapshots.</p>
          <h2 id="flags">Flags</h2>
          <p>Flags configure source capture, scope coverage, and dump output.</p>
          <h2 id="config">Configuration</h2>
          <p>Configuration values can come from env vars or explicit runtime options.</p>
        </article>
      </main>
    </div>
    <footer>
      <nav aria-label="Reference resources">
        <a href="/docs/reference/auth">Auth</a>
        <a href="/docs/reference/cache">Cache</a>
        <a href="/docs/reference/search">Search</a>
      </nav>
    </footer>
  `
}

describe("semantic enhancers", () => {
  afterEach(() => {
    document.body.innerHTML = ""
  })

  it("refines docs landing regions without creating new regions", () => {
    const scenario = getCorpusScenario("docs-landing")
    const { extractor, skeleton, rawInventory, enhancedInventory } = buildRawAndEnhanced(scenario.url, scenario.html)

    expect(enhancedInventory).toEqual(rawInventory)

    const authoredRef = getRegionRef(skeleton, (region) => region.primitive === "authored-block")
    expect(authoredRef).toMatchObject({
      category: "content.article",
      displayLabel: "Documentation overview"
    })

    const cardRef = getRegionRef(
      skeleton,
      (region) => region.primitive === "repeated-item" && region.subtype === "grid"
    )
    expect(cardRef).toMatchObject({
      category: "content.article",
      displayLabel: "Documentation cards"
    })
    expect(
      skeleton.regions.some(
        (region) => region.primitive === "navigation-cluster" && region.displayLabel === "Docs sidebar"
      )
    ).toBe(true)

    const cardRegion = extractor.expandRegion(cardRef, document)
    expect(cardRegion).toMatchObject({
      category: "content.article",
      displayLabel: "Documentation cards"
    })

    const cardNodeId = cardRegion?.structure?.rootIds?.[1]
    expect(cardNodeId).toBeTruthy()

    const refinedSelection = extractor.refineSelectionTarget(
      buildSelectionTarget(cardRef, cardNodeId!, cardRegion?.nodes[1]?.kind === "content" ? cardRegion.nodes[1].text : ""),
      document
    )

    expect(refinedSelection).toMatchObject({
      category: "content.article",
      label: "Documentation card",
      displayLabel: "Documentation card",
      rootNodeId: cardNodeId,
      scopeRootId: cardNodeId
    })
  })

  it("refines guide and reference docs labels while preserving primitive generation", () => {
    const guideScenario = getCorpusScenario("docs-article")
    const guide = buildRawAndEnhanced(guideScenario.url, guideScenario.html)

    expect(guide.enhancedInventory).toEqual(guide.rawInventory)
    expect(
      guide.skeleton.regions.find((region) => region.primitive === "authored-block")
    ).toMatchObject({
      category: "content.article",
      displayLabel: "Guide article"
    })
    expect(
      guide.skeleton.regions.some(
        (region) => region.primitive === "navigation-cluster" && region.displayLabel === "Guide sections"
      )
    ).toBe(true)
    expect(
      guide.skeleton.regions.some(
        (region) => region.primitive === "navigation-cluster" && region.displayLabel === "Related links"
      )
    ).toBe(true)

    const reference = buildRawAndEnhanced("https://example.com/docs/reference/cli", buildReferenceMarkup())

    expect(reference.enhancedInventory).toEqual(reference.rawInventory)
    expect(
      reference.skeleton.regions.find((region) => region.primitive === "authored-block")
    ).toMatchObject({
      category: "content.article",
      displayLabel: "API reference"
    })
    expect(
      reference.skeleton.regions.some(
        (region) =>
          region.primitive === "navigation-cluster" &&
          region.category === "navigation.breadcrumb" &&
          region.displayLabel === "Breadcrumb"
      )
    ).toBe(true)
    expect(
      reference.skeleton.regions.some(
        (region) => region.primitive === "navigation-cluster" && region.displayLabel === "Reference sections"
      )
    ).toBe(true)

    const authoredRef = getRegionRef(reference.skeleton, (region) => region.primitive === "authored-block")
    const authoredRegion = reference.extractor.expandRegion(authoredRef, document)
    const authoredNodeId = authoredRegion?.structure?.rootIds?.[0]
    expect(authoredNodeId).toBeTruthy()

    const refinedSelection = reference.extractor.refineSelectionTarget(
      buildSelectionTarget(
        authoredRef,
        authoredNodeId!,
        authoredRegion?.nodes[0]?.kind === "content" ? authoredRegion.nodes[0].text : ""
      ),
      document
    )

    expect(refinedSelection).toMatchObject({
      category: "content.article",
      label: "Reference section",
      displayLabel: "Reference section",
      rootNodeId: authoredNodeId,
      scopeRootId: authoredNodeId
    })
  })

  it("refines search layouts without changing the detected region inventory", () => {
    const scenario = getCorpusScenario("search-results-with-filters")
    const { extractor, skeleton, rawInventory, enhancedInventory } = buildRawAndEnhanced(scenario.url, scenario.html)

    expect(enhancedInventory).toEqual(rawInventory)

    expect(
      skeleton.regions.find((region) => region.primitive === "interactive-block" && region.subtype === "search")
    ).toMatchObject({
      category: "interactive.search",
      displayLabel: "Docs search"
    })
    expect(
      skeleton.regions.find((region) => region.primitive === "interactive-block" && region.subtype === "filter")
    ).toMatchObject({
      category: "interactive.filter",
      displayLabel: "Search filters"
    })
    expect(
      skeleton.regions.find((region) => region.primitive === "authored-block")
    ).toMatchObject({
      category: "content.article",
      displayLabel: "Primary result"
    })

    const resultRef = getRegionRef(
      skeleton,
      (region) => region.primitive === "repeated-item" && region.subtype === "grid"
    )
    expect(resultRef).toMatchObject({
      category: "content.article",
      displayLabel: "Search results"
    })

    const resultRegion = extractor.expandRegion(resultRef, document)
    expect(resultRegion).toMatchObject({
      category: "content.article",
      displayLabel: "Search results"
    })

    const resultNodeId = resultRegion?.structure?.rootIds?.[1]
    expect(resultNodeId).toBeTruthy()

    const refinedResultSelection = extractor.refineSelectionTarget(
      buildSelectionTarget(
        resultRef,
        resultNodeId!,
        resultRegion?.nodes[1]?.kind === "content" ? resultRegion.nodes[1].text : ""
      ),
      document
    )
    expect(refinedResultSelection).toMatchObject({
      category: "content.article",
      label: "Search result",
      displayLabel: "Search result",
      rootNodeId: resultNodeId,
      scopeRootId: resultNodeId
    })

    const searchRef = getRegionRef(
      skeleton,
      (region) => region.primitive === "interactive-block" && region.subtype === "search"
    )
    const searchSelection = {
      regionId: searchRef.id,
      primitive: searchRef.primitive,
      category: searchRef.category,
      nodeKind: "interactive" as const,
      nodeId: "interactive-block-1-cluster",
      rootNodeId: null,
      scopeRootId: null,
      label: searchRef.displayLabel ?? "Search",
      displayLabel: searchRef.displayLabel ?? "Search",
      text: "Search docs",
      ...(searchRef.subtype ? { subtype: searchRef.subtype } : {})
    }
    const refinedSearchSelection = extractor.refineSelectionTarget(
      searchSelection,
      document
    )
    expect(refinedSearchSelection).toMatchObject({
      label: "Docs search",
      displayLabel: "Docs search",
      rootNodeId: "interactive-block-1-cluster",
      scopeRootId: "interactive-block-1-cluster"
    })
  })
})
