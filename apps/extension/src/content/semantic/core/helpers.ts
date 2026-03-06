import type {
  ContentNode,
  InteractiveNode,
  PageKind,
  PageNode,
  SemanticNode,
  SemanticPrimitive
} from "@threadatlas/shared"
import type { FocusResult, ResolveFocusInput, SemanticRegion, SemanticRegionRef, SemanticSkeleton } from "@threadatlas/shared/browser-runtime"
import type { SemanticSelectionTarget } from "@threadatlas/shared/runtime"
import type { DetectedRegion, SelectableNodeKind } from "./types"

export function buildWeakRef(element: Element | null, fallback: Element): WeakRef<Element> {
  return new WeakRef(element ?? fallback)
}

export function clearSemanticNodeAttributes(root: ParentNode): void {
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

  for (const element of Array.from(root.querySelectorAll<HTMLElement>("[data-semantic-region],[data-semantic-node-id]"))) {
    for (const attribute of attributes) {
      element.removeAttribute(attribute)
    }
  }
}

export function annotateRegionNodes(region: DetectedRegion): void {
  for (const blueprint of region.nodeBlueprints) {
    blueprint.element.setAttribute("data-semantic-region", region.id)
    blueprint.element.setAttribute("data-semantic-primitive", region.primitive)
    if (region.subtype) {
      blueprint.element.setAttribute("data-semantic-subtype", region.subtype)
    } else {
      blueprint.element.removeAttribute("data-semantic-subtype")
    }
    blueprint.element.setAttribute("data-semantic-category", blueprint.category ?? region.category)
    blueprint.element.setAttribute("data-semantic-node-id", blueprint.nodeId)
    blueprint.element.setAttribute("data-semantic-node-kind", blueprint.kind)
    blueprint.element.setAttribute("data-semantic-scope-root-id", blueprint.scopeRootId)
    blueprint.element.setAttribute("data-semantic-display-label", blueprint.displayLabel)
    if (blueprint.textPreview) {
      blueprint.element.setAttribute("data-semantic-text-preview", blueprint.textPreview)
    } else {
      blueprint.element.removeAttribute("data-semantic-text-preview")
    }
    if (region.layoutRole) {
      blueprint.element.setAttribute("data-semantic-layout-role", region.layoutRole)
    } else {
      blueprint.element.removeAttribute("data-semantic-layout-role")
    }
    if (region.roleRank) {
      blueprint.element.setAttribute("data-semantic-role-rank", region.roleRank)
    } else {
      blueprint.element.removeAttribute("data-semantic-role-rank")
    }
    blueprint.element.setAttribute("data-semantic-auto-suppressed", String(Boolean(region.autoSuppressed)))
  }
}

export function derivePageId(url: string): string {
  const parsed = new URL(url)
  const pathname = parsed.pathname.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "")
  return `${parsed.hostname}-${pathname || "root"}`
}

export function buildPageKind(regions: DetectedRegion[]): PageKind {
  if (regions.some((region) => region.primitive === "repeated-item" && region.subtype === "nested")) {
    return "thread"
  }

  const authored = regions.find((region) => region.primitive === "authored-block")
  if (authored?.subtype === "post") {
    return "post"
  }
  if (authored) {
    return "article"
  }

  return "generic"
}

export function buildPageDescription(document: Document, url: string, regions: DetectedRegion[]): PageNode {
  const authoredRegion = regions.find((region) => region.primitive === "authored-block")
  const metadata =
    authoredRegion?.metadata && Object.keys(authoredRegion.metadata).length > 0
      ? authoredRegion.metadata
      : undefined

  return {
    id: derivePageId(url),
    url,
    title: authoredRegion?.pageTitle ?? document.title,
    kind: buildPageKind(regions),
    ...(metadata ? { metadata } : {})
  }
}

