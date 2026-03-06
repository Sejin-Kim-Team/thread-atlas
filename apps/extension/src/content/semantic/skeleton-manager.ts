import type { PageExtractor, SemanticSkeleton } from "@threadatlas/shared/browser-runtime"

export class SkeletonManager {
  private observer: MutationObserver | null = null
  private invalidateTimer: number | null = null

  constructor(
    private readonly document: Document,
    private readonly window: Window
  ) {}

  applyAnchorAttributes(skeleton: SemanticSkeleton): void {
    for (const region of skeleton.regions) {
      const anchor = region.anchor.deref()
      if (!anchor) {
        continue
      }

      anchor.setAttribute("data-semantic-region", region.id)
      anchor.setAttribute("data-semantic-primitive", region.primitive)
      if (region.subtype) {
        anchor.setAttribute("data-semantic-subtype", region.subtype)
      } else {
        anchor.removeAttribute("data-semantic-subtype")
      }
      anchor.setAttribute("data-semantic-category", region.category)
      if (region.displayLabel) {
        anchor.setAttribute("data-semantic-display-label", region.displayLabel)
      } else {
        anchor.removeAttribute("data-semantic-display-label")
      }
    }
  }

  clearAnchorAttributes(skeleton: SemanticSkeleton | null): void {
    for (const region of skeleton?.regions ?? []) {
      const anchor = region.anchor.deref()
      if (!anchor) {
        continue
      }

      anchor.removeAttribute("data-semantic-region")
      anchor.removeAttribute("data-semantic-primitive")
      anchor.removeAttribute("data-semantic-subtype")
      anchor.removeAttribute("data-semantic-category")
      anchor.removeAttribute("data-semantic-display-label")
    }
  }

  clearDocumentSemanticAttributes(): void {
    const attributes = [
      "data-semantic-region",
      "data-semantic-primitive",
      "data-semantic-subtype",
      "data-semantic-category",
      "data-semantic-node-id",
      "data-semantic-node-kind",
      "data-semantic-scope-root-id",
      "data-semantic-display-label",
      "data-semantic-text-preview",
      "data-semantic-layout-role",
      "data-semantic-role-rank",
      "data-semantic-auto-suppressed"
    ]

    for (const element of Array.from(
      this.document.querySelectorAll<HTMLElement>("[data-semantic-region],[data-semantic-node-id]")
    )) {
      for (const attribute of attributes) {
        element.removeAttribute(attribute)
      }
    }
  }

  observe(
    extractor: PageExtractor,
    skeleton: SemanticSkeleton,
    onInvalidate: (regionIds: string[]) => void
  ): void {
    if (!this.document.body) {
      return
    }

    this.observer = new MutationObserver((mutations) => {
      const structural = mutations.filter((mutation) => extractor.isStructuralMutation?.(mutation) !== false)
      if (structural.length === 0) {
        return
      }

      const affected = this.findAffectedRegions(structural)
      if (affected.length === 0) {
        return
      }

      if (this.invalidateTimer !== null) {
        this.window.clearTimeout(this.invalidateTimer)
      }

      this.invalidateTimer = this.window.setTimeout(() => {
        const validIds = new Set(skeleton.regions.map((region) => region.id))
        onInvalidate(affected.filter((regionId) => validIds.has(regionId)))
        this.invalidateTimer = null
      }, 300)
    })

    this.observer.observe(this.document.body, {
      childList: true,
      subtree: true
    })
  }

  disconnect(): void {
    this.observer?.disconnect()
    this.observer = null
    if (this.invalidateTimer !== null) {
      this.window.clearTimeout(this.invalidateTimer)
      this.invalidateTimer = null
    }
  }

  private findAffectedRegions(mutations: MutationRecord[]): string[] {
    const affected = new Set<string>()
    const elementConstructor = this.document.defaultView?.Element

    if (!elementConstructor) {
      return []
    }

    for (const mutation of mutations) {
      const candidates: Element[] = []
      if (mutation.target instanceof elementConstructor) {
        candidates.push(mutation.target)
      }

      for (const node of [...mutation.addedNodes, ...mutation.removedNodes]) {
        if (node instanceof elementConstructor) {
          candidates.push(node)
        }
      }

      for (const candidate of candidates) {
        const anchor = candidate.closest("[data-semantic-region]")
        const regionId = anchor?.getAttribute("data-semantic-region")
        if (regionId) {
          affected.add(regionId)
        }

        for (const descendant of candidate.querySelectorAll?.("[data-semantic-region]") ?? []) {
          const descendantRegionId = descendant.getAttribute("data-semantic-region")
          if (descendantRegionId) {
            affected.add(descendantRegionId)
          }
        }
      }
    }

    return [...affected]
  }
}
