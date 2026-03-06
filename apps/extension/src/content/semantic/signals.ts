import type { SemanticCategory } from "@threadatlas/shared"

export type SignalStrength = "strong" | "medium" | "weak"

export interface SemanticSignal {
  element: Element
  type:
    | "html5-semantic"
    | "aria-landmark"
    | "repeated-structure"
    | "density-boundary"
    | "heading-section"
    | "semantic-keyword"
  strength: SignalStrength
  suggestedCategory: SemanticCategory
  confidence: number
}

export interface StructuralSignal {
  type:
    | "semantic-element"
    | "aria-landmark"
    | "repetition"
    | "depth-change"
    | "heading-boundary"
    | "class-hint"
  strength: SignalStrength
  detail: string
}

export interface RegionCandidate {
  id: string
  kind: string
  element: Element
  signals: StructuralSignal[]
  score: number
  itemElements?: Element[]
}

function signatureForElement(element: Element): string {
  const classes = [...element.classList].sort().join(".")
  const role = element.getAttribute("role")
  const childSignature = Array.from(element.children)
    .map((child) => {
      const childClasses = [...child.classList].slice(0, 2).sort().join(".")
      const attrNames = [...child.attributes].map((attribute) => attribute.name).slice(0, 3).sort().join(",")
      return [child.tagName.toLowerCase(), childClasses, attrNames].join(":")
    })
    .join("/")
  const depthHint = element.querySelector("[indent],[data-depth],[aria-level]") ? "depth" : ""

  return [element.tagName.toLowerCase(), classes, role ?? "", String(element.children.length), childSignature, depthHint].join("|")
}

function scoreSignal(strength: SignalStrength): number {
  switch (strength) {
    case "strong":
      return 5
    case "medium":
      return 3
    case "weak":
      return 1
  }
}

function scoreCandidate(signals: StructuralSignal[]): number {
  return signals.reduce((total, signal) => total + scoreSignal(signal.strength), 0)
}

function inferCategoryFromElement(element: Element): SemanticCategory {
  const tag = element.tagName.toLowerCase()
  const role = element.getAttribute("role")
  const semanticText = `${tag} ${role ?? ""} ${element.id} ${element.className}`.toLowerCase()

  if (semanticText.includes("comment") || semanticText.includes("thread")) {
    return "discussion.thread"
  }
  if (role === "navigation" || tag === "nav") {
    return "navigation.menu"
  }
  return "content.article"
}

function candidateToSemanticSignals(candidate: RegionCandidate): SemanticSignal[] {
  return candidate.signals.map((signal) => {
    const suggestedCategory =
      signal.type === "depth-change" || signal.type === "repetition"
        ? "discussion.thread"
        : inferCategoryFromElement(candidate.element)

    return {
      element: candidate.element,
      type:
        signal.type === "semantic-element"
          ? "html5-semantic"
          : signal.type === "repetition"
            ? "repeated-structure"
            : signal.type === "depth-change"
              ? "density-boundary"
              : signal.type === "heading-boundary"
                ? "heading-section"
                : signal.type === "class-hint"
                  ? "semantic-keyword"
                  : "aria-landmark",
      strength: signal.strength,
      suggestedCategory,
      confidence: Math.min(1, scoreSignal(signal.strength) / 5)
    }
  })
}

export class SignalDetector {
  detect(root: Element): SemanticSignal[] {
    const document = root.ownerDocument
    if (!document) {
      return []
    }

    const candidates = [
      ...detectSemanticElementCandidates(document),
      ...detectRepeatedStructureCandidates(document),
      ...detectHeadingClusterCandidates(document)
    ]

    return candidates
      .filter((candidate) => root === document.body || root.contains(candidate.element) || root === candidate.element)
      .flatMap(candidateToSemanticSignals)
  }
}

export function detectSemanticElementCandidates(document: Document): RegionCandidate[] {
  const elements = Array.from(
    document.querySelectorAll(
      "article,main,nav,aside,section,header,footer,[role='main'],[role='navigation'],[role='complementary'],[role='contentinfo']"
    )
  )

  return elements.map((element, index) => {
    const isRole = element.hasAttribute("role")
    const signals: StructuralSignal[] = [
      {
        type: isRole ? "aria-landmark" : "semantic-element",
        strength: "strong",
        detail: isRole ? element.getAttribute("role") ?? "" : element.tagName.toLowerCase()
      }
    ]

    return {
      id: `semantic-${index + 1}`,
      kind: element.tagName.toLowerCase(),
      element,
      signals,
      score: scoreCandidate(signals)
    }
  })
}

export function detectRepeatedStructureCandidates(document: Document): RegionCandidate[] {
  const candidates: RegionCandidate[] = []
  let candidateIndex = 0

  for (const parent of Array.from(document.querySelectorAll("*"))) {
    const children = Array.from(parent.children)
    if (children.length < 3) {
      continue
    }

    const grouped = new Map<string, Element[]>()
    for (const child of children) {
      const signature = signatureForElement(child)
      grouped.set(signature, [...(grouped.get(signature) ?? []), child])
    }

    for (const [signature, items] of grouped) {
      if (items.length < 3) {
        continue
      }

      const signals: StructuralSignal[] = [
        {
          type: "repetition",
          strength: "medium",
          detail: signature
        }
      ]

      const hasDepthChange = new Set(
        items
          .map((item) => item.getAttribute("indent"))
          .filter((value): value is string => Boolean(value))
      ).size > 1

      if (hasDepthChange) {
        signals.push({
          type: "depth-change",
          strength: "medium",
          detail: "indent-variation"
        })
      }

      const classHint = items.some((item) =>
        /comment|reply|thread|post|article|content/i.test(`${item.id} ${item.className}`)
      )
      if (classHint) {
        signals.push({
          type: "class-hint",
          strength: "weak",
          detail: "semantic-keyword"
        })
      }

      candidateIndex += 1
      candidates.push({
        id: `repeat-${candidateIndex}`,
        kind: hasDepthChange ? "thread" : "list",
        element: parent,
        itemElements: items,
        signals,
        score: scoreCandidate(signals)
      })
    }
  }

  return candidates.sort((left, right) => right.score - left.score)
}

export function detectHeadingClusterCandidates(document: Document): RegionCandidate[] {
  const headingLikeElements = Array.from(
    document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role='heading'],.titleline")
  )

  return headingLikeElements.map((element, index) => {
    const container = element.closest("article,main,section,table,tbody,div") ?? element
    const signals: StructuralSignal[] = [
      {
        type: "heading-boundary",
        strength: element.matches(".titleline") ? "medium" : "strong",
        detail: element.tagName.toLowerCase()
      }
    ]

    if (/title|story|content|article/i.test(`${container.id} ${container.className}`)) {
      signals.push({
        type: "class-hint",
        strength: "weak",
        detail: "heading-container"
      })
    }

    return {
      id: `heading-${index + 1}`,
      kind: "content",
      element: container,
      signals,
      score: scoreCandidate(signals)
    }
  })
}
