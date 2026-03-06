import type { SemanticMarkdownAST } from "dom-to-semantic-markdown"
import type { SemanticRegion } from "@threadatlas/shared/browser-runtime"
import type { NormalizedMetadata, RoledRegion } from "../types"

export interface NormalizationResult<TMetadata extends NormalizedMetadata = NormalizedMetadata> {
  region: SemanticRegion
  metadata: TMetadata
}

export interface SemanticNormalizer<TMetadata extends NormalizedMetadata = NormalizedMetadata> {
  canNormalize(region: RoledRegion): boolean
  normalize(input: {
    region: RoledRegion
    semanticRegion: SemanticRegion
    ast: SemanticMarkdownAST[]
    document: Document
  }): NormalizationResult<TMetadata>
}
