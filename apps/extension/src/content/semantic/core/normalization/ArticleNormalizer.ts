import { normalizeText } from "../../text"
import type { SemanticRegion } from "@threadatlas/shared/browser-runtime"
import type { ContentNode } from "@threadatlas/shared"
import type { ArticleMetadata, ArticleSectionMetadata, RoledRegion } from "../types"
import type { NormalizationResult, SemanticNormalizer } from "./types"
import { applyHeadingHierarchyToContentNodes, filterRegionNodes } from "./helpers"

const RELATED_LABEL_PATTERN = /\brelated|see also|more|further reading\b/i

function splitNodeEntries(node: ContentNode): string[] {
  const newlineEntries = node.text
    .split(/\n+/)
    .map((part) => normalizeText(part))
    .filter(Boolean)

  if (newlineEntries.length > 1) {
    return newlineEntries
  }

  if (
    newlineEntries[0] &&
    newlineEntries[0].length <= 64 &&
    node.type !== "heading" &&
    !/[.!?:]/.test(newlineEntries[0])
  ) {
    const tokenEntries = newlineEntries[0]
      .split(/\s+/)
      .map((part) => normalizeText(part))
      .filter(Boolean)

    if (tokenEntries.length >= 2 && tokenEntries.length <= 8) {
      return tokenEntries
    }
  }

  return newlineEntries
}

function collectFilteredNodeIds(nodes: ContentNode[]): {
  excludedNodeIds: Set<string>
  tags: string[]
  separatedNavigation: string[]
} {
  const excludedNodeIds = new Set<string>()
  const tags = new Set<string>()
  const separatedNavigation = new Set<string>()

  for (const [index, node] of nodes.entries()) {
    const entries = splitNodeEntries(node)
    const previousNode = nodes[index - 1]

    if (
      (node.type === "list" || node.type === "link") &&
      previousNode?.type === "heading" &&
      RELATED_LABEL_PATTERN.test(previousNode.text)
    ) {
      excludedNodeIds.add(previousNode.id)
      excludedNodeIds.add(node.id)
      for (const entry of entries) {
        separatedNavigation.add(entry)
      }
      continue
    }

    if (
      (node.type === "list" || node.type === "link") &&
      entries.length >= 2 &&
      entries.length <= 8 &&
      entries.every((entry) => entry.length <= 24)
    ) {
      excludedNodeIds.add(node.id)
      for (const entry of entries) {
        tags.add(entry)
      }
      continue
    }

    if (node.type === "heading" && RELATED_LABEL_PATTERN.test(node.text)) {
      const nextNode = nodes[index + 1]
      if (nextNode && (nextNode.type === "list" || nextNode.type === "link")) {
        excludedNodeIds.add(node.id)
        excludedNodeIds.add(nextNode.id)
        for (const entry of splitNodeEntries(nextNode)) {
          separatedNavigation.add(entry)
        }
      }
    }
  }

  return {
    excludedNodeIds,
    tags: [...tags],
    separatedNavigation: [...separatedNavigation]
  }
}

function buildArticleSections(nodes: ContentNode[]): ArticleSectionMetadata[] {
  const sections: ArticleSectionMetadata[] = []
  const headingNodes = nodes.filter((node) => node.type === "heading")
  const byId = new Map(nodes.map((node) => [node.id, node]))

  for (const heading of headingNodes) {
    const nodeIds = nodes
      .filter((node) => node.id === heading.id || node.parentId === heading.id)
      .map((node) => node.id)
    sections.push({
      id: heading.id,
      title: heading.text,
      ...(heading.level ? { level: heading.level } : {}),
      ...(heading.parentId ? { parentId: heading.parentId } : {}),
      nodeIds
    })
  }

  if (sections.length === 0 && nodes.length > 0) {
    sections.push({
      id: nodes[0]!.id,
      title: nodes[0]!.text,
      nodeIds: nodes.map((node) => node.id)
    })
  }

  return sections.map((section) => ({
    ...section,
    nodeIds: section.nodeIds.filter((nodeId) => byId.has(nodeId))
  }))
}

export class ArticleNormalizer implements SemanticNormalizer<ArticleMetadata> {
  canNormalize(region: RoledRegion): boolean {
    return region.primitive === "authored-block" && region.layoutRole === "main-content"
  }

  normalize(input: {
    region: RoledRegion
    semanticRegion: SemanticRegion
    ast: unknown[]
    document: Document
  }): NormalizationResult<ArticleMetadata> {
    const baseNodes = input.semanticRegion.nodes.filter((node): node is ContentNode => node.kind === "content")
    const { excludedNodeIds, tags, separatedNavigation } = collectFilteredNodeIds(baseNodes)
    const keepIds = new Set(baseNodes.filter((node) => !excludedNodeIds.has(node.id)).map((node) => node.id))
    const filteredRegion = filterRegionNodes(input.semanticRegion, keepIds)
    const normalizedNodes = applyHeadingHierarchyToContentNodes(
      filteredRegion.nodes.filter((node): node is ContentNode => node.kind === "content")
    )

    const region: SemanticRegion = {
      ...filteredRegion,
      nodes: normalizedNodes,
      structure: {
        type: "sequence",
        rootIds: normalizedNodes.filter((node) => !node.parentId).map((node) => node.id)
      }
    }

    return {
      region,
      metadata: {
        kind: "article",
        sections: buildArticleSections(normalizedNodes),
        tags,
        separatedNavigation
      }
    }
  }
}
