import type {
  ContextPack,
  SemanticSnapshot
} from "./types"

type ContextPackNode = ContextPack["groups"]["ancestors"][number]
type SnapshotNode = SemanticSnapshot["focus"]["node"]

function isCommentNode(node: SnapshotNode): node is Extract<SnapshotNode, { kind: "comment" }> {
  return node.kind === "comment"
}

function isInteractiveNode(node: SnapshotNode): node is Extract<SnapshotNode, { kind: "interactive" }> {
  return node.kind === "interactive"
}

function toContextPackNode(
  node: SnapshotNode,
  relation: ContextPackNode["relation"],
  distance: number
): ContextPackNode {
  if (isCommentNode(node)) {
    return {
      id: node.id,
      kind: "comment",
      relation,
      distance,
      text: node.text,
      ...(node.author ? { author: node.author } : {}),
      ...(node.timestamp ? { timestamp: node.timestamp } : {}),
      depth: node.depth,
      ...(node.parentId ? { parentId: node.parentId } : {}),
      ...(node.metadata ? { metadata: node.metadata } : {})
    }
  }

  if (isInteractiveNode(node)) {
    return {
      id: node.id,
      kind: "interactive",
      relation,
      distance,
      text: node.label ?? node.valuePreview ?? "",
      controlType: node.controlType,
      ...(node.action ? { action: node.action } : {}),
      ...(node.state ? { state: node.state } : {}),
      ...(node.role ? { role: node.role } : {}),
      ...(node.valuePreview ? { valuePreview: node.valuePreview } : {}),
      ...(node.label ? { label: node.label } : {}),
      ...(node.parentId ? { parentId: node.parentId } : {}),
      ...(node.metadata ? { metadata: node.metadata } : {})
    }
  }

  return {
    id: node.id,
    kind: "content",
    relation,
    distance,
    text: node.text,
    contentType: node.type,
    ...(node.level ? { level: node.level } : {}),
    ...(node.parentId ? { parentId: node.parentId } : {}),
    ...(node.attributes ? { metadata: node.attributes } : {})
  }
}

function buildScope(snapshot: SemanticSnapshot): ContextPack["scope"] {
  const coverage = snapshot.meta.coverage
  return {
    kind: coverage?.kind ?? (snapshot.focus.node.kind === "comment" ? "focus-branch" : "focus-section"),
    rootNodeId: coverage?.rootNodeId ?? snapshot.focus.nodeId,
    focusNodeId: snapshot.focus.nodeId
  }
}

function buildOmitted(snapshot: SemanticSnapshot): ContextPack["omitted"] {
  const coverage = snapshot.meta.coverage
  if (!coverage) {
    return {
      nodeCount: 0,
      rootCount: 0,
      note: "Coverage metadata unavailable."
    }
  }

  return {
    nodeCount: coverage.omittedNodeCount,
    rootCount: coverage.omittedRootCount,
    note: `Only the ${coverage.kind} semantic scope is included.`
  }
}

function mapRelation(
  snapshot: SemanticSnapshot,
  relation: "parent" | "ancestor" | "child" | "sibling" | "container",
  mappedRelation: ContextPackNode["relation"]
): Array<ContextPackNode & { originalIndex: number }> {
  return snapshot.context
    .map((slice, originalIndex) => ({
      slice,
      originalIndex
    }))
    .filter((entry) => entry.slice.relation === relation)
    .map(({ slice, originalIndex }) => ({
      ...toContextPackNode(slice.node, mappedRelation, slice.distance),
      originalIndex
    }))
}

function sortByOriginal(nodes: Array<ContextPackNode & { originalIndex: number }>): ContextPackNode[] {
  return nodes
    .sort((a, b) => a.originalIndex - b.originalIndex)
    .map(({ originalIndex: _ignored, ...node }) => node)
}

export function buildCanonicalContextPack(snapshot: SemanticSnapshot): ContextPack {
  // shared 입력 계약을 기준으로 canonical pack을 구성한다.
  const ancestors = [
    ...mapRelation(snapshot, "parent", "ancestor"),
    ...mapRelation(snapshot, "ancestor", "ancestor")
  ].sort((a, b) => b.distance - a.distance || a.originalIndex - b.originalIndex)

  return {
    version: 1,
    scope: buildScope(snapshot),
    page: {
      id: snapshot.page.id,
      url: snapshot.page.url,
      ...(snapshot.page.title ? { title: snapshot.page.title } : {}),
      kind: snapshot.page.kind,
      ...(snapshot.page.metadata ? { metadata: snapshot.page.metadata } : {})
    },
    focus: toContextPackNode(snapshot.focus.node, "focus", 0),
    groups: {
      ancestors: sortByOriginal(ancestors),
      descendants: sortByOriginal(mapRelation(snapshot, "child", "descendant")),
      siblings: sortByOriginal(mapRelation(snapshot, "sibling", "sibling")),
      containers: sortByOriginal(mapRelation(snapshot, "container", "container"))
    },
    omitted: buildOmitted(snapshot),
    provenance: {
      extractorId: snapshot.meta.extractorId,
      capturedAt: snapshot.meta.capturedAt,
      skeletonVersion: snapshot.meta.skeletonVersion
    }
  }
}
