export type PageKind = "article" | "thread" | "post" | "generic"
export type SemanticScopeKind = "page" | "selection"
export type SemanticNormalizedKind = "article" | "thread" | "card"

export type SemanticPrimitive =
  | "authored-block"
  | "repeated-item"
  | "navigation-cluster"
  | "interactive-block"

export type SemanticCategory =
  | "content.article"
  | "content.post"
  | "content.media"
  | "discussion.comment"
  | "discussion.thread"
  | "discussion.reaction"
  | "navigation.menu"
  | "navigation.breadcrumb"
  | "navigation.pagination"
  | "metadata.author"
  | "metadata.timestamp"
  | "metadata.stats"
  | "interactive.form"
  | "interactive.search"
  | "interactive.filter"
  | "interactive.sort"
  | "interactive.action"

export type ContentNodeType =
  | "paragraph"
  | "heading"
  | "quote"
  | "code"
  | "list"
  | "image"
  | "metadata"
  | "link"

export type ContextRelation = "parent" | "child" | "sibling" | "container" | "ancestor"
export type SemanticNodeKind = "content" | "comment" | "interactive"

export interface PageNode {
  id: string
  url: string
  title?: string
  kind: PageKind
  metadata?: Record<string, string>
}

export interface ContentNode {
  kind: "content"
  id: string
  type: ContentNodeType
  text: string
  level?: number
  language?: string
  attributes?: Record<string, string>
  parentId?: string
}

export interface CommentNode {
  kind: "comment"
  id: string
  author?: string
  text: string
  timestamp?: string
  parentId?: string
  depth: number
  metadata?: Record<string, string>
}

export interface InteractiveNode {
  kind: "interactive"
  id: string
  controlType:
    | "group"
    | "input"
    | "select"
    | "button"
    | "checkbox"
    | "radio"
    | "textarea"
    | "link-button"
    | "chip"
  label?: string
  role?: string
  action?: "search" | "filter" | "sort" | "submit" | "toggle" | "navigate" | "unknown"
  state?: "checked" | "unchecked" | "selected" | "expanded" | "collapsed" | "disabled"
  valuePreview?: string
  options?: string[]
  parentId?: string
  metadata?: Record<string, string>
}

export type SemanticNode = ContentNode | CommentNode | InteractiveNode

export interface ContextSlice {
  relation: ContextRelation
  node: SemanticNode
  distance: number
}

export interface SemanticSnapshot {
  page: PageNode
  focus: {
    nodeId: string
    node: SemanticNode
    region: string
  }
  context: ContextSlice[]
  meta: {
    capturedAt: string
    skeletonVersion: number
    extractorId: string
    scopeKind?: SemanticScopeKind
    focusRegionHint?: {
      primitive: SemanticPrimitive
      subtype?: string
      normalizedKind?: SemanticNormalizedKind
      layoutRole?: string
      roleRank?: string
    }
    focusTargetHint?: {
      regionId: string
      focusNodeId: string
      rootNodeId?: string
    }
    coverage?: {
      kind: "focus-branch" | "focus-section"
      rootNodeId: string
      capturedNodeCount: number
      omittedNodeCount: number
      omittedRootCount: number
    }
  }
}