export function describeRegionLabel(
  primitive: SemanticPrimitive,
  subtype?: string,
  nodeKind?: SelectableNodeKind
): string {
  if (primitive === "repeated-item" && subtype === "nested") {
    return nodeKind === "comment" ? "Comment" : "Thread branch"
  }
  if (primitive === "repeated-item" && subtype === "grid") {
    return "Result card"
  }
  if (primitive === "repeated-item") {
    return "Feed item"
  }
  if (primitive === "navigation-cluster") {
    if (subtype === "breadcrumb") {
      return "Breadcrumb"
    }
    if (subtype === "pagination") {
      return "Pagination"
    }
    return "Menu"
  }
  if (primitive === "authored-block") {
    return "Article section"
  }
  if (primitive === "interactive-block") {
    if (subtype === "search") {
      return "Search"
    }
    if (subtype === "filter") {
      return "Filter controls"
    }
    if (subtype === "sort") {
      return "Sort controls"
    }
    if (subtype === "form") {
      return "Form"
    }
    return "Action group"
  }
  return "Semantic item"
}

export function elementToNodeTarget(element: Element | null): { regionId: string; nodeId: string | null } | null {
  if (!element) {
    return null
  }

  const nodeElement = element.closest("[data-semantic-node-id]") as HTMLElement | null
  if (nodeElement) {
    const primitive = nodeElement.getAttribute("data-semantic-primitive")
    const scopeRootId = nodeElement.getAttribute("data-semantic-scope-root-id")
    return {
      regionId: nodeElement.getAttribute("data-semantic-region") ?? "",
      nodeId:
        primitive === "interactive-block" && scopeRootId
          ? scopeRootId
          : nodeElement.getAttribute("data-semantic-node-id")
    }
  }

  const regionElement = element.closest("[data-semantic-region]") as HTMLElement | null
  if (!regionElement) {
    return null
  }

  return {
    regionId: regionElement.getAttribute("data-semantic-region") ?? "",
    nodeId: null
  }
}

export function createRegionRef(region: DetectedRegion, fallback: Element): SemanticRegionRef {
  return {
    id: region.id,
    kind: region.kind,
    primitive: region.primitive,
    ...(region.subtype ? { subtype: region.subtype } : {}),
    category: region.category,
    anchor: buildWeakRef(region.element.isConnected ? region.element : null, fallback),
    state: "fresh",
    ...(region.parentId ? { parentId: region.parentId } : {}),
    ...(region.displayLabel ? { displayLabel: region.displayLabel } : {})
  }
}

export function nodeFromRegion(region: SemanticRegion, nodeId: string): SemanticNode | null {
  return region.nodes.find((node) => node.id === nodeId) ?? null
}

export function firstMeaningfulNode(region: SemanticRegion): SemanticNode | null {
  return region.nodes.find((node) => {
    if ("text" in node) {
      return Boolean(node.text)
    }

    const interactiveNode = node as InteractiveNode
    return Boolean(interactiveNode.label || interactiveNode.valuePreview)
  }) ?? region.nodes[0] ?? null
}

export function shouldAllowSuppressedFocus(
  source: ResolveFocusInput["source"],
  mode: "selection" | "selected" | "active" | "trigger" | "hover" | "fallback"
): boolean {
  if (mode === "selection" || mode === "selected") {
    return true
  }

  return source === "context-menu" && mode === "trigger"
}

export function toFocusResult(region: SemanticRegion, nodeId: string | null): FocusResult | null {
  const node = (nodeId ? nodeFromRegion(region, nodeId) : null) ?? firstMeaningfulNode(region)
  if (!node) {
    return null
  }

  return {
    regionId: region.id,
    nodeId: node.id,
    node
  }
}

export function isRegionSuppressed(region: DetectedRegion): boolean {
  return Boolean(region.autoSuppressed)
}

export function getRegionNodeText(node: ContentNode | InteractiveNode): string {
  if ("text" in node) {
    return node.text
  }

  return node.valuePreview ?? node.label ?? ""
}
