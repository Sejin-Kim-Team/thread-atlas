import type {
  CommentNode,
  ContentNode,
  ContextSlice,
  InteractiveNode,
  SemanticSnapshot
} from "@threadatlas/shared"
import type { SemanticRegion } from "@threadatlas/shared/browser-runtime"

type SemanticNode = ContentNode | CommentNode | InteractiveNode

function isCommentNode(node: SemanticNode): node is CommentNode {
  return node.kind === "comment"
}

function isContentNode(node: SemanticNode): node is ContentNode {
  return node.kind === "content"
}

function buildNodeIndex(nodes: SemanticNode[]): Map<string, SemanticNode> {
  return new Map(nodes.map((node) => [node.id, node]))
}

function buildChildIndex(nodes: SemanticNode[]): Map<string, SemanticNode[]> {
  const index = new Map<string, SemanticNode[]>()
  for (const node of nodes) {
    const { parentId } = node
    if (!parentId) {
      continue
    }
    index.set(parentId, [...(index.get(parentId) ?? []), node])
  }
  return index
}

function findThreadRootId(focusNode: CommentNode, nodeIndex: Map<string, SemanticNode>): string {
  let currentNode: CommentNode = focusNode
  while (currentNode.parentId) {
    const parent = nodeIndex.get(currentNode.parentId)
    if (!parent || !isCommentNode(parent)) {
      break
    }
    currentNode = parent
  }
  return currentNode.id
}

function belongsToScope(node: SemanticNode, rootId: string, nodeIndex: Map<string, SemanticNode>): boolean {
  let current: SemanticNode | undefined = node
  while (current) {
    if (current.id === rootId) {
      return true
    }
    const parentId: string | undefined = current.parentId
    current = parentId ? nodeIndex.get(parentId) : undefined
  }
  return false
}

function distanceToAncestor(node: SemanticNode, ancestorId: string, nodeIndex: Map<string, SemanticNode>): number | null {
  let distance = 0
  let current: SemanticNode | undefined = node

  while (current?.parentId) {
    distance += 1
    if (current.parentId === ancestorId) {
      return distance
    }
    current = nodeIndex.get(current.parentId)
  }

  return null
}

function getContentScopeRoot(
  focusNode: ContentNode | InteractiveNode,
  region: SemanticRegion,
  nodeIndex: Map<string, SemanticNode>
): string {
  if (isContentNode(focusNode) && focusNode.type === "heading") {
    return focusNode.id
  }

  let currentParentId = focusNode.parentId
  let nearestHeading: ContentNode | null = null
  while (currentParentId) {
    const parent = nodeIndex.get(currentParentId)
    if (!parent) {
      break
    }
    if (isContentNode(parent) && parent.type === "heading") {
      nearestHeading = parent
      break
    }
    currentParentId = parent.parentId
  }

  if (nearestHeading) {
    return nearestHeading.id
  }

  let current = focusNode as SemanticNode
  while (current.parentId) {
    const parent = nodeIndex.get(current.parentId)
    if (!parent) {
      break
    }
    current = parent
  }

  if (current.id !== focusNode.id) {
    return current.id
  }

  return region.structure?.rootIds?.[0] ?? focusNode.id
}

function buildAncestorSlices(
  focusNode: SemanticNode,
  rootId: string,
  nodeIndex: Map<string, SemanticNode>
): ContextSlice[] {
  const slices: ContextSlice[] = []
  let distance = 1
  let parentId = focusNode.parentId

  while (parentId) {
    const parent = nodeIndex.get(parentId)
    if (!parent || !belongsToScope(parent, rootId, nodeIndex)) {
      break
    }

    slices.push({
      relation: distance === 1 ? "parent" : "ancestor",
      node: parent,
      distance
    })
    distance += 1
    parentId = parent.parentId
  }

  return slices
}

function buildDescendantSlices(
  focusNode: SemanticNode,
  rootId: string,
  nodes: SemanticNode[],
  nodeIndex: Map<string, SemanticNode>
): ContextSlice[] {
  return nodes
    .filter((node) => node.id !== focusNode.id && belongsToScope(node, rootId, nodeIndex))
    .flatMap((node) => {
      const distance = distanceToAncestor(node, focusNode.id, nodeIndex)
      if (distance === null) {
        return []
      }

      return [{
        relation: "child" as const,
        node,
        distance
      }]
    })
}

function buildSiblingSlices(
  focusNode: SemanticNode,
  rootId: string,
  nodes: SemanticNode[],
  nodeIndex: Map<string, SemanticNode>
): ContextSlice[] {
  const focusParentId = focusNode.parentId
  return nodes
    .filter((node) => node.id !== focusNode.id && belongsToScope(node, rootId, nodeIndex))
    .filter((node) => node.parentId === focusParentId)
    .map((node) => ({
      relation: "sibling" as const,
      node,
      distance: 1
    }))
}

function buildCommentContext(focusRegion: SemanticRegion, focusNode: CommentNode): ContextSlice[] {
  const nodes = focusRegion.nodes.filter(isCommentNode)
  const nodeIndex = buildNodeIndex(nodes)
  const rootId = findThreadRootId(focusNode, nodeIndex)
  return [
    ...buildAncestorSlices(focusNode, rootId, nodeIndex),
    ...buildDescendantSlices(focusNode, rootId, nodes, nodeIndex),
    ...buildSiblingSlices(focusNode, rootId, nodes, nodeIndex)
  ]
}

