import type { PageExtractor, SemanticSkeleton } from "@threadatlas/shared/browser-runtime"

export class SkeletonBuilder {
  build(extractor: PageExtractor, document: Document, version: number): SemanticSkeleton {
    const skeleton = extractor.buildSkeleton(document)
    skeleton.version = version
    return skeleton
  }
}
