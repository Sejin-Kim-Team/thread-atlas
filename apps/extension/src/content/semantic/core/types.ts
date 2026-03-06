import type {
  CommentNode,
  ContentNode,
  InteractiveNode,
  PageKind,
  SemanticCategory,
  SemanticNode,
  SemanticPrimitive
} from "@threadatlas/shared"
import type { RecognizedRegion, SemanticRegion } from "@threadatlas/shared/browser-runtime"

export type SelectableNodeKind = "content" | "comment" | "interactive"

export interface NodeBlueprint {
  nodeId: string
  element: Element
  kind: SelectableNodeKind
  scopeRootId: string
  displayLabel: string
  category?: SemanticCategory
  textPreview?: string
}

export interface DetectedRegion extends RecognizedRegion {
  kind: string
  displayLabel: string
  metadata?: Record<string, string>
  pageTitle?: string
  pageKindHint?: PageKind
  nodeBlueprints: NodeBlueprint[]
  structure?: SemanticRegion["structure"]
  parentId?: string
  itemElements?: Element[]
  assembledItems?: AssembledItem[]
  layoutRole?: LayoutRole
  roleRank?: RoleRank
  dominanceScore?: number
  autoSuppressed?: boolean
  explicitSelectionAllowed?: boolean
  suppressed?: boolean
}

export interface AssembledItem {
  nodeId: string
  element: Element
  primaryElement: Element
  kind: SelectableNodeKind
  companions: Element[]
  links?: {
    primary?: string
    discussion?: string
  }
  metadata?: {
    title?: string
    author?: string
    timestamp?: string
    score?: string
    commentCount?: string
  }
  parentId?: string
  depth?: number
  scopeRootId: string
  displayLabel: string
  category?: SemanticCategory
  textPreview?: string
}

export interface AssembledRegion extends DetectedRegion {
  assembledItems?: AssembledItem[]
}

export type LayoutRole =
  | "main-content"
  | "sidebar"
  | "global-nav"
  | "section-nav"
  | "footer-resources"
  | "hero"
  | "search-bar"
  | "utility"

export type RoleRank = "primary" | "supporting" | "peripheral"

export interface RoledRegion extends AssembledRegion {
  layoutRole: LayoutRole
  roleRank: RoleRank
  dominanceScore: number
  autoSuppressed: boolean
  explicitSelectionAllowed: boolean
  suppressed: boolean
}

export interface PipelineRegionState {
  assembled: AssembledRegion
  layout: RoledRegion
  normalized?: NormalizedMetadata
}

export interface GenericRecognizer {
  readonly primitive: SemanticPrimitive
  detectDetailed(document: Document): DetectedRegion[]
  extractDetailed(region: DetectedRegion, document: Document): SemanticRegion
}

export interface ThreadExplicitHint {
  nodeId: string
  kind: "parent" | "root" | "next" | "prev"
  targetNodeId?: string
  href?: string
}

export interface ThreadMetadata {
  kind: "thread"
  hasCollapsedBranches: boolean
  collapsedBranchIds: string[]
  explicitHints: ThreadExplicitHint[]
  hasReplyAffordance: boolean
}

export interface ArticleSectionMetadata {
  id: string
  title?: string
  level?: number
  parentId?: string
  nodeIds: string[]
}

export interface ArticleMetadata {
  kind: "article"
  sections: ArticleSectionMetadata[]
  tags: string[]
  separatedNavigation: string[]
}

export interface CardFieldTemplate {
  title: "first-heading" | "first-link" | "first-strong"
  image: "first-image" | "background"
  metadata: "after-title" | "bottom" | "none"
  cta: "last-button" | "last-link" | "none"
}

export interface CardMetadata {
  kind: "card"
  fieldTemplate: CardFieldTemplate
}

export type NormalizedMetadata = ThreadMetadata | ArticleMetadata | CardMetadata

export type SemanticRuntimeNode = ContentNode | CommentNode | InteractiveNode

export function isCommentNode(node: SemanticNode): node is CommentNode {
  return node.kind === "comment"
}

export function isInteractiveNode(node: SemanticNode): node is InteractiveNode {
  return node.kind === "interactive"
}

export function isContentNode(node: SemanticNode): node is ContentNode {
  return node.kind === "content"
}

export function nodeFromRegion(region: SemanticRegion, nodeId: string): SemanticRuntimeNode | null {
  return region.nodes.find((node) => node.id === nodeId) ?? null
}

export function firstMeaningfulNode(region: SemanticRegion): SemanticRuntimeNode | null {
  return (
    region.nodes.find((node) => {
      if ("text" in node) {
        return Boolean(node.text)
      }
      return Boolean(node.label || node.valuePreview)
    }) ?? region.nodes[0] ?? null
  )
}
