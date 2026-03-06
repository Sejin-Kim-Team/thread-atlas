import { Readability, isProbablyReaderable } from "@mozilla/readability"
import type {
  CommentNode,
  ContentNode,
  InteractiveNode,
  PageKind,
  SemanticCategory,
  SemanticPrimitive
} from "@threadatlas/shared"
import type { SemanticRegion } from "@threadatlas/shared/browser-runtime"
import { sanitizeInteractiveNode } from "@threadatlas/shared/browser-runtime"
import {
  type DetectedRegion,
  type GenericRecognizer,
  type NodeBlueprint,
  type AssembledItem,
  type SelectableNodeKind
} from "../types"
import {
  annotateContentNodes,
  mapElementToContentNode
} from "../../ast"
import {
  detectHeadingClusterCandidates,
  detectRepeatedStructureCandidates,
  detectSemanticElementCandidates
} from "../../signals"
import { extractReadableText, normalizeText } from "../../text"

const TITLE_SELECTOR = "h1,h2,h3,h4,h5,h6,[role='heading'],a,strong"
const AUTHOR_SELECTOR = "[rel='author'],[itemprop*='author' i],[class*='author' i],[class*='user' i]"
const TIMESTAMP_SELECTOR = "time,[datetime],[class*='time' i],[class*='date' i],[class*='age' i]"
const METADATA_SELECTOR = "time,[datetime],[class*='meta' i],[class*='byline' i],[class*='info' i],[class*='subtext' i]"
const PRIMARY_TEXT_SELECTOR = "article,section,p,blockquote,pre,code,div,td,li,a,span"

function splitTitleParts(title: string): string[] {
  return title
    .split(/\s+[|\-–—:]\s+/)
    .map((part) => normalizeText(part))
    .filter((part) => part.length >= 8)
}

function getTitleHint(document: Document): string | null {
  const [first] = splitTitleParts(document.title)
  return first ?? null
}

function signatureForElement(element: Element): string {
  const classes = [...element.classList].slice(0, 4).sort().join(".")
  const childSignature = Array.from(element.children)
    .map((child) => {
      const childClasses = [...child.classList].slice(0, 2).sort().join(".")
      const attrNames = [...child.attributes].map((attribute) => attribute.name).slice(0, 3).sort().join(",")
      return [child.tagName.toLowerCase(), childClasses, attrNames].join(":")
    })
    .join("/")
  const depthHint = element.querySelector("[indent],[data-depth],[aria-level]") ? "depth" : ""

  return [element.tagName.toLowerCase(), classes, String(element.children.length), childSignature, depthHint].join("|")
}

function signatureSimilarity(left: string, right: string): number {
  if (left === right) {
    return 1
  }

  const leftParts = new Set(left.split("|"))
  const rightParts = new Set(right.split("|"))
  const shared = [...leftParts].filter((part) => rightParts.has(part)).length
  return shared / Math.max(leftParts.size, rightParts.size, 1)
}

function roleHintForElement(element: Element): "title" | "metadata" | "body" {
  if (element.querySelector(".titleline,h1,h2,h3,h4,h5,h6,[role='heading'],strong")) {
    return "title"
  }
  if (element.querySelector(".subtext,.meta,.byline,.age,time,[class*='subtext'],[class*='meta']")) {
    return "metadata"
  }
  return "body"
}

function clearSemanticNodeAttributes(root: ParentNode): void {
  const attributes = [
    "data-semantic-region",
    "data-semantic-primitive",
    "data-semantic-subtype",
    "data-semantic-category",
    "data-semantic-node-id",
    "data-semantic-node-kind",
    "data-semantic-scope-root-id",
    "data-semantic-display-label",
    "data-semantic-text-preview"
  ]

  for (const element of Array.from(root.querySelectorAll<HTMLElement>("[data-semantic-region],[data-semantic-node-id]"))) {
    for (const attribute of attributes) {
      element.removeAttribute(attribute)
    }
  }
}

function buildScopeRootId(regionId: string): string {
  return `${regionId}-scope-root`
}

function annotateRegionNodes(region: DetectedRegion): void {
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
  }
}

