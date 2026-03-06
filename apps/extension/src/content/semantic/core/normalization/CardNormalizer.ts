import type { SemanticRegion } from "@threadatlas/shared/browser-runtime"
import type { ContentNode } from "@threadatlas/shared"
import type { CardFieldTemplate, CardMetadata, RoledRegion } from "../types"
import type { NormalizationResult, SemanticNormalizer } from "./types"

function learnTemplate(region: RoledRegion): CardFieldTemplate {
  const items = (region.assembledItems ?? []).slice(0, 3)

  const title = items.some((item) => item.element.querySelector("h1,h2,h3,h4,h5,h6")) ? "first-heading" :
    items.some((item) => item.element.querySelector("a[href]")) ? "first-link" : "first-strong"

  const image = items.some((item) => item.element.querySelector("img,picture")) ? "first-image" : "background"

  const metadata = items.some((item) => item.companions.length > 0) ? "bottom" :
    items.some((item) => item.element.querySelector("time,.meta,.subtext,[class*='meta'],[class*='subtext']")) ? "after-title" : "none"

  const cta = items.some((item) => item.element.querySelector("button")) ? "last-button" :
    items.some((item) => item.element.querySelector("a[href]")) ? "last-link" : "none"

  return {
    title,
    image,
    metadata,
    cta
  }
}

export class CardNormalizer implements SemanticNormalizer<CardMetadata> {
  canNormalize(region: RoledRegion): boolean {
    return (
      region.primitive === "repeated-item" &&
      (region.subtype === "flat" || region.subtype === "grid") &&
      (region.assembledItems?.length ?? 0) >= 3
    )
  }

  normalize(input: {
    region: RoledRegion
    semanticRegion: SemanticRegion
    ast: unknown[]
    document: Document
  }): NormalizationResult<CardMetadata> {
    const template = learnTemplate(input.region)
    const nodes = input.semanticRegion.nodes.map((node) => {
      if (node.kind !== "content") {
        return node
      }

      const nextNode: ContentNode = {
        ...node,
        attributes: {
          ...(node.attributes ?? {}),
          normalizedTitle: template.title,
          normalizedImage: template.image,
          normalizedMetadata: template.metadata,
          normalizedCta: template.cta
        }
      }

      return nextNode
    })

    return {
      region: {
        ...input.semanticRegion,
        nodes
      },
      metadata: {
        kind: "card",
        fieldTemplate: template
      }
    }
  }
}
