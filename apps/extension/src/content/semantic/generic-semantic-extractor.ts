import type { PageNode } from "@threadatlas/shared"
import type {
  EnhancerContext,
  FocusResult,
  PageExtractor,
  ResolveFocusInput,
  SemanticRegion,
  SemanticRegionRef,
  SemanticSkeleton,
  SiteEnhancer
} from "@threadatlas/shared/browser-runtime"
import type { SemanticSelectionTarget } from "@threadatlas/shared/runtime"
import { HackerNewsEnhancer } from "./hacker-news-enhancer"
import type { RegionDump } from "./core/observability"
import { createDefaultRecognizers } from "./core/detection/recognizers"
import {
  annotateRegionNodes,
  buildPageDescription,
  createRegionRef,
  elementToNodeTarget,
  firstMeaningfulNode,
  isRegionSuppressed,
  nodeFromRegion,
  shouldAllowSuppressedFocus,
  toFocusResult,
  clearSemanticNodeAttributes
} from "./core/helpers"
import { sortRegionsForFallback } from "./core/layout/layout-role"
import { SemanticPipeline } from "./core/pipeline/SemanticPipeline"
import type { GenericRecognizer, RoledRegion } from "./core/types"

type FocusResolutionMode = "selection" | "selected" | "active" | "trigger" | "hover" | "fallback"

function annotationPriority(region: RoledRegion): number {
  if (region.primitive === "authored-block") {
    return 0
  }
  if (region.primitive === "navigation-cluster") {
    return 1
  }
  if (region.primitive === "repeated-item") {
    return 2
  }
  if (region.primitive === "interactive-block") {
    return 3
  }

  return 0
}

export class GenericSemanticExtractor implements PageExtractor {
  readonly id = "generic-semantic"

  private readonly recognizers: GenericRecognizer[] = createDefaultRecognizers()
  private readonly pipeline = new SemanticPipeline(this.recognizers)
  private readonly enhancers: SiteEnhancer[] = [new HackerNewsEnhancer()]
  private readonly regionIndex = new Map<string, RoledRegion>()
  private lastPage: PageNode | null = null

  match(_url: string, _document: Document): boolean {
    return true
  }

  describePage(document: Document, url: string): PageNode {
    return this.lastPage ?? buildPageDescription(document, url, [...this.regionIndex.values()])
  }

  buildSkeleton(document: Document): SemanticSkeleton {
    clearSemanticNodeAttributes(document)
    this.pipeline.reset()
    this.regionIndex.clear()

    const { regions } = this.pipeline.build(document)
    for (const region of regions) {
      this.regionIndex.set(region.id, region)
    }

    this.lastPage = buildPageDescription(document, document.location?.href ?? "https://unknown.local", regions)

    let skeleton: SemanticSkeleton = {
      version: 0,
      pageType: this.lastPage.kind,
      regions: regions.map((region) => createRegionRef(region, document.body)),
      anchors: new Map(regions.map((region) => [region.id, createRegionRef(region, document.body).anchor]))
    }

    skeleton = this.applySkeletonEnhancers(skeleton, document)

    const annotationRefs = [...skeleton.regions].sort((left, right) => {
      const leftRegion = this.regionIndex.get(left.id)
      const rightRegion = this.regionIndex.get(right.id)
      const leftPriority = leftRegion ? annotationPriority(leftRegion) : 0
      const rightPriority = rightRegion ? annotationPriority(rightRegion) : 0
      return leftPriority - rightPriority
    })

    for (const regionRef of annotationRefs) {
      const region = this.regionIndex.get(regionRef.id)
      if (!region) {
        continue
      }

      region.category = regionRef.category
      if (regionRef.parentId) {
        region.parentId = regionRef.parentId
      } else {
        delete region.parentId
      }
      region.displayLabel = regionRef.displayLabel ?? region.displayLabel
      if (regionRef.subtype) {
        region.subtype = regionRef.subtype
      } else {
        delete region.subtype
      }
      annotateRegionNodes(region)
    }

    return skeleton
  }

  expandRegion(region: SemanticRegionRef, document: Document): SemanticRegion {
    const detected = this.regionIndex.get(region.id)
    if (!detected) {
      return {
        id: region.id,
        kind: region.kind,
        primitive: region.primitive,
        ...(region.subtype ? { subtype: region.subtype } : {}),
        category: region.category,
        nodes: []
      }
    }

    const expanded = this.pipeline.expandRegion(region.id, document)
    if (!expanded) {
      return {
        id: region.id,
        kind: region.kind,
        primitive: region.primitive,
        ...(region.subtype ? { subtype: region.subtype } : {}),
        category: region.category,
        nodes: []
      }
    }

    return this.applyRegionEnhancers(expanded, document)
  }

