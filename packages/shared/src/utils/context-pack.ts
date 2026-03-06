import type {
  ContextPack,
  ContextPackNode,
  ContextPackRelation
} from "../types/context-pack"
import type { ContextTaskProfile } from "../types/context-projection"
import type {
  CommentNode as SnapshotCommentNode,
  ContentNode as SnapshotContentNode,
  InteractiveNode as SnapshotInteractiveNode,
  SemanticSnapshot as Snapshot
} from "../types/semantic-snapshot"

type SnapshotNode = SnapshotContentNode | SnapshotCommentNode | SnapshotInteractiveNode

interface ProjectionView {
  scope: ContextPack["scope"]
  page: Pick<ContextPack["page"], "title" | "url" | "kind">
  focus: Omit<ContextPackNode, "relation" | "distance" | "metadata" | "kind"> & { kind: ContextPackNode["kind"] }
  groups: {
    ancestors: ContextPackNode[]
    descendants: ContextPackNode[]
    siblings: ContextPackNode[]
    containers: ContextPackNode[]
  }
  omitted: ContextPack["omitted"]
  provenance: Pick<ContextPack["provenance"], "extractorId" | "capturedAt">
}

function isCommentNode(node: SnapshotNode): node is SnapshotCommentNode {
  return node.kind === "comment"
}

function isInteractiveNode(node: SnapshotNode): node is SnapshotInteractiveNode {
  return node.kind === "interactive"
}

function toContextPackNode(
  node: SnapshotNode,
  relation: ContextPackRelation,
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

function mapSlices(
  snapshot: Snapshot,
  relation: "parent" | "ancestor" | "child" | "sibling" | "container"
): Array<ContextPackNode & { originalIndex: number }> {
  return snapshot.context
    .map((slice, originalIndex) => ({ slice, originalIndex }))
    .filter(({ slice }) => slice.relation === relation)
    .map(({ slice, originalIndex }) => ({
      ...toContextPackNode(
        slice.node,
        relation === "child"
          ? "descendant"
          : relation === "container"
            ? "container"
            : relation === "sibling"
              ? "sibling"
              : "ancestor",
        slice.distance
      ),
      originalIndex
    }))
}

function buildOmitted(snapshot: Snapshot): ContextPack["omitted"] {
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

function buildScope(snapshot: Snapshot): ContextPack["scope"] {
  const coverage = snapshot.meta.coverage
  return {
    kind: coverage?.kind ?? (isCommentNode(snapshot.focus.node) ? "focus-branch" : "focus-section"),
    rootNodeId: coverage?.rootNodeId ?? snapshot.focus.nodeId,
    focusNodeId: snapshot.focus.nodeId
  }
}

function buildProjectionFocusNode(pack: ContextPack): ProjectionView["focus"] {
  const { metadata: _metadata, relation: _relation, distance: _distance, ...focus } = pack.focus
  return focus
}

function includeByProfile(
  node: ContextPackNode,
  group: keyof ContextPack["groups"],
  profile: ContextTaskProfile
): boolean {
  if (group === "containers") {
    return false
  }

  if (profile === "branch-summary") {
    return true
  }

  if (profile === "claim-extraction") {
    return group !== "siblings"
  }

  if (group === "ancestors") {
    return node.distance === 1
  }

  if (group === "descendants") {
    return node.distance === 1
  }

  if (group === "siblings") {
    return node.distance === 1
  }

  return false
}

function formatNodeSummary(node: ContextPackNode): string {
  const headerParts = [
    node.author,
    node.timestamp,
    node.kind === "interactive" && node.controlType ? node.controlType : null,
    node.kind === "interactive" && node.action ? node.action : null,
    node.kind === "interactive" && node.state ? node.state : null,
    node.kind === "content" && node.contentType ? node.contentType : null
  ].filter(Boolean)

  if (headerParts.length === 0) {
    return `- ${node.text || node.valuePreview || "(empty)"}`
  }

  return `- ${headerParts.join(", ")}: ${node.text || node.valuePreview || "(empty)"}`
}

export function buildContextPack(snapshot: Snapshot): ContextPack {
  const ancestors = [
    ...mapSlices(snapshot, "parent"),
    ...mapSlices(snapshot, "ancestor")
  ]
    .sort((left, right) => right.distance - left.distance || left.originalIndex - right.originalIndex)
    .map(({ originalIndex: _originalIndex, ...node }) => node)

  const descendants = mapSlices(snapshot, "child")
    .sort((left, right) => left.originalIndex - right.originalIndex)
    .map(({ originalIndex: _originalIndex, ...node }) => node)

  const siblings = mapSlices(snapshot, "sibling")
    .sort((left, right) => left.originalIndex - right.originalIndex)
    .map(({ originalIndex: _originalIndex, ...node }) => node)

  const containers = mapSlices(snapshot, "container")
    .sort((left, right) => left.originalIndex - right.originalIndex)
    .map(({ originalIndex: _originalIndex, ...node }) => node)

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
      ancestors,
      descendants,
      siblings,
      containers
    },
    omitted: buildOmitted(snapshot),
    provenance: {
      extractorId: snapshot.meta.extractorId,
      capturedAt: snapshot.meta.capturedAt,
      skeletonVersion: snapshot.meta.skeletonVersion
    }
  }
}

