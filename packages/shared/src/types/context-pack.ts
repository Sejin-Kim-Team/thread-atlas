import type {
  ContentNodeType,
  PageKind,
  SemanticNodeKind
} from "./semantic-snapshot"

export type ContextPackScopeKind = "focus-branch" | "focus-section"

export type ContextPackNodeKind = SemanticNodeKind

export type ContextPackRelation = "focus" | "ancestor" | "descendant" | "sibling" | "container"

export interface ContextPackNode {
  id: string
  kind: ContextPackNodeKind
  relation: ContextPackRelation
  distance: number
  text: string
  author?: string
  timestamp?: string
  depth?: number
  contentType?: ContentNodeType
  level?: number
  controlType?:
    | "group"
    | "input"
    | "select"
    | "button"
    | "checkbox"
    | "radio"
    | "textarea"
    | "link-button"
    | "chip"
  action?: "search" | "filter" | "sort" | "submit" | "toggle" | "navigate" | "unknown"
  state?: "checked" | "unchecked" | "selected" | "expanded" | "collapsed" | "disabled"
  role?: string
  valuePreview?: string
  label?: string
  parentId?: string
  metadata?: Record<string, string>
}

export interface ContextPack {
  version: 1
  scope: {
    kind: ContextPackScopeKind
    rootNodeId: string
    focusNodeId: string
  }
  page: {
    id: string
    url: string
    title?: string
    kind: PageKind
    metadata?: Record<string, string>
  }
  focus: ContextPackNode
  groups: {
    ancestors: ContextPackNode[]
    descendants: ContextPackNode[]
    siblings: ContextPackNode[]
    containers: ContextPackNode[]
  }
  omitted: {
    nodeCount: number
    rootCount: number
    note: string
  }
  provenance: {
    extractorId: string
    capturedAt: string
    skeletonVersion: number
  }
}
