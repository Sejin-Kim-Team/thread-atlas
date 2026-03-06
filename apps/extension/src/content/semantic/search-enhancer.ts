import type {
  EnhancerContext,
  SemanticRegion,
  SemanticSkeleton,
  SiteEnhancer
} from "@threadatlas/shared/browser-runtime"
import type { SemanticSelectionTarget } from "@threadatlas/shared/runtime"

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase()
}

function isSearchPage(url: URL, document: Document): boolean {
  if (url.pathname.includes("search")) {
    return true
  }

  return Boolean(document.querySelector(".search-layout, .results-grid, [data-search-results]"))
}

function isDocsSearchPage(url: URL, document: Document): boolean {
  const pathname = normalizeText(url.pathname)
  if (pathname.includes("/docs/search")) {
    return true
  }

  const searchText = normalizeText(
    document.querySelector("form[role='search'], [role='search']")?.textContent ??
      document.querySelector("input[type='search']")?.getAttribute("placeholder")
  )
  return searchText.includes("docs")
}

function hasResultGrid(document: Document): boolean {
  return Boolean(document.querySelector(".results-grid, [data-search-results], .search-layout"))
}

function getAnchorElement(region: SemanticSkeleton["regions"][number]): Element | null {
  return region.anchor.deref?.() ?? null
}

function getSearchLabel(
  element: Element | null,
  region: { primitive: string; subtype?: string },
  docsSearch: boolean,
  hasResults: boolean
): string | null {
  if (!element) {
    return null
  }

  if (region.primitive === "repeated-item") {
    return "Search results"
  }
  if (region.primitive === "authored-block" && hasResults) {
    return "Primary result"
  }
  if (region.primitive === "interactive-block" && region.subtype === "search") {
    return docsSearch ? "Docs search" : "Search query"
  }
  if (region.primitive === "interactive-block" && region.subtype === "filter") {
    return "Search filters"
  }
  if (region.primitive === "interactive-block" && region.subtype === "sort") {
    return "Sort results"
  }

  return null
}

function resolveSearchCategory(
  region: Pick<SemanticSelectionTarget, "primitive" | "category">,
  docsSearch: boolean
): SemanticSelectionTarget["category"] {
  if (docsSearch && (region.primitive === "authored-block" || region.primitive === "repeated-item")) {
    return "content.article"
  }

  return region.category
}

function mapSkeletonRegion(
  region: SemanticSkeleton["regions"][number],
  docsSearch: boolean,
  hasResults: boolean
): SemanticSkeleton["regions"][number] {
  const displayLabel = getSearchLabel(getAnchorElement(region), {
    primitive: region.primitive,
    subtype: region.subtype
  }, docsSearch, hasResults)

  if (!displayLabel) {
    return region
  }

  return {
    ...region,
    category: resolveSearchCategory(region, docsSearch),
    displayLabel
  }
}

function mapExpandedRegion(
  region: SemanticRegion,
  ctx: EnhancerContext,
  docsSearch: boolean,
  hasResults: boolean
): SemanticRegion {
  const anchor = ctx.document.querySelector(`[data-semantic-region="${region.id}"]`)
  const displayLabel = getSearchLabel(anchor, {
    primitive: region.primitive,
    subtype: region.subtype
  }, docsSearch, hasResults)

  if (!displayLabel) {
    return region
  }

  return {
    ...region,
    category: resolveSearchCategory(region, docsSearch),
    displayLabel
  }
}

function findSelectionElement(ctx: EnhancerContext, selection: SemanticSelectionTarget): Element | null {
  const candidateIds = [selection.nodeId, selection.scopeRootId, selection.rootNodeId].filter(
    (value): value is string => Boolean(value)
  )
  for (const nodeId of candidateIds) {
    const element = ctx.document.querySelector(
      `[data-semantic-region="${selection.regionId}"][data-semantic-node-id="${nodeId}"]`
    )
    if (element) {
      return element
    }
  }

  return ctx.document.querySelector(`[data-semantic-region="${selection.regionId}"]`)
}

function resolveSelectionScope(
  element: Element | null,
  input: SemanticSelectionTarget
): Pick<SemanticSelectionTarget, "rootNodeId" | "scopeRootId"> {
  if (input.primitive === "repeated-item" && input.nodeId) {
    return {
      rootNodeId: input.rootNodeId ?? input.nodeId,
      scopeRootId: input.scopeRootId ?? input.nodeId
    }
  }

  const scopeRootId =
    input.scopeRootId ?? element?.getAttribute("data-semantic-scope-root-id") ?? input.rootNodeId ?? input.nodeId
  const rootNodeId = input.rootNodeId ?? scopeRootId ?? input.nodeId

  return {
    rootNodeId,
    scopeRootId
  }
}

function resolveSelectionLabel(
  input: SemanticSelectionTarget,
  displayLabel: string
): string {
  if (input.primitive === "repeated-item") {
    return "Search result"
  }
  if (input.primitive === "authored-block") {
    return "Primary result"
  }

  return displayLabel
}

export class SearchEnhancer implements SiteEnhancer {
  readonly id = "search"

  match(url: URL, document: Document): boolean {
    return isSearchPage(url, document)
  }

  refineSkeleton(input: SemanticSkeleton, ctx: EnhancerContext): SemanticSkeleton {
    const docsSearch = isDocsSearchPage(ctx.url, ctx.document)
    const hasResults = hasResultGrid(ctx.document)
    return {
      ...input,
      regions: input.regions.map((region) => mapSkeletonRegion(region, docsSearch, hasResults))
    }
  }

  refineRegion(input: SemanticRegion, ctx: EnhancerContext): SemanticRegion {
    const docsSearch = isDocsSearchPage(ctx.url, ctx.document)
    return mapExpandedRegion(input, ctx, docsSearch, hasResultGrid(ctx.document))
  }

  refineSelection(input: SemanticSelectionTarget, ctx: EnhancerContext): SemanticSelectionTarget {
    const element = findSelectionElement(ctx, input)
    const docsSearch = isDocsSearchPage(ctx.url, ctx.document)
    const displayLabel = getSearchLabel(element, {
      primitive: input.primitive,
      subtype: input.subtype
    }, docsSearch, hasResultGrid(ctx.document))

    if (!displayLabel) {
      return input
    }

    const scope = resolveSelectionScope(element, input)
    const label = resolveSelectionLabel(input, displayLabel)

    return {
      ...input,
      ...scope,
      category: resolveSearchCategory(input, docsSearch),
      label,
      displayLabel: label
    }
  }
}
