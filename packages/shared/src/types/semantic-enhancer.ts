import type { SemanticSelectionTarget } from "./messages"
import type { SemanticRegion, SemanticSkeleton } from "./semantic-browser-runtime"

export interface EnhancerContext {
  url: URL
  document: Document
}

export interface SiteEnhancer {
  id: string
  match(url: URL, document: Document): boolean
  refineSkeleton?(input: SemanticSkeleton, ctx: EnhancerContext): SemanticSkeleton
  refineRegion?(input: SemanticRegion, ctx: EnhancerContext): SemanticRegion
  refineSelection?(input: SemanticSelectionTarget, ctx: EnhancerContext): SemanticSelectionTarget
}
