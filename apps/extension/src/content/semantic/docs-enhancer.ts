import type {
  EnhancerContext,
  SemanticRegion,
  SemanticSkeleton,
  SiteEnhancer
} from "@threadatlas/shared/browser-runtime"
import type { SemanticSelectionTarget } from "@threadatlas/shared/runtime"

type DocsPageKind = "landing" | "guide" | "reference"

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase()
}

function isDocsPage(url: URL, document: Document): boolean {
  if (url.pathname.startsWith("/docs")) {
    return true
  }

  return Boolean(
    document.querySelector(".docs-layout, .docs-shell, nav[aria-label*='Docs'], nav[aria-label*='Guide']")
  )
}

function getDocsPageKind(url: URL, document: Document): DocsPageKind {
  const pathname = normalizeText(url.pathname)
  const hasReferenceSignals =
    pathname.includes("/reference") ||
    pathname.includes("/api") ||
    Boolean(document.querySelector("[data-docs-kind='reference'], .reference-layout"))

  if (hasReferenceSignals) {
    return "reference"
  }

  const isLandingPath = pathname === "/docs" || pathname === "/docs/" || pathname === "/docs/index"
  const hasLandingSignals = Boolean(document.querySelector(".docs-card-grid, [data-docs-landing]"))
  if (isLandingPath || hasLandingSignals) {
    return "landing"
  }

  return "guide"
}

function getAnchorElement(region: SemanticSkeleton["regions"][number]): Element | null {
  return region.anchor.deref?.() ?? null
}

function isBreadcrumbLike(element: Element, region: { subtype?: string }): boolean {
  const ariaLabel = normalizeText(element.getAttribute("aria-label"))
  return region.subtype === "breadcrumb" || ariaLabel.includes("breadcrumb")
}

function isTableOfContentsLike(element: Element): boolean {
  const ariaLabel = normalizeText(element.getAttribute("aria-label"))
  const semanticText = normalizeText(
    `${element.getAttribute("class")} ${element.getAttribute("id")} ${element.textContent ?? ""}`
  )
  return (
    ariaLabel.includes("table of contents") ||
    ariaLabel === "toc" ||
    semanticText.includes("table of contents") ||
    semanticText.includes(" toc ")
  )
}

function isRelatedLinksLike(element: Element): boolean {
  const ariaLabel = normalizeText(element.getAttribute("aria-label"))
  return (
    Boolean(element.closest("footer")) ||
    ariaLabel.includes("footer") ||
    ariaLabel.includes("related") ||
    ariaLabel.includes("resources")
  )
}

function labelDocsNavigation(
  element: Element,
  region: { subtype?: string },
  pageKind: DocsPageKind
): string | null {
  if (isBreadcrumbLike(element, region)) {
    return "Breadcrumb"
  }
  if (isTableOfContentsLike(element)) {
    return "Table of contents"
  }
  if (element.closest("aside")) {
    if (pageKind === "reference") {
      return "Reference sections"
    }
    if (pageKind === "guide") {
      return "Guide sections"
    }
    return "Docs sidebar"
  }
  if (isRelatedLinksLike(element)) {
    return "Related links"
  }

  return null
}

function regionLabelForElement(
  element: Element | null,
  region: { primitive: string; subtype?: string },
  pageKind: DocsPageKind
): string | null {
  if (!element) {
    return null
  }

  if (region.primitive === "navigation-cluster") {
    return labelDocsNavigation(element, region, pageKind)
  }

  if (region.primitive === "authored-block") {
    if (pageKind === "landing") {
      return "Documentation overview"
    }
    if (pageKind === "reference") {
      return "API reference"
    }
    return "Guide article"
  }

  if (region.primitive === "repeated-item" && region.subtype === "grid") {
    return pageKind === "reference" ? "Reference entries" : "Documentation cards"
  }

  if (region.primitive === "interactive-block" && region.subtype === "search") {
    return "Docs search"
  }

  return null
}

function resolveDocsCategory(
  region: Pick<SemanticSelectionTarget, "primitive" | "subtype" | "category">
): SemanticSelectionTarget["category"] {
  if (region.primitive === "authored-block" || region.primitive === "repeated-item") {
    return "content.article"
  }
  if (region.primitive === "navigation-cluster" && region.subtype === "breadcrumb") {
    return "navigation.breadcrumb"
  }

  return region.category
}

function mapSkeletonRegion(
  region: SemanticSkeleton["regions"][number],
  pageKind: DocsPageKind
): SemanticSkeleton["regions"][number] {
  const anchor = getAnchorElement(region)
  const displayLabel = regionLabelForElement(anchor, {
    primitive: region.primitive,
    subtype: region.subtype
  }, pageKind)

  if (!displayLabel) {
    return region
  }

  return {
    ...region,
    category: resolveDocsCategory(region),
    displayLabel
  }
}

function mapExpandedRegion(region: SemanticRegion, ctx: EnhancerContext, pageKind: DocsPageKind): SemanticRegion {
  const anchor = ctx.document.querySelector(`[data-semantic-region="${region.id}"]`)
  const displayLabel = regionLabelForElement(anchor, {
    primitive: region.primitive,
    subtype: region.subtype
  }, pageKind)

  if (!displayLabel) {
    return region
  }

  return {
    ...region,
    category: resolveDocsCategory(region),
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
  displayLabel: string,
  pageKind: DocsPageKind
): string {
  if (input.primitive === "repeated-item") {
    return pageKind === "reference" ? "Reference entry" : "Documentation card"
  }
  if (input.primitive === "authored-block") {
    if (pageKind === "reference") {
      return "Reference section"
    }
    if (pageKind === "landing") {
      return "Documentation section"
    }
    return "Guide section"
  }

  return displayLabel
}

export class DocsEnhancer implements SiteEnhancer {
  readonly id = "docs"

  match(url: URL, document: Document): boolean {
    return isDocsPage(url, document)
  }

  refineSkeleton(input: SemanticSkeleton, ctx: EnhancerContext): SemanticSkeleton {
    const pageKind = getDocsPageKind(ctx.url, ctx.document)
    return {
      ...input,
      regions: input.regions.map((region) => mapSkeletonRegion(region, pageKind))
    }
  }

  refineRegion(input: SemanticRegion, ctx: EnhancerContext): SemanticRegion {
    return mapExpandedRegion(input, ctx, getDocsPageKind(ctx.url, ctx.document))
  }

  refineSelection(input: SemanticSelectionTarget, ctx: EnhancerContext): SemanticSelectionTarget {
    const element = findSelectionElement(ctx, input)
    const pageKind = getDocsPageKind(ctx.url, ctx.document)
    const displayLabel = regionLabelForElement(element, {
      primitive: input.primitive,
      subtype: input.subtype
    }, pageKind)

    if (!displayLabel) {
      return input
    }

    const scope = resolveSelectionScope(element, input)
    const label = resolveSelectionLabel(input, displayLabel, pageKind)

    return {
      ...input,
      ...scope,
      category: resolveDocsCategory(input),
      label,
      displayLabel: label
    }
  }
}
