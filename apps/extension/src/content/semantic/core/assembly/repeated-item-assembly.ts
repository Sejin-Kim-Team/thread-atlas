import { normalizeText, extractReadableText } from "../../text"
import type { AssembledItem, AssembledRegion, DetectedRegion, NodeBlueprint, SelectableNodeKind } from "../types"

const TITLE_SELECTOR = "h1,h2,h3,h4,h5,h6,[role='heading'],a,strong,.titleline"
const AUTHOR_SELECTOR = "[rel='author'],[itemprop*='author' i],[class*='author' i],[class*='user' i]"
const TIMESTAMP_SELECTOR = "time,[datetime],[class*='time' i],[class*='date' i],[class*='age' i]"

function textForElement(element: Element): string {
  return normalizeText(extractReadableText(element, { preserveLineBreaks: true }))
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

function buildScopeRootId(regionId: string): string {
  return `${regionId}-scope-root`
}

function elementSignature(element: Element): string {
  const classes = [...element.classList].slice(0, 3).sort().join(".")
  const childTags = Array.from(element.children)
    .slice(0, 4)
    .map((child) => child.tagName.toLowerCase())
    .join("/")

  return [element.tagName.toLowerCase(), classes, childTags].join("|")
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

function findTitleElement(root: Element): Element {
  return (
    root.querySelector(TITLE_SELECTOR) ??
    root.querySelector("a[href]") ??
    root
  )
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

function classifyLinkRole(link: HTMLAnchorElement, isMetadataContext: boolean): "primary" | "discussion" | null {
  const text = normalizeText(link.textContent ?? "").toLowerCase()
  const href = link.href.toLowerCase()

  if (/\b(reply|replies|comment|comments|discuss|discussion)\b/.test(text)) {
    return "discussion"
  }
  if (/item\?id=|\/comments\b|#comments\b/.test(href)) {
    return "discussion"
  }
  if (isMetadataContext && /\bhide|past|favorite|reply\b/.test(text)) {
    return "discussion"
  }
  if (link.closest("h1,h2,h3,h4,h5,h6,.titleline")) {
    return "primary"
  }
  if (!isMetadataContext && text.length >= 8) {
    return "primary"
  }

  return null
}

function classifyLinks(primaryElement: Element, companions: Element[]): { primary?: string; discussion?: string } {
  const groups = [
    { element: primaryElement, isMetadata: false },
    ...companions.map((element) => ({ element, isMetadata: true }))
  ]

  let primary: string | undefined
  let discussion: string | undefined

  for (const group of groups) {
    const links = Array.from(group.element.querySelectorAll<HTMLAnchorElement>("a[href]"))
    for (const link of links) {
      const role = classifyLinkRole(link, group.isMetadata)
      if (role === "discussion" && !discussion) {
        discussion = link.href
      } else if (role === "primary" && !primary) {
        primary = link.href
      }
    }
  }

  if (!primary) {
    const fallback = primaryElement.querySelector<HTMLAnchorElement>("a[href]") ?? companions[0]?.querySelector<HTMLAnchorElement>("a[href]")
    primary = fallback?.href
  }

  return {
    ...(primary ? { primary } : {}),
    ...(discussion ? { discussion } : {})
  }
}

function parseMetadata(elements: Element[]): AssembledItem["metadata"] | undefined {
  const text = normalizeText(elements.map((element) => element.textContent ?? "").join(" "))
  if (!text) {
    return undefined
  }

  const metadata: NonNullable<AssembledItem["metadata"]> = {}
  const score = text.match(/(\d+)\s+points?/i)?.[1]
  const commentCount = text.match(/(\d+)\s+comments?/i)?.[1]
  const authorMatch = text.match(/\bby\s+([a-z0-9_-]+)/i)?.[1]
  const timestampMatch = text.match(/\b(\d+\s+(?:minute|minutes|hour|hours|day|days)\s+ago|just now)\b/i)?.[1]

  const author = elements.map(findAuthor).find(Boolean)
  const timestamp = elements.map(findTimestamp).find(Boolean)

  if (score) {
    metadata.score = score
  }
  if (commentCount) {
    metadata.commentCount = commentCount
  }
  const resolvedAuthor = author ?? authorMatch
  if (resolvedAuthor) {
    metadata.author = resolvedAuthor
  }
  const resolvedTimestamp = timestamp ?? timestampMatch
  if (resolvedTimestamp) {
    metadata.timestamp = resolvedTimestamp
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined
}

function isSpacerRow(element: Element): boolean {
  const text = normalizeText(element.textContent ?? "")
  return text.length === 0 || /\bspacer\b/.test(`${element.className} ${element.id}`.toLowerCase())
}

function isMetadataCompanionRow(element: Element): boolean {
  const text = normalizeText(element.textContent ?? "")
  if (!text) {
    return false
  }

  return Boolean(
    element.querySelector(".subtext,.score,.age,time,[class*='subtext'],[class*='meta'],[class*='age']") ||
      element.querySelector("a[href*='item?id=']") ||
      /\bpoints?\b|\bcomments?\b|\bago\b|\bby\b/.test(text.toLowerCase())
  )
}

function createBlueprints(
  item: AssembledItem,
  category: DetectedRegion["category"],
  fallbackLabel: string
): NodeBlueprint[] {
  const primaryFocusElement =
    item.element.querySelector(".titleline,.subtext,[class*='title'],[class*='subtext']") ??
    item.element.querySelector("a[href]") ??
    item.element.querySelector("span,strong") ??
    item.element.querySelector("td,div,p") ??
    item.primaryElement
  const companionFocusElements = item.companions.map((element) =>
    element.querySelector(".subtext,.meta,.byline,.info,[class*='subtext'],[class*='meta'],span") ??
    element.querySelector("a[href]") ??
    element.querySelector("p,div,strong,td") ??
    element
  )

  return uniqueElements([item.element, primaryFocusElement, item.primaryElement, ...item.companions, ...companionFocusElements]).map((element) => ({
    nodeId: item.nodeId,
    element,
    kind: item.kind,
    scopeRootId: item.scopeRootId,
    displayLabel: item.displayLabel || fallbackLabel,
    category: item.category ?? category,
    ...(item.textPreview ? { textPreview: item.textPreview } : {})
  }))
}

function assembleFlatOrGridItems(region: DetectedRegion): AssembledItem[] {
  const items = region.itemElements ?? []
  const itemSet = new Set(items)
  const isTableRows = items.length >= 3 && items.every((item) => item.tagName.toLowerCase() === "tr")
  const fallbackLabel = region.subtype === "grid" ? "Result card" : "Feed item"
  const familySignature = items[0] ? elementSignature(items[0]) : ""

  return items.map((element, index) => {
    const companions: Element[] = []

    if (isTableRows) {
      let current = element.nextElementSibling
      while (current && !itemSet.has(current)) {
        if (isSpacerRow(current)) {
          current = current.nextElementSibling
          continue
        }

        if (isMetadataCompanionRow(current) && companions.length === 0) {
          companions.push(current)
          current = current.nextElementSibling
          continue
        }

        break
      }

    }

    const primaryElement = findTitleElement(element)
    const metadataElements = [element, ...companions]
    const title = normalizeText(primaryElement.textContent ?? "")
    const signature = elementSignature(element)

    return {
      nodeId: `${region.id}-item-${index + 1}`,
      element,
      primaryElement,
      kind: "content" as SelectableNodeKind,
      companions,
      links: classifyLinks(primaryElement, companions),
      ...(parseMetadata(metadataElements) ? { metadata: parseMetadata(metadataElements)! } : {}),
      scopeRootId: buildScopeRootId(region.id),
      displayLabel: fallbackLabel,
      category: region.category,
      textPreview: title || textForElement(primaryElement),
      ...(familySignature && signatureSimilarity(familySignature, signature) >= 0.7
        ? {}
        : {})
    }
  })
}

export class RepeatedItemAssembler {
  assembleDetailed(region: DetectedRegion): { region: AssembledRegion; decisions: string[] } {
    const decisions: string[] = []

    if (region.primitive !== "repeated-item") {
      return { region, decisions }
    }

    if (region.subtype === "nested") {
      return { region, decisions }
    }

    const assembledItems = assembleFlatOrGridItems(region)
    if (assembledItems.length === 0) {
      return { region, decisions }
    }

    for (const item of assembledItems) {
      if (item.companions.length > 0) {
        decisions.push(
          `merged ${item.nodeId} into one semantic item with ${item.companions.length} companion row(s)`
        )
      }
    }

    const fallbackLabel = region.subtype === "grid" ? "Result card" : "Feed item"
    const nodeBlueprints = assembledItems.flatMap((item) =>
      createBlueprints(item, region.category, fallbackLabel)
    )

    return {
      region: {
        ...region,
        assembledItems,
        nodeBlueprints
      },
      decisions
    }
  }

  assemble(region: DetectedRegion): AssembledRegion {
    return this.assembleDetailed(region).region
  }
}