  resolveFocus(document: Document, input: ResolveFocusInput): FocusResult | null {
    const selectionElement =
      input.selection?.anchorNode instanceof Element
        ? input.selection.anchorNode
        : input.selection?.anchorNode?.parentElement ?? null

    return (
      this.resolveFromElement(document, selectionElement, input, "selection") ??
      this.resolveFromElement(document, input.selectedElement ?? null, input, "selected") ??
      this.resolveFromElement(document, input.activeElement, input, "active") ??
      this.resolveFromElement(document, input.triggerTarget, input, "trigger") ??
      this.resolveFromElement(document, input.lastHoveredElement ?? null, input, "hover") ??
      this.getFallbackFocus(document, input)
    )
  }

  isStructuralMutation(mutation: MutationRecord): boolean {
    return mutation.type === "childList" && (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0)
  }

  onNavigate(url: URL, prevUrl: URL): "rebuild" | "ignore" {
    const nextKey = `${url.origin}${url.pathname}${url.search}`
    const prevKey = `${prevUrl.origin}${prevUrl.pathname}${prevUrl.search}`
    return nextKey === prevKey ? "ignore" : "rebuild"
  }

  refineSelectionTarget(selection: SemanticSelectionTarget, document: Document): SemanticSelectionTarget {
    return this.applySelectionEnhancers(selection, document)
  }

  dumpObservability(document: Document): RegionDump {
    return this.pipeline.createRegionDump(document)
  }

  private resolveFromElement(
    document: Document,
    element: Element | null,
    input: ResolveFocusInput,
    mode: FocusResolutionMode
  ): FocusResult | null {
    const target = elementToNodeTarget(element)
    if (!target?.regionId) {
      return null
    }

    const detected = this.regionIndex.get(target.regionId)
    if (!detected) {
      return null
    }

    if (isRegionSuppressed(detected) && !shouldAllowSuppressedFocus(input.source, mode)) {
      return null
    }

    const regionRef = createRegionRef(detected, document.body)
    const region = this.expandRegion(regionRef, document)
    return toFocusResult(region, target.nodeId)
  }

  private getFallbackFocus(document: Document, input: ResolveFocusInput): FocusResult | null {
    const regions = [...this.regionIndex.values()]
      .filter((region) => !isRegionSuppressed(region) || shouldAllowSuppressedFocus(input.source, "fallback"))
      .sort(sortRegionsForFallback)

    for (const region of regions) {
      const expanded = this.expandRegion(createRegionRef(region, document.body), document)
      const node = firstMeaningfulNode(expanded)
      if (!node) {
        continue
      }

      return {
        regionId: expanded.id,
        nodeId: node.id,
        node
      }
    }

    return null
  }

  private buildEnhancerContext(document: Document): EnhancerContext {
    return {
      url: new URL(document.location?.href ?? "https://unknown.local"),
      document
    }
  }

  private getActiveEnhancers(document: Document): SiteEnhancer[] {
    const context = this.buildEnhancerContext(document)
    return this.enhancers.filter((enhancer) => enhancer.match(context.url, context.document))
  }

  private applySkeletonEnhancers(skeleton: SemanticSkeleton, document: Document): SemanticSkeleton {
    const context = this.buildEnhancerContext(document)
    return this.getActiveEnhancers(document).reduce(
      (current, enhancer) => enhancer.refineSkeleton?.(current, context) ?? current,
      skeleton
    )
  }

  private applyRegionEnhancers(region: SemanticRegion, document: Document): SemanticRegion {
    const context = this.buildEnhancerContext(document)
    return this.getActiveEnhancers(document).reduce(
      (current, enhancer) => enhancer.refineRegion?.(current, context) ?? current,
      region
    )
  }

  private applySelectionEnhancers(
    selection: SemanticSelectionTarget,
    document: Document
  ): SemanticSelectionTarget {
    const context = this.buildEnhancerContext(document)
    return this.getActiveEnhancers(document).reduce(
      (current, enhancer) => enhancer.refineSelection?.(current, context) ?? current,
      selection
    )
  }
}
