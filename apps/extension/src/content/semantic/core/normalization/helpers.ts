import type { SemanticRegion } from "@threadatlas/shared/browser-runtime"
import type { ContentNode, SemanticNode } from "@threadatlas/shared"
import type { RoledRegion } from "../types"

export function buildRegionNodeElementMap(region: RoledRegion): Map<string, Element[]> {
  const nodeMap = new Map<string, Element[]>()

  for (const blueprint of region.nodeBlueprints) {
    const elements = nodeMap.get(blueprint.nodeId) ?? []
    if (!elements.includes(blueprint.element)) {
      elements.push(blueprint.element)
    }
    nodeMap.set(blueprint.nodeId, elements)
  }

  return nodeMap
}

export function rebuildStructure(region: SemanticRegion): NonNullable<SemanticRegion["structure"]> {
  if (region.structure?.type === "tree") {
    return {
      type: "tree",
      rootIds: region.nodes.filter((node) => !node.parentId).map((node) => node.id)
    }
  }

  if (region.structure?.type === "flat") {
    return {
      type: "flat",
      rootIds: region.nodes.map((node) => node.id)
    }
  }

  return {
    type: "sequence",
    rootIds: region.nodes.filter((node) => !node.parentId).map((node) => node.id)
  }
}

export function normalizeParentLinks(nodes: SemanticNode[]): SemanticNode[] {
  const nodeIds = new Set(nodes.map((node) => node.id))

  return nodes.map((node) => {
    if (!node.parentId || nodeIds.has(node.parentId)) {
      return node
    }

    const nextNode = { ...node }
    delete nextNode.parentId
    return nextNode
  })
}

export function filterRegionNodes(region: SemanticRegion, keepIds: Set<string>): SemanticRegion {
  const filtered = region.nodes.filter((node) => keepIds.has(node.id))
  const normalized = normalizeParentLinks(filtered)
  return {
    ...region,
    nodes: normalized,
    structure: rebuildStructure({
      ...region,
      nodes: normalized
    })
  }
}

export function applyHeadingHierarchyToContentNodes(nodes: ContentNode[]): ContentNode[] {
  const stack: Array<{ id: string; level: number }> = []

  return nodes.map((node) => {
    const nextNode: ContentNode = { ...node }

    if (nextNode.type === "heading" && nextNode.level) {
      while (stack.length > 0 && stack[stack.length - 1]!.level >= nextNode.level) {
        stack.pop()
      }

      if (stack.length > 0) {
        nextNode.parentId = stack[stack.length - 1]!.id
      } else {
        delete nextNode.parentId
      }

      stack.push({
        id: nextNode.id,
        level: nextNode.level
      })
      return nextNode
    }

    if (stack.length > 0) {
      nextNode.parentId = stack[stack.length - 1]!.id
    } else {
      delete nextNode.parentId
    }

    return nextNode
  })
}

export function textForElements(elements: Element[]): string {
  return elements
    .map((element) => element.textContent ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
}