function getElementDepth(element: Element, root: Element): number {
  if (element.tagName.toLowerCase() === "li") {
    let depth = 0
    let current: Element | null = element.parentElement

    while (current && current !== root) {
      if (current.tagName.toLowerCase() === "li") {
        depth += 1
      }
      current = current.parentElement
    }

    return depth
  }

  const candidates = [
    element.getAttribute("aria-level"),
    element.getAttribute("data-depth"),
    element.getAttribute("depth"),
    element.getAttribute("level"),
    element.querySelector("[indent]")?.getAttribute("indent"),
    element.querySelector("[data-depth]")?.getAttribute("data-depth"),
    element.querySelector("[aria-level]")?.getAttribute("aria-level")
  ]

  for (const candidate of candidates) {
    const parsed = Number.parseInt(candidate ?? "", 10)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  const descendantWithSpacing = element.querySelector<HTMLElement>("[style*='padding-left'],[style*='margin-left']")
  if (descendantWithSpacing) {
    const style = descendantWithSpacing.getAttribute("style") ?? ""
    const match = style.match(/(?:padding-left|margin-left)\s*:\s*(\d+)/i)
    if (match?.[1]) {
      const spacing = Number.parseInt(match[1], 10)
      if (Number.isFinite(spacing) && spacing > 0) {
        return Math.round(spacing / 40)
      }
    }
  }

  return 0
}

function findTitleElement(root: Element, titleHint: string | null): Element | null {
  const candidates = Array.from(root.querySelectorAll(TITLE_SELECTOR))
  if (titleHint) {
    for (const candidate of candidates) {
      const text = normalizeText(candidate.textContent ?? "")
      if (!text) {
        continue
      }

      if (text.includes(titleHint) || titleHint.includes(text)) {
        return candidate
      }
    }
  }

  return candidates[0] ?? null
}

function findMetadataElement(root: Element): Element | null {
  return root.querySelector(METADATA_SELECTOR)
}

function findAuthor(root: Element): string | undefined {
  const author = normalizeText(root.querySelector(AUTHOR_SELECTOR)?.textContent ?? "")
  return author || undefined
}

function findTimestamp(root: Element): string | undefined {
  const timestamp = normalizeText(
    root.querySelector(TIMESTAMP_SELECTOR)?.getAttribute("datetime") ??
      root.querySelector(TIMESTAMP_SELECTOR)?.textContent ??
      ""
  )
  return timestamp || undefined
}

function scorePrimaryCandidate(root: Element, candidate: Element): number {
  const text = normalizeText(candidate.textContent ?? "")
  if (!text) {
    return -1
  }

  let score = text.length
  if (candidate.matches("p,blockquote,pre,code,article,section,div")) {
    score += 40
  }
  if (candidate.matches("a")) {
    score += 15
  }
  if (candidate.matches(AUTHOR_SELECTOR) || candidate.matches(TIMESTAMP_SELECTOR)) {
    score -= 50
  }

  let depth = 0
  let current: Element | null = candidate
  while (current && current !== root) {
    depth += 1
    current = current.parentElement
  }

  return score + depth
}

function findPrimaryContentElement(root: Element): Element {
  const candidates = [root, ...Array.from(root.querySelectorAll(PRIMARY_TEXT_SELECTOR))]
  const best = candidates
    .map((candidate) => ({
      candidate,
      score: scorePrimaryCandidate(root, candidate)
    }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => right.score - left.score)[0]

  return best?.candidate ?? root
}

function findBestRepeatedChildGroup(root: Element): Element[] {
  const directChildren = Array.from(root.children)
  if (directChildren.length < 3) {
    return []
  }

  const groups = new Map<string, Element[]>()
  for (const child of directChildren) {
    const signature = signatureForElement(child)
    groups.set(signature, [...(groups.get(signature) ?? []), child])
  }

  const group = [...groups.values()].sort((left, right) => right.length - left.length)[0]
  return group && group.length >= 3 ? group : []
}

function uniqueElements<T extends Element>(elements: T[]): T[] {
  const seen = new Set<T>()
  const result: T[] = []

  for (const element of elements) {
    if (seen.has(element)) {
      continue
    }
    seen.add(element)
    result.push(element)
  }

  return result
}

function textForElement(element: Element): string {
  return normalizeText(extractReadableText(element, { preserveLineBreaks: true }))
}

function buildRegionId(primitive: SemanticPrimitive, index: number): string {
  return `${primitive}-${index + 1}`
}

function derivePageId(url: string): string {
  const parsed = new URL(url)
  const pathname = parsed.pathname.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "")
  return `${parsed.hostname}-${pathname || "root"}`
}

function buildPageKind(regions: DetectedRegion[]): PageKind {
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

function describeRegionLabel(primitive: SemanticPrimitive, subtype?: string, nodeKind?: SelectableNodeKind): string {
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

function applyHeadingHierarchy(nodes: ContentNode[]): ContentNode[] {
  const stack: Array<{ id: string; level: number }> = []

  return nodes.map((node) => {
    const nextNode: ContentNode = { ...node }

    if (nextNode.type === "heading" && nextNode.level) {
      while (stack.length > 0 && stack[stack.length - 1]!.level >= nextNode.level) {
        stack.pop()
      }

      if (stack.length > 0) {
        nextNode.parentId = stack[stack.length - 1]!.id
      }

      stack.push({
        id: nextNode.id,
        level: nextNode.level
      })
      return nextNode
    }

    if (stack.length > 0) {
      nextNode.parentId = stack[stack.length - 1]!.id
    }

    return nextNode
  })
}

interface ReaderableArticleSignal {
  root: Element | null
  title: string | null
  byline: string | null
  excerpt: string | null
  siteName: string | null
  publishedTime: string | null
}

function getSemanticRootFallback(document: Document, titleHint: string | null): Element | null {
  const titleMatch = titleHint
    ? Array.from(document.querySelectorAll(TITLE_SELECTOR)).find((candidate) => {
        const text = normalizeText(candidate.textContent ?? "")
        return text.includes(titleHint) || titleHint.includes(text)
      }) ?? null
    : null

  return (
    document.querySelector("article") ??
    document.querySelector("main") ??
    document.querySelector("[role='main']") ??
    titleMatch?.closest("article,main,section,table,tbody,div") ??
    detectSemanticElementCandidates(document)[0]?.element ??
    detectHeadingClusterCandidates(document)[0]?.element ??
    null
  )
}

function detectReaderableArticle(document: Document): ReaderableArticleSignal {
  const titleHint = getTitleHint(document)
  const fallbackRoot = getSemanticRootFallback(document, titleHint)
  const readerable = isProbablyReaderable(document, {
    minContentLength: 80,
    minScore: 16
  })

  if (!readerable) {
    return {
      root: fallbackRoot,
      title: titleHint ?? document.title ?? null,
      byline: null,
      excerpt: null,
      siteName: null,
      publishedTime: null
    }
  }

  const clone = document.cloneNode(true) as Document
  const reader = new Readability<Element | string>(clone, {
    charThreshold: 80,
    serializer: (node) => node as Element
  })
  const article = reader.parse()

  return {
    root: fallbackRoot,
    title: article?.title ?? titleHint ?? document.title ?? null,
    byline: article?.byline ?? null,
    excerpt: article?.excerpt ?? null,
    siteName: article?.siteName ?? null,
    publishedTime: article?.publishedTime ?? null
  }
}

function buildAuthoredRegion(regionId: string, root: Element, subtype: string, metadata?: Record<string, string>): {
  region: SemanticRegion
  blueprints: NodeBlueprint[]
} {
  const nodes: ContentNode[] = []
  const blueprints: NodeBlueprint[] = []
  const titleHint = getTitleHint(root.ownerDocument)
  const titleElement = findTitleElement(root, titleHint)
  const metadataElement = findMetadataElement(root)
  const titleText = normalizeText(
    titleElement?.textContent ?? titleHint ?? root.ownerDocument.title ?? extractReadableText(root)
  )
  let index = 0
  let titleNodeId: string | null = null

  if (titleText) {
    index += 1
    titleNodeId = `${regionId}-node-${index}`
    nodes.push({
      kind: "content",
      id: titleNodeId,
      type: "heading",
      text: titleText,
      level: 1
    })
    if (titleElement) {
      blueprints.push({
        nodeId: titleNodeId,
        element: titleElement,
        kind: "content",
        scopeRootId: titleNodeId,
        displayLabel: describeRegionLabel("authored-block", subtype, "content")
      })
    }
  }

  const metadataText = metadataElement ? textForElement(metadataElement) : ""
  if (metadataElement && metadataText) {
    index += 1
    const nodeId = `${regionId}-node-${index}`
    nodes.push({
      kind: "content",
      id: nodeId,
      type: "metadata",
      text: metadataText,
      ...(titleNodeId ? { parentId: titleNodeId } : {})
    })
    blueprints.push({
      nodeId,
      element: metadataElement,
      kind: "content",
      scopeRootId: titleNodeId ?? nodeId,
      displayLabel: describeRegionLabel("authored-block", subtype, "content")
    })
  }

  if (titleElement instanceof HTMLAnchorElement && titleElement.href) {
    index += 1
    const nodeId = `${regionId}-node-${index}`
    nodes.push({
      kind: "content",
      id: nodeId,
      type: "link",
      text: titleElement.href,
      attributes: {
        href: titleElement.href
      },
      ...(titleNodeId ? { parentId: titleNodeId } : {})
    })
    blueprints.push({
      nodeId,
      element: titleElement,
      kind: "content",
      scopeRootId: titleNodeId ?? nodeId,
      displayLabel: describeRegionLabel("authored-block", subtype, "content")
    })
  }

  const annotatedBlocks = annotateContentNodes(root, `${regionId}-content`)
  const remainingBlocks = annotatedBlocks.filter((element) => element !== titleElement && element !== metadataElement)
  const contentNodes = applyHeadingHierarchy(
    remainingBlocks
      .map((element, blockIndex) => {
        const nodeId = `${regionId}-node-${index + blockIndex + 1}`
        return mapElementToContentNode(element, nodeId)
      })
      .filter((node): node is ContentNode => node !== null && Boolean(node.text))
  )

  for (const node of contentNodes) {
    if (titleNodeId && !node.parentId && node.type !== "heading") {
      node.parentId = titleNodeId
    }
    nodes.push(node)
    const element = remainingBlocks.find((candidate) => candidate.getAttribute("data-semantic-node-id") === node.id)
    if (element) {
      const scopeRootId =
        node.type === "heading" ? node.id : node.parentId ?? titleNodeId ?? node.id
      blueprints.push({
        nodeId: node.id,
        element,
        kind: "content",
        scopeRootId,
        displayLabel: describeRegionLabel("authored-block", subtype, "content")
      })
    }
  }

  const region: SemanticRegion = {
    id: regionId,
    kind: "authored-block",
    primitive: "authored-block",
    subtype,
    category: subtype === "post" ? "content.post" : "content.article",
    displayLabel: describeRegionLabel("authored-block", subtype),
    nodes,
    structure: {
      type: "sequence",
      rootIds: nodes.filter((node) => !node.parentId).map((node) => node.id)
    }
  }

  if (metadata && region.nodes.length > 0 && "text" in region.nodes[0]!) {
    const firstNode = region.nodes[0] as ContentNode
    region.nodes[0] = {
      ...firstNode,
      attributes: metadata
    }
  }

  return {
    region,
    blueprints
  }
}

class AuthoredBlockRecognizer implements GenericRecognizer {
  readonly primitive = "authored-block" as const

  detectDetailed(document: Document): DetectedRegion[] {
    const signal = detectReaderableArticle(document)
    const root = signal.root
    if (!root || textForElement(root).length < 80) {
      return []
    }

    const isFeedLikeTable =
      root.matches("table,tbody") &&
      document.querySelectorAll("tr").length >= 5 &&
      !document.querySelector("[indent],[data-depth],[aria-level]")
    const repeatedStructureAtRoot = detectRepeatedStructureCandidates(document).some((candidate) => {
      const itemCount = candidate.itemElements?.length ?? 0
      const hasDepthChange = candidate.signals.some((signal) => signal.type === "depth-change")
      return candidate.element === root && itemCount >= 3 && !hasDepthChange
    })
    if (isFeedLikeTable || (root.matches("table,tbody") && repeatedStructureAtRoot)) {
      return []
    }

    const subtype = root.querySelector("h2,h3,h4,h5,h6") ? "article" : "post"
    const regionId = buildRegionId(this.primitive, 0)
    const metadata = {
      ...(signal.byline ? { byline: signal.byline } : {}),
      ...(signal.excerpt ? { excerpt: signal.excerpt } : {}),
      ...(signal.siteName ? { siteName: signal.siteName } : {}),
      ...(signal.publishedTime ? { publishedTime: signal.publishedTime } : {})
    }
    const { region, blueprints } = buildAuthoredRegion(regionId, root, subtype, metadata)

    return [
      {
        id: regionId,
        element: root,
        primitive: this.primitive,
        confidence: signal.byline || signal.excerpt ? 0.95 : 0.82,
        signals: signal.byline || signal.excerpt ? ["readability", "semantic-root"] : ["semantic-root", "heading-cluster"],
        subtype,
        category: region.category,
        kind: region.kind,
        displayLabel: region.displayLabel ?? "Article section",
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
        ...(signal.title ? { pageTitle: signal.title } : {}),
        pageKindHint: subtype === "post" ? "post" : "article",
        nodeBlueprints: blueprints,
        ...(region.structure ? { structure: region.structure } : {})
      }
    ]
  }

  extractDetailed(region: DetectedRegion, document: Document): SemanticRegion {
    const root = region.element ?? detectReaderableArticle(document).root ?? document.body
    const { region: authoredRegion, blueprints } = buildAuthoredRegion(
      region.id,
      root,
      region.subtype ?? "article"
    )
    annotateRegionNodes({
      id: region.id,
      element: root,
      primitive: this.primitive,
      confidence: 1,
      signals: [],
      ...(region.subtype ? { subtype: region.subtype } : {}),
      category: authoredRegion.category,
      kind: authoredRegion.kind,
      displayLabel: authoredRegion.displayLabel ?? "Article section",
      nodeBlueprints: blueprints,
      ...(authoredRegion.structure ? { structure: authoredRegion.structure } : {})
    })
    return authoredRegion
  }
}

function computeNavigationSubtype(element: Element): string {
  const linkTexts = Array.from(element.querySelectorAll("a[href]")).map((link) =>
    normalizeText(link.textContent ?? "")
  )
  const fullText = normalizeText(element.textContent ?? "")
  const hasBreadcrumbSeparators = /›|»|\/|>/.test(fullText)
  const numericLinks = linkTexts.filter((text) => /^\d+$/.test(text)).length
  const prevNextLinks = linkTexts.filter((text) => /\b(prev|next|previous)\b/i.test(text)).length

  if (hasBreadcrumbSeparators || /breadcrumb/i.test(element.getAttribute("aria-label") ?? "")) {
    return "breadcrumb"
  }

  if (numericLinks >= 2 || prevNextLinks >= 1) {
    return "pagination"
  }

  if (element.closest("aside")) {
    return "local"
  }

  return "global"
}

function buildNavigationRegion(regionId: string, root: Element, subtype: string): {
  region: SemanticRegion
  blueprints: NodeBlueprint[]
} {
  const links = uniqueElements(Array.from(root.querySelectorAll<HTMLAnchorElement>("a[href]"))).filter(
    (link) => normalizeText(link.textContent ?? "").length > 0
  )

  const category: SemanticCategory =
    subtype === "breadcrumb"
      ? "navigation.breadcrumb"
      : subtype === "pagination"
        ? "navigation.pagination"
        : "navigation.menu"

  const nodes: ContentNode[] = []
  const blueprints: NodeBlueprint[] = []

  links.forEach((link, index) => {
    const nodeId = `${regionId}-link-${index + 1}`
    const text = normalizeText(link.textContent ?? link.href)
    nodes.push({
      kind: "content",
      id: nodeId,
      type: "link",
      text,
      attributes: {
        href: link.href
      }
    })
    blueprints.push({
      nodeId,
      element: link,
      kind: "content",
      scopeRootId: nodeId,
      displayLabel: describeRegionLabel("navigation-cluster", subtype, "content")
    })
  })

  return {
    region: {
      id: regionId,
      kind: "navigation-cluster",
      primitive: "navigation-cluster",
      subtype,
      category,
      displayLabel: describeRegionLabel("navigation-cluster", subtype),
      nodes,
      structure: {
        type: "flat",
        rootIds: nodes.map((node) => node.id)
      }
    },
    blueprints
  }
}

class NavigationClusterRecognizer implements GenericRecognizer {
  readonly primitive = "navigation-cluster" as const

  detectDetailed(document: Document): DetectedRegion[] {
    const candidates = uniqueElements([
      ...Array.from(document.querySelectorAll("nav,[role='navigation'],header,footer,aside")),
      ...Array.from(document.querySelectorAll("ul,ol")).filter((list) => {
        const links = Array.from(list.querySelectorAll(":scope > li > a[href]"))
        return links.length >= 2 && links.length === list.querySelectorAll(":scope > li").length
      })
    ])

    return candidates.flatMap((element, index) => {
        const links = Array.from(element.querySelectorAll("a[href]"))
        if (links.length < 2) {
          return []
        }

        const text = normalizeText(element.textContent ?? "")
        const linkText = normalizeText(links.map((link) => link.textContent ?? "").join(" "))
        const density = text.length === 0 ? 1 : linkText.length / text.length
        if (!element.matches("nav,[role='navigation']") && density < 0.7) {
          return []
        }

        const subtype = computeNavigationSubtype(element)
        const regionId = buildRegionId(this.primitive, index)
        const { region, blueprints } = buildNavigationRegion(regionId, element, subtype)
        return {
          id: regionId,
          element,
          primitive: this.primitive,
          confidence: element.matches("nav,[role='navigation']") ? 0.94 : 0.76,
          signals: element.matches("nav,[role='navigation']") ? ["semantic-nav"] : ["link-density"],
          subtype,
          category: region.category,
          kind: region.kind,
          displayLabel: region.displayLabel ?? "Menu",
          pageKindHint: "generic" as const,
          nodeBlueprints: blueprints,
          ...(region.structure ? { structure: region.structure } : {})
        } satisfies DetectedRegion
      })
  }

  extractDetailed(region: DetectedRegion, _document: Document): SemanticRegion {
    const root = region.element
    if (!root) {
      return {
        id: region.id,
        kind: region.kind,
        primitive: region.primitive,
        ...(region.subtype ? { subtype: region.subtype } : {}),
        category: region.category,
        nodes: []
      }
    }

    const { region: navRegion, blueprints } = buildNavigationRegion(region.id, root, region.subtype ?? "global")
    annotateRegionNodes({
      id: region.id,
      element: root,
      primitive: this.primitive,
      confidence: 1,
      signals: [],
      ...(region.subtype ? { subtype: region.subtype } : {}),
      category: navRegion.category,
      kind: navRegion.kind,
      displayLabel: navRegion.displayLabel ?? "Menu",
      nodeBlueprints: blueprints,
      ...(navRegion.structure ? { structure: navRegion.structure } : {})
    })
    return navRegion
  }
}

function buildCommentNodeFromElement(
  element: Element,
  nodeId: string,
  parentId: string | undefined,
  depth: number
): CommentNode | null {
  const primary = findPrimaryContentElement(element)
  let text = textForElement(primary)
  if (!text) {
    text = textForElement(element)
  }
  if (!text) {
    return null
  }

  const author = findAuthor(element)
  const timestamp = findTimestamp(element)

  return {
    kind: "comment",
    id: nodeId,
    text,
    depth,
    ...(author ? { author } : {}),
    ...(timestamp ? { timestamp } : {}),
    ...(parentId ? { parentId } : {}),
    ...(element.id ? { metadata: { sourceElementId: element.id } } : {})
  }
}

function buildContentNodeFromElement(element: Element, nodeId: string): ContentNode | null {
  const primary = findPrimaryContentElement(element)
  return mapElementToContentNode(primary, nodeId) ?? mapElementToContentNode(element, nodeId)
}

function hasInteractiveAffordance(element: Element): boolean {
  return Boolean(element.querySelector("button,input,select,textarea,[role='button'],[role='tab']"))
}

function hasStructuredContent(element: Element): boolean {
  return Boolean(
    element.querySelector("h1,h2,h3,h4,h5,h6,[role='heading'],a[href],img,picture,video,strong,blockquote,time")
  )
}

function isGridContainer(element: Element, items: Element[]): boolean {
  const semanticText = `${element.className} ${element.id} ${element.getAttribute("style") ?? ""}`.toLowerCase()
  if (/\bgrid\b|\bcard\b|\bresult\b|\bgallery\b|\btiles?\b/.test(semanticText)) {
    return true
  }

  const itemWidths = items
    .map((item) => item.getBoundingClientRect().width)
    .filter((width) => Number.isFinite(width) && width > 0)
  if (itemWidths.length >= 3) {
    const uniqueWidths = new Set(itemWidths.map((width) => Math.round(width / 10)))
    if (uniqueWidths.size <= 2 && items.length >= 4) {
      return true
    }
  }

  return false
}

function classifyRepeatedSubtype(root: Element, items: Element[]): "flat" | "nested" | "grid" {
  const depths = items.map((item) => getElementDepth(item, root))
  const hasDepthVariation = new Set(depths).size > 1 || depths.some((depth) => depth > 0)
  if (hasDepthVariation) {
    return "nested"
  }

  if (isGridContainer(root, items)) {
    return "grid"
  }

  return "flat"
}

function isLowQualityRepeatedCandidate(root: Element, items: Element[]): boolean {
  const textLengths = items.map((item) => textForElement(item).length)
  const nonEmptyCount = textLengths.filter((length) => length > 0).length
  if (nonEmptyCount < 3) {
    return true
  }

  const averageLength = textLengths.reduce((sum, length) => sum + length, 0) / Math.max(1, textLengths.length)
  const insideAuthoredBlock = Boolean(root.closest("article,main,section"))
  const hasStructure = items.some((item) => hasStructuredContent(item) || hasInteractiveAffordance(item))

  return insideAuthoredBlock && !hasStructure && averageLength < 60
}

function resolveRepeatedItemElements(root: Element, preferredItems?: Element[]): Element[] {
  if (preferredItems && preferredItems.length > 0) {
    return preferredItems
  }

  const tag = root.tagName.toLowerCase()
  if (tag === "ul" || tag === "ol") {
    return Array.from(root.querySelectorAll("li"))
  }

  if (tag === "table") {
    const tbody = root.querySelector("tbody")
    if (tbody) {
      return resolveRepeatedItemElements(tbody)
    }
    return findBestRepeatedChildGroup(root)
  }

  return findBestRepeatedChildGroup(root)
}

function findApproximateRepeatedChildGroup(root: Element): Element[] {
  const children = Array.from(root.children)
  if (children.length < 3 || children.length > 40) {
    return []
  }

  const signatures = children.map((child) => ({
    child,
    signature: signatureForElement(child),
    roleHint: roleHintForElement(child)
  }))

  let best: Element[] = []
  for (const seed of signatures) {
    const family = signatures
      .filter(
        (candidate) =>
          signatureSimilarity(seed.signature, candidate.signature) >= 0.7 &&
          candidate.roleHint === seed.roleHint
      )
      .map((candidate) => candidate.child)

    if (family.length > best.length) {
      best = family
    }
  }

  return best.length >= 3 && best.length / children.length >= 0.5 ? best : []
}

function buildRepeatedFlatNode(
  item: AssembledItem,
  nodeId: string
): ContentNode | null {
  const node = buildContentNodeFromElement(item.primaryElement, nodeId) ?? buildContentNodeFromElement(item.element, nodeId)
  if (!node || !node.text) {
    return null
  }

  const attributes: Record<string, string> = {
    ...(node.attributes ?? {}),
    ...((item.links?.primary ?? node.attributes?.href) ? { primaryHref: item.links?.primary ?? node.attributes?.href! } : {}),
    ...(item.links?.discussion ? { discussionHref: item.links.discussion } : {}),
    ...(item.metadata?.author ? { author: item.metadata.author } : {}),
    ...(item.metadata?.timestamp ? { timestamp: item.metadata.timestamp } : {}),
    ...(item.metadata?.score ? { score: item.metadata.score } : {}),
    ...(item.metadata?.commentCount ? { commentCount: item.metadata.commentCount } : {})
  }

  if (item.links?.primary && !attributes.href) {
    attributes.href = item.links.primary
  }

  return {
    ...node,
    ...(Object.keys(attributes).length > 0 ? { attributes } : {})
  }
}

function buildRepeatedRegion(
  regionId: string,
  root: Element,
  subtype: string,
  preferredItems?: Element[],
  assembledItems?: AssembledItem[]
): {
  region: SemanticRegion
  blueprints: NodeBlueprint[]
} {
  const itemElements = resolveRepeatedItemElements(root, preferredItems)
  const isNested = subtype === "nested"

  if (isNested) {
    const nodes: CommentNode[] = []
    const blueprints: NodeBlueprint[] = []
    const stack: Array<{ depth: number; id: string; rootId: string }> = []

    itemElements.forEach((element, index) => {
      const depth = getElementDepth(element, root)
      while (stack.length > 0 && stack[stack.length - 1]!.depth >= depth) {
        stack.pop()
      }

      const parentId = stack[stack.length - 1]?.id
      const nodeId = `${regionId}-item-${index + 1}`
      const node = buildCommentNodeFromElement(element, nodeId, parentId, depth)
      if (!node) {
        return
      }

      const rootId = stack[0]?.rootId ?? node.id
      nodes.push(node)
      blueprints.push({
        nodeId: node.id,
        element: findPrimaryContentElement(element),
        kind: "comment",
        scopeRootId: rootId,
        displayLabel: node.author ? `Comment by ${node.author}` : describeRegionLabel("repeated-item", subtype, "comment"),
        category: "discussion.comment",
        textPreview: node.text
      })
      stack.push({
        depth,
        id: node.id,
        rootId
      })
    })

    return {
      region: {
        id: regionId,
        kind: "repeated-item",
        primitive: "repeated-item",
        subtype,
        category: "discussion.thread",
        displayLabel: describeRegionLabel("repeated-item", subtype),
        nodes,
        structure: {
          type: "tree",
          rootIds: nodes.filter((node) => !node.parentId).map((node) => node.id)
        }
      },
      blueprints
    }
  }

  const nodes: ContentNode[] = []
  const blueprints: NodeBlueprint[] = []
  const itemLabel = subtype === "grid" ? "Result card" : "Feed item"
  const builtItems =
    assembledItems && assembledItems.length > 0
      ? assembledItems
      : itemElements.map((element, index) => ({
          nodeId: `${regionId}-item-${index + 1}`,
          element,
          primaryElement: findPrimaryContentElement(element),
          kind: "content" as const,
          companions: [],
          scopeRootId: buildScopeRootId(regionId),
          displayLabel: itemLabel,
          category: "content.post" as const,
          textPreview: textForElement(element)
        }))

  builtItems.forEach((item, index) => {
    const nodeId = item.nodeId || `${regionId}-item-${index + 1}`
    const node = buildRepeatedFlatNode(item, nodeId)
    if (!node || !node.text) {
      return
    }
    nodes.push(node)

    const blueprintElements = uniqueElements([item.element, item.primaryElement, ...item.companions])
    for (const element of blueprintElements) {
      blueprints.push({
        nodeId,
        element,
        kind: "content",
        scopeRootId: item.scopeRootId || buildScopeRootId(regionId),
        displayLabel: item.displayLabel || itemLabel,
        category: item.category ?? "content.post",
        textPreview: item.textPreview ?? node.text
      })
    }
  })

  return {
    region: {
      id: regionId,
      kind: "repeated-item",
      primitive: "repeated-item",
      subtype,
      category: "content.post",
      displayLabel: itemLabel,
      nodes,
      structure: {
        type: "flat",
        rootIds: nodes.map((node) => node.id)
      }
    },
    blueprints
  }
}

class RepeatedItemRecognizer implements GenericRecognizer {
  readonly primitive = "repeated-item" as const

  detectDetailed(document: Document): DetectedRegion[] {
    const listRegions = Array.from(document.querySelectorAll("ul,ol"))
      .filter((list) => list.querySelectorAll(":scope > li").length >= 3 || list.querySelectorAll("li").length >= 3)
      .map((element) => ({
        element,
        itemElements: Array.from(element.querySelectorAll("li")),
        subtype: element.querySelector("li ul, li ol") ? "nested" : "flat",
        confidence: 0.88,
        signals: ["list-structure"]
      }))

    const repeatedCandidates = detectRepeatedStructureCandidates(document)
      .filter((candidate) => {
        const items = candidate.itemElements ?? []
        return items.length >= 3
      })
      .map((candidate) => {
        const items = candidate.itemElements ?? []
        const subtype = classifyRepeatedSubtype(candidate.element, items)
        const allRows = items.every((item) => item.tagName.toLowerCase() === "tr")
        const confidence =
          subtype === "nested"
            ? 0.92
            : subtype === "grid"
              ? 0.8
              : allRows
                ? 0.84
                : 0.78
        return {
          element: candidate.element,
          itemElements: items,
          subtype,
          confidence,
          signals:
            subtype === "nested"
              ? ["repeated-rows", "depth-variation"]
              : subtype === "grid"
                ? ["repeated-rows", "layout-regularity"]
                : ["repeated-rows"]
        }
      })
      .filter((candidate) => !isLowQualityRepeatedCandidate(candidate.element, candidate.itemElements))

    const approximateCandidates = Array.from(document.querySelectorAll("tbody,table,section,div"))
      .map((element) => {
        const items = findApproximateRepeatedChildGroup(element)
        if (items.length < 3) {
          return null
        }

        const subtype = classifyRepeatedSubtype(element, items)
        return {
          element,
          itemElements: items,
          subtype,
          confidence: subtype === "nested" ? 0.9 : subtype === "grid" ? 0.76 : 0.74,
          signals:
            subtype === "nested"
              ? ["approximate-repetition", "depth-variation"]
              : subtype === "grid"
                ? ["approximate-repetition", "layout-regularity"]
                : ["approximate-repetition"]
        }
      })
      .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
      .filter((candidate) => !repeatedCandidates.some((existing) => existing.element === candidate.element))
      .filter((candidate) => !isLowQualityRepeatedCandidate(candidate.element, candidate.itemElements))

    return uniqueElements(
      [
        ...listRegions.map((region) => region.element),
        ...repeatedCandidates.map((region) => region.element),
        ...approximateCandidates.map((region) => region.element)
      ]
    )
      .flatMap((element, index) => {
        const config =
          listRegions.find((region) => region.element === element) ??
          repeatedCandidates.find((region) => region.element === element) ??
          approximateCandidates.find((region) => region.element === element)
        if (!config) {
          return []
        }

        const regionId = buildRegionId(this.primitive, index)
        const { region, blueprints } = buildRepeatedRegion(regionId, element, config.subtype, config.itemElements)
        if (region.nodes.length === 0) {
          return []
        }

        return {
          id: regionId,
          element,
          primitive: this.primitive,
          confidence: config.confidence,
          signals: config.signals,
          subtype: config.subtype,
          category: region.category,
          kind: region.kind,
          displayLabel: describeRegionLabel("repeated-item", config.subtype),
          pageKindHint: config.subtype === "nested" ? ("thread" as const) : ("generic" as const),
          itemElements: config.itemElements,
          nodeBlueprints: blueprints,
          ...(region.structure ? { structure: region.structure } : {})
        } satisfies DetectedRegion
      })
  }

  extractDetailed(region: DetectedRegion, _document: Document): SemanticRegion {
    const root = region.element
    if (!root) {
      return {
        id: region.id,
        kind: region.kind,
        primitive: region.primitive,
        ...(region.subtype ? { subtype: region.subtype } : {}),
        category: region.category,
        nodes: []
      }
    }

    const { region: repeatedRegion, blueprints } = buildRepeatedRegion(
      region.id,
      root,
      region.subtype ?? "flat",
      region.itemElements,
      region.assembledItems
    )
    annotateRegionNodes({
      id: region.id,
      element: root,
      primitive: this.primitive,
      confidence: 1,
      signals: [],
      ...(region.subtype ? { subtype: region.subtype } : {}),
      category: repeatedRegion.category,
      kind: repeatedRegion.kind,
      displayLabel: repeatedRegion.displayLabel ?? "Feed item",
      nodeBlueprints: blueprints,
      ...(repeatedRegion.structure ? { structure: repeatedRegion.structure } : {})
    })
    return repeatedRegion
  }
}

function interactiveCategoryForSubtype(subtype: string): SemanticCategory {
  if (subtype === "search") {
    return "interactive.search"
  }
  if (subtype === "filter") {
    return "interactive.filter"
  }
  if (subtype === "sort") {
    return "interactive.sort"
  }
  if (subtype === "form") {
    return "interactive.form"
  }
  return "interactive.action"
}

function rootActionForSubtype(subtype: string): NonNullable<InteractiveNode["action"]> {
  if (subtype === "search") {
    return "search"
  }
  if (subtype === "filter") {
    return "filter"
  }
  if (subtype === "sort") {
    return "sort"
  }
  if (subtype === "form") {
    return "submit"
  }
  return "unknown"
}

function getInteractiveControls(root: Element): HTMLElement[] {
  const matches = new Set<HTMLElement>()
  if (
    root instanceof HTMLElement &&
    root.matches("input,select,textarea,button,[role='button'],[role='tab'],[role='searchbox']")
  ) {
    matches.add(root)
  }

  for (const element of Array.from(
    root.querySelectorAll<HTMLElement>("input,select,textarea,button,[role='button'],[role='tab'],[role='searchbox']")
  )) {
    const inputType = element.getAttribute("type")?.toLowerCase() ?? ""
    if (inputType === "hidden") {
      continue
    }
    matches.add(element)
  }

  return [...matches]
}

function getInteractiveControlType(control: HTMLElement): InteractiveNode["controlType"] {
  const tag = control.tagName.toLowerCase()
  const role = control.getAttribute("role")?.toLowerCase()
  const inputType = control.getAttribute("type")?.toLowerCase() ?? ""

  if (tag === "select") {
    return "select"
  }
  if (tag === "textarea") {
    return "textarea"
  }
  if (tag === "button") {
    return "button"
  }
  if (role === "button" && tag === "a") {
    return "link-button"
  }
  if (role === "tab") {
    return "chip"
  }
  if (inputType === "checkbox") {
    return "checkbox"
  }
  if (inputType === "radio") {
    return "radio"
  }
  return "input"
}

function resolveControlLabel(control: HTMLElement, root: Element): string {
  const labelledBy = control.getAttribute("aria-labelledby")
  if (labelledBy) {
    const label = labelledBy
      .split(/\s+/)
      .map((id) => normalizeText(root.ownerDocument.getElementById(id)?.textContent ?? ""))
      .filter(Boolean)
      .join(" ")
    if (label) {
      return label
    }
  }

  const label = normalizeText(
    control.getAttribute("aria-label") ??
      control.closest("label")?.textContent ??
      root.querySelector(`label[for="${(control as HTMLInputElement).id}"]`)?.textContent ??
      control.getAttribute("title") ??
      control.textContent ??
      ""
  )
  return label
}

function resolveInteractiveSubtype(root: Element, controls: HTMLElement[]): string {
  const semanticText = normalizeText(
    [
      root.getAttribute("role"),
      root.getAttribute("aria-label"),
      root.getAttribute("id"),
      root.getAttribute("class"),
      ...controls.map((control) =>
        [
          control.getAttribute("role"),
          control.getAttribute("type"),
          control.getAttribute("placeholder"),
          control.getAttribute("name"),
          control.getAttribute("aria-label"),
          control.textContent
        ].join(" ")
      )
    ].join(" ")
  ).toLowerCase()

  const checkboxRadioCount = controls.filter((control) => {
    const type = control.getAttribute("type")?.toLowerCase()
    return type === "checkbox" || type === "radio"
  }).length
  const selectCount = controls.filter((control) => control.tagName.toLowerCase() === "select").length
  const buttonCount = controls.filter((control) => {
    const tag = control.tagName.toLowerCase()
    return tag === "button" || control.getAttribute("role") === "button"
  }).length

  if (
    root.matches("form[role='search'],[role='search']") ||
    /\bsearch\b/.test(semanticText) ||
    controls.some((control) => control.getAttribute("role") === "searchbox")
  ) {
    return "search"
  }

  if (/\bsort|order\b/.test(semanticText)) {
    return "sort"
  }

  if (
    /\bfilter|facet|category|tag|price|date\b/.test(semanticText) ||
    checkboxRadioCount >= 2 ||
    (selectCount >= 1 && buttonCount >= 1)
  ) {
    return "filter"
  }

  if (root.matches("form,fieldset") || controls.filter((control) => getInteractiveControlType(control) === "input").length >= 2) {
    return "form"
  }

  return "action-group"
}

function resolveInteractiveAction(
  control: HTMLElement,
  subtype: string
): NonNullable<InteractiveNode["action"]> {
  if (subtype === "search" || subtype === "filter" || subtype === "sort") {
    return subtype
  }

  const semanticText = normalizeText(
    `${control.getAttribute("aria-label") ?? ""} ${control.getAttribute("name") ?? ""} ${control.textContent ?? ""}`
  ).toLowerCase()

  if (/\bsubmit|save|apply\b/.test(semanticText)) {
    return "submit"
  }
  if (/\btoggle|show|hide|expand|collapse\b/.test(semanticText)) {
    return "toggle"
  }
  if (control.tagName.toLowerCase() === "a") {
    return "navigate"
  }
  return "unknown"
}

function resolveInteractiveState(control: HTMLElement): InteractiveNode["state"] | undefined {
  if (control.hasAttribute("disabled")) {
    return "disabled"
  }

  if ("checked" in control) {
    return (control as HTMLInputElement).checked ? "checked" : "unchecked"
  }

  if (control.getAttribute("aria-selected") === "true") {
    return "selected"
  }
  if (control.getAttribute("aria-expanded") === "true") {
    return "expanded"
  }
  if (control.getAttribute("aria-expanded") === "false") {
    return "collapsed"
  }

  return undefined
}

function buildInteractiveMetadata(control: HTMLElement): Record<string, string> {
  const metadata: Record<string, string> = {}
  const tag = control.tagName.toLowerCase()
  const inputType = control.getAttribute("type")
  const placeholder = control.getAttribute("placeholder")
  const autocomplete = control.getAttribute("autocomplete")
  const name = control.getAttribute("name")
  const rawValue = "value" in control ? String((control as HTMLInputElement).value ?? "") : ""

  if (tag) {
    metadata.tag = tag
  }
  if (inputType) {
    metadata.inputType = inputType
  }
  if (placeholder) {
    metadata.placeholder = placeholder
  }
  if (autocomplete) {
    metadata.autocomplete = autocomplete
  }
  if (name) {
    metadata.name = name
  }
  if (rawValue) {
    metadata.rawValue = rawValue
  }

  return metadata
}

function collectInteractiveRoots(document: Document): Element[] {
  const strongRoots = Array.from(
    document.querySelectorAll("form,fieldset,[role='search'],[role='toolbar'],[role='tablist']")
  )

  const inferredRoots = Array.from(document.querySelectorAll("div,section,aside,header")).filter((element) => {
    const controls = getInteractiveControls(element)
    if (controls.length < 2 || controls.length > 8) {
      return false
    }

    const semanticText = `${element.className} ${element.id} ${element.getAttribute("aria-label") ?? ""}`.toLowerCase()
    const hasKeyword = /\bsearch|filter|sort|toolbar|actions?|controls?\b/.test(semanticText)
    const hasMultipleControlKinds = new Set(controls.map((control) => getInteractiveControlType(control))).size >= 2

    return hasKeyword || hasMultipleControlKinds
  })

  const accepted: Array<{ root: Element; controls: HTMLElement[] }> = []
  const candidates = uniqueElements([...strongRoots, ...inferredRoots])
    .map((root) => ({ root, controls: getInteractiveControls(root) }))
    .filter(({ controls }) => controls.length > 0)
    .sort((left, right) => left.controls.length - right.controls.length)

  for (const candidate of candidates) {
    const overlaps = accepted.some((acceptedCandidate) =>
      candidate.controls.some((control) => acceptedCandidate.controls.includes(control))
    )
    if (overlaps) {
      continue
    }

    accepted.push(candidate)
  }

  return accepted.map((candidate) => candidate.root)
}

function buildInteractiveRegion(regionId: string, root: Element, subtype: string): {
  region: SemanticRegion
  blueprints: NodeBlueprint[]
} {
  const controls = getInteractiveControls(root)
  const category = interactiveCategoryForSubtype(subtype)
  const regionLabel = describeRegionLabel("interactive-block", subtype)
  const rootAction = rootActionForSubtype(subtype)
  const rootNodeId = `${regionId}-cluster`
  const nodes: InteractiveNode[] = [
    {
      kind: "interactive",
      id: rootNodeId,
      controlType: "group",
      label: regionLabel,
      action: rootAction,
      metadata: {
        controlCount: String(controls.length),
        subtype
      }
    }
  ]
  const blueprints: NodeBlueprint[] = [
    {
      nodeId: rootNodeId,
      element: root,
      kind: "interactive",
      scopeRootId: rootNodeId,
      displayLabel: regionLabel,
      category,
      textPreview: regionLabel
    }
  ]

  controls.forEach((control, index) => {
    const label = resolveControlLabel(control, root)
    const node = sanitizeInteractiveNode({
      kind: "interactive",
      id: `${regionId}-control-${index + 1}`,
      controlType: getInteractiveControlType(control),
      ...(label ? { label } : {}),
      ...(control.getAttribute("role") ? { role: control.getAttribute("role")! } : {}),
      action: resolveInteractiveAction(control, subtype),
      ...(resolveInteractiveState(control) ? { state: resolveInteractiveState(control)! } : {}),
      ...(control.tagName.toLowerCase() === "select"
        ? { options: Array.from((control as HTMLSelectElement).options).map((option) => normalizeText(option.text)) }
        : {}),
      parentId: rootNodeId,
      metadata: buildInteractiveMetadata(control)
    })

    const labelText = node.label ?? regionLabel
    nodes.push(node)
    blueprints.push({
      nodeId: node.id,
      element: control,
      kind: "interactive",
      scopeRootId: rootNodeId,
      displayLabel: labelText,
      category,
      textPreview: node.valuePreview ?? labelText
    })
  })

  return {
    region: {
      id: regionId,
      kind: "interactive-block",
      primitive: "interactive-block",
      subtype,
      category,
      displayLabel: regionLabel,
      nodes,
      structure: {
        type: "sequence",
        rootIds: [rootNodeId]
      }
    },
    blueprints
  }
}

class InteractiveBlockRecognizer implements GenericRecognizer {
  readonly primitive = "interactive-block" as const

  detectDetailed(document: Document): DetectedRegion[] {
    return collectInteractiveRoots(document).flatMap((element, index) => {
      const controls = getInteractiveControls(element)
      if (controls.length === 0) {
        return []
      }

      const subtype = resolveInteractiveSubtype(element, controls)
      const regionId = buildRegionId(this.primitive, index)
      const { region, blueprints } = buildInteractiveRegion(regionId, element, subtype)
      if (region.nodes.length <= 1) {
        return []
      }

      return {
        id: regionId,
        element,
        primitive: this.primitive,
        confidence: element.matches("form,[role='search'],[role='toolbar'],[role='tablist']") ? 0.9 : 0.78,
        signals: [subtype === "search" ? "search-controls" : "interactive-controls"],
        subtype,
        category: region.category,
        kind: region.kind,
        displayLabel: region.displayLabel ?? "Form",
        nodeBlueprints: blueprints,
        ...(region.structure ? { structure: region.structure } : {})
      } satisfies DetectedRegion
    })
  }

  extractDetailed(region: DetectedRegion, _document: Document): SemanticRegion {
    const root = region.element
    if (!root) {
      return {
        id: region.id,
        kind: region.kind,
        primitive: region.primitive,
        ...(region.subtype ? { subtype: region.subtype } : {}),
        category: region.category,
        nodes: []
      }
    }

    const { region: interactiveRegion, blueprints } = buildInteractiveRegion(region.id, root, region.subtype ?? "form")
    annotateRegionNodes({
      id: region.id,
      element: root,
      primitive: this.primitive,
      confidence: 1,
      signals: [],
      ...(region.subtype ? { subtype: region.subtype } : {}),
      category: interactiveRegion.category,
      kind: interactiveRegion.kind,
      displayLabel: interactiveRegion.displayLabel ?? "Form",
      nodeBlueprints: blueprints,
      ...(interactiveRegion.structure ? { structure: interactiveRegion.structure } : {})
    })
    return interactiveRegion
  }
}

function compareRegionPriority(left: DetectedRegion, right: DetectedRegion): number {
  if (right.confidence !== left.confidence) {
    return right.confidence - left.confidence
  }

  const leftArea = left.element.getBoundingClientRect().width * left.element.getBoundingClientRect().height
  const rightArea = right.element.getBoundingClientRect().width * right.element.getBoundingClientRect().height
  if (leftArea !== rightArea) {
    return leftArea - rightArea
  }

  const position = left.element.compareDocumentPosition(right.element)
  if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
    return -1
  }
  if (position & Node.DOCUMENT_POSITION_PRECEDING) {
    return 1
  }
  return 0
}

export function dedupeRegions(regions: DetectedRegion[]): DetectedRegion[] {
  const accepted: DetectedRegion[] = []

  for (const region of [...regions].sort(compareRegionPriority)) {
    const duplicate = accepted.find((acceptedRegion) => acceptedRegion.element === region.element)
    if (duplicate) {
      continue
    }
    accepted.push(region)
  }

  return accepted
}

export function assignContainment(regions: DetectedRegion[]): void {
  for (const region of regions) {
    const parent = regions
      .filter((candidate) => candidate !== region && candidate.element.contains(region.element))
      .sort((left, right) => {
        const leftContainsRight = left.element.contains(right.element)
        const rightContainsLeft = right.element.contains(left.element)
        if (leftContainsRight && !rightContainsLeft) {
          return 1
        }
        if (rightContainsLeft && !leftContainsRight) {
          return -1
        }
        return 0
      })[0]

    if (parent) {
      region.parentId = parent.id
    }
  }
}

export function createDefaultRecognizers(): GenericRecognizer[] {
  return [
    new AuthoredBlockRecognizer(),
    new NavigationClusterRecognizer(),
    new RepeatedItemRecognizer(),
    new InteractiveBlockRecognizer()
  ]
}