function buildContentContext(
  focusRegion: SemanticRegion,
  focusNode: ContentNode | InteractiveNode
): ContextSlice[] {
  const nodes = focusRegion.nodes
  const nodeIndex = buildNodeIndex(nodes)
  const childIndex = buildChildIndex(nodes)
  const rootId = getContentScopeRoot(focusNode, focusRegion, nodeIndex)
  const scopeNodes = nodes.filter((node) => belongsToScope(node, rootId, nodeIndex))
  const ancestors = buildAncestorSlices(focusNode, rootId, nodeIndex)
  const isWholeRegionPeerScope =
    (focusRegion.primitive === "repeated-item" && focusRegion.subtype !== "nested") ||
    focusRegion.primitive === "navigation-cluster"

  if (isWholeRegionPeerScope) {
    return nodes
      .filter((node) => node.id !== focusNode.id)
      .map((node) => ({
        relation: "sibling" as const,
        node,
        distance: 1
      }))
  }

  if (isContentNode(focusNode) && focusNode.type === "heading") {
    return [
      ...ancestors,
      ...buildDescendantSlices(focusNode, rootId, scopeNodes, nodeIndex),
      ...buildSiblingSlices(focusNode, rootId, scopeNodes, nodeIndex)
    ]
  }

  if ((childIndex.get(focusNode.id) ?? []).length > 0) {
    return [
      ...ancestors,
      ...buildDescendantSlices(focusNode, rootId, scopeNodes, nodeIndex),
      ...buildSiblingSlices(focusNode, rootId, scopeNodes, nodeIndex)
    ]
  }

  return [
    ...ancestors,
    ...buildSiblingSlices(focusNode, rootId, scopeNodes, nodeIndex)
  ]
}

function buildCommentCoverage(focusRegion: SemanticRegion, focusNode: CommentNode, context: ContextSlice[]) {
  const nodes = focusRegion.nodes.filter(isCommentNode)
  const nodeIndex = buildNodeIndex(nodes)
  const rootNodeId = findThreadRootId(focusNode, nodeIndex)
  const scopedNodes = nodes.filter((node) => belongsToScope(node, rootNodeId, nodeIndex))
  const includedNodeIds = new Set<string>([focusNode.id, ...context.map((slice) => slice.node.id)])

  return {
    kind: "focus-branch" as const,
    rootNodeId,
    capturedNodeCount: includedNodeIds.size,
    omittedNodeCount: scopedNodes.filter((node) => !includedNodeIds.has(node.id)).length,
    omittedRootCount: nodes.filter((node) => !node.parentId && node.id !== rootNodeId).length
  }
}

function buildGenericCoverage(
  focusRegion: SemanticRegion,
  focusNode: ContentNode | InteractiveNode,
  context: ContextSlice[]
) {
  if (
    (focusRegion.primitive === "repeated-item" && focusRegion.subtype !== "nested") ||
    focusRegion.primitive === "navigation-cluster"
  ) {
    const includedNodeIds = new Set<string>([focusNode.id, ...context.map((slice) => slice.node.id)])
    return {
      kind: "focus-section" as const,
      rootNodeId: `${focusRegion.id}-scope-root`,
      capturedNodeCount: includedNodeIds.size,
      omittedNodeCount: focusRegion.nodes.filter((node) => !includedNodeIds.has(node.id)).length,
      omittedRootCount: 0
    }
  }

  const nodeIndex = buildNodeIndex(focusRegion.nodes)
  const rootNodeId = getContentScopeRoot(focusNode, focusRegion, nodeIndex)
  const scopedNodes = focusRegion.nodes.filter((node) => belongsToScope(node, rootNodeId, nodeIndex))
  const includedNodeIds = new Set<string>([focusNode.id, ...context.map((slice) => slice.node.id)])
  const rootIds = focusRegion.structure?.rootIds ?? []
  const siblingRoots = rootIds.filter((id) => id !== rootNodeId)

  return {
    kind: "focus-section" as const,
    rootNodeId,
    capturedNodeCount: includedNodeIds.size,
    omittedNodeCount: scopedNodes.filter((node) => !includedNodeIds.has(node.id)).length,
    omittedRootCount: siblingRoots.length
  }
}

export function findRegionNode(region: SemanticRegion | undefined, nodeId: string): SemanticNode | null {
  return region?.nodes.find((node) => node.id === nodeId) ?? null
}

export function buildContextSlices(args: {
  focusRegion: SemanticRegion
  focusNodeId: string
}): ContextSlice[] {
  const focusNode = findRegionNode(args.focusRegion, args.focusNodeId)
  if (!focusNode) {
    return []
  }

  if (isCommentNode(focusNode)) {
    return buildCommentContext(args.focusRegion, focusNode)
  }

  return buildContentContext(args.focusRegion, focusNode)
}

export function buildSemanticSnapshot(args: {
  page: SemanticSnapshot["page"]
  focusRegion: SemanticRegion
  focusNodeId: string
  extractorId: string
  skeletonVersion: number
}): SemanticSnapshot | null {
  const { page, focusRegion, focusNodeId, extractorId, skeletonVersion } = args
  const focusNode = findRegionNode(focusRegion, focusNodeId)

  if (!focusNode) {
    return null
  }

  const context = buildContextSlices({
    focusRegion,
    focusNodeId
  })

  const coverage = isCommentNode(focusNode)
    ? buildCommentCoverage(focusRegion, focusNode, context)
    : buildGenericCoverage(focusRegion, focusNode, context)

  return {
    page,
    focus: {
      nodeId: focusNodeId,
      node: focusNode,
      region: focusRegion.id
    },
    context,
    meta: {
      capturedAt: new Date().toISOString(),
      skeletonVersion,
      extractorId,
      coverage
    }
  }
}
