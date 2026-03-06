import type { ThreadDoc } from "./thread"
import type { ThreadSemantics } from "./semantics"

export interface PageHeading {
  level: number
  text: string
}

export interface PageLandmark {
  role: string
  label: string
}

export interface PageStructure {
  headings: PageHeading[]
  landmarks: PageLandmark[]
  commentCount: number
  nestingDepth: number
}

export interface ArticleContext {
  url: string
  title: string
  text: string
  structure: PageStructure
  readAt: number
}

export type GraphContentNodeType = "article" | "thread"

export interface ContentSnapshot {
  text: string
  structure: PageStructure
  extractedAt: number
}

export interface GraphContentNode {
  id: string
  url: string
  title: string
  type: GraphContentNodeType
  snapshot: ContentSnapshot | null
}

export interface ThreadNode extends GraphContentNode {
  type: "thread"
  platform: "hn"
  threadDoc: ThreadDoc | null
  semantics: ThreadSemantics | null
  sourceArticleUrl: string | null
}

export interface ContentEdge {
  from: string
  to: string
  relation: "triggers"
}

export interface ContentGraph {
  nodes: Map<string, GraphContentNode>
  edges: ContentEdge[]
}
