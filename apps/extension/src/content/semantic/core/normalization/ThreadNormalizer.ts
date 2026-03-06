import type { SemanticRegion } from "@threadatlas/shared/browser-runtime"
import type { CommentNode } from "@threadatlas/shared"
import type { RoledRegion, ThreadExplicitHint, ThreadMetadata } from "../types"
import type { NormalizationResult, SemanticNormalizer } from "./types"
import { buildRegionNodeElementMap, rebuildStructure, textForElements } from "./helpers"

const COLLAPSED_BRANCH_PATTERN = /\[\s*\d+\s+more\s*\]|show more|more replies|collapsed/i
const REPLY_PATTERN = /\breply\b/i
const EXPLICIT_HINT_PATTERN = /\b(parent|root|next|prev)\b/i

function resolveHintTarget(href: string | undefined, nodes: CommentNode[]): string | undefined {
  if (!href) {
    return undefined
  }

  const parsed = (() => {
    try {
      return new URL(href, "https://news.ycombinator.com")
    } catch {
      return null
    }
  })()

  const fragment = parsed?.hash ? parsed.hash.slice(1) : ""
  const idParam = parsed?.searchParams.get("id") ?? ""

  return nodes.find((node) => {
    const sourceId = node.metadata?.sourceElementId
    return Boolean(sourceId && (sourceId === fragment || sourceId === idParam))
  })?.id
}

function collectThreadMetadata(region: RoledRegion, nodes: CommentNode[]): ThreadMetadata {
  const nodeElementMap = buildRegionNodeElementMap(region)
  const collapsedBranchIds = new Set<string>()
  const explicitHints: ThreadExplicitHint[] = []
  let hasReplyAffordance = false

  for (const node of nodes) {
    const elements = nodeElementMap.get(node.id) ?? []
    const rowText = textForElements(elements)
    if (COLLAPSED_BRANCH_PATTERN.test(rowText)) {
      collapsedBranchIds.add(node.id)
    }
    if (REPLY_PATTERN.test(rowText)) {
      hasReplyAffordance = true
    }

    const links = elements.flatMap((element) => Array.from(element.querySelectorAll<HTMLAnchorElement>("a[href]")))
    for (const link of links) {
      const text = (link.textContent ?? "").trim().toLowerCase()
      const kind = text.match(EXPLICIT_HINT_PATTERN)?.[1] as ThreadExplicitHint["kind"] | undefined
      if (!kind) {
        continue
      }

      const targetNodeId = resolveHintTarget(link.getAttribute("href") ?? link.href, nodes)

      const hint: ThreadExplicitHint = {
        nodeId: node.id,
        kind,
        href: link.getAttribute("href") ?? link.href
      }
      if (targetNodeId) {
        hint.targetNodeId = targetNodeId
      }

      explicitHints.push(hint)
    }
  }

  return {
    kind: "thread",
    hasCollapsedBranches: collapsedBranchIds.size > 0,
    collapsedBranchIds: [...collapsedBranchIds],
    explicitHints,
    hasReplyAffordance
  }
}

function applyExplicitThreadHints(region: SemanticRegion, metadata: ThreadMetadata): SemanticRegion {
  const nodes = region.nodes.map((node) => ({ ...node })) as CommentNode[]
  const byId = new Map(nodes.map((node) => [node.id, node]))

  for (const hint of metadata.explicitHints) {
    const node = byId.get(hint.nodeId)
    if (!node || !hint.targetNodeId) {
      continue
    }

    if (hint.kind === "parent") {
      node.parentId = hint.targetNodeId
      const parent = byId.get(hint.targetNodeId)
      if (parent) {
        node.depth = parent.depth + 1
      }
    }

    if (hint.kind === "root") {
      if (!node.parentId) {
        node.parentId = hint.targetNodeId
        const parent = byId.get(hint.targetNodeId)
        if (parent) {
          node.depth = parent.depth + 1
        }
      }
    }
  }

  const corrected = {
    ...region,
    nodes,
    structure: rebuildStructure({
      ...region,
      nodes
    })
  }

  return corrected
}

export class ThreadNormalizer implements SemanticNormalizer<ThreadMetadata> {
  canNormalize(region: RoledRegion): boolean {
    return (
      region.primitive === "repeated-item" &&
      region.subtype === "nested" &&
      region.layoutRole === "main-content"
    )
  }

  normalize(input: {
    region: RoledRegion
    semanticRegion: SemanticRegion
    ast: unknown[]
    document: Document
  }): NormalizationResult<ThreadMetadata> {
    const commentNodes = input.semanticRegion.nodes.filter((node): node is CommentNode => node.kind === "comment")
    const metadata = collectThreadMetadata(input.region, commentNodes)
    const correctedRegion = applyExplicitThreadHints(input.semanticRegion, metadata)

    return {
      region: correctedRegion,
      metadata
    }
  }
}