export function selectProjectionView(pack: ContextPack, profile: ContextTaskProfile): ProjectionView {
  const groups = {
    ancestors: pack.groups.ancestors.filter((node) => includeByProfile(node, "ancestors", profile)),
    descendants: pack.groups.descendants.filter((node) => includeByProfile(node, "descendants", profile)),
    siblings: pack.groups.siblings.filter((node) => includeByProfile(node, "siblings", profile)),
    containers: pack.groups.containers.filter((node) => includeByProfile(node, "containers", profile))
  }

  return {
    scope: pack.scope,
    page: {
      ...(pack.page.title ? { title: pack.page.title } : {}),
      url: pack.page.url,
      kind: pack.page.kind
    },
    focus: buildProjectionFocusNode(pack),
    groups,
    omitted: pack.omitted,
    provenance: {
      extractorId: pack.provenance.extractorId,
      capturedAt: pack.provenance.capturedAt
    }
  }
}

export function renderContextPack(pack: ContextPack): string {
  return JSON.stringify(pack, null, 2)
}

export function renderCompactJson(pack: ContextPack, profile: ContextTaskProfile): string {
  return JSON.stringify(selectProjectionView(pack, profile), null, 2)
}

export function renderLinearText(pack: ContextPack, profile: ContextTaskProfile): string {
  const view = selectProjectionView(pack, profile)
  const lines = [
    `Page: ${view.page.title ?? "(untitled)"}`,
    `URL: ${view.page.url}`,
    `Kind: ${view.page.kind}`,
    `Scope: ${view.scope.kind}`,
    ""
  ]

  const sections: Array<[label: string, nodes: ContextPackNode[]]> = [
    ["Ancestors", view.groups.ancestors],
    ["Focus", [pack.focus]],
    ["Descendants", view.groups.descendants],
    ["Siblings", view.groups.siblings]
  ]

  for (const [label, nodes] of sections) {
    const groupKey =
      label === "Ancestors"
        ? "ancestors"
        : label === "Descendants"
          ? "descendants"
          : label === "Siblings"
            ? "siblings"
            : null

    if (groupKey && !projectionIncludesGroup(profile, groupKey)) {
      continue
    }

    lines.push(label)
    if (nodes.length === 0) {
      lines.push("- none")
    } else {
      for (const node of nodes) {
        lines.push(formatNodeSummary(node))
      }
    }
    lines.push("")
  }

  lines.push("Omitted")
  lines.push(`- ${view.omitted.nodeCount} nodes omitted`)
  lines.push(`- ${view.omitted.rootCount} roots omitted`)
  lines.push(`- ${view.omitted.note}`)

  return lines.join("\n")
}
function projectionIncludesGroup(
  profile: ContextTaskProfile,
  group: keyof ContextPack["groups"]
): boolean {
  if (group === "containers") {
    return false
  }

  if (profile === "claim-extraction") {
    return group !== "siblings"
  }

  return true
}
