import type { SemanticRegion } from "@threadatlas/shared/browser-runtime"
import type { SemanticNode } from "@threadatlas/shared"
import type { RoledRegion } from "../types"
import type { RegionDump, RegionDumpBoundingRect, RegionDumpDecisionLog } from "./types"

function toBoundingRect(rect: DOMRect): RegionDumpBoundingRect {
  return {
    top: rect.top,
    left: rect.left,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
    x: rect.x,
    y: rect.y
  }
}

function textLengthForNode(node: SemanticNode): number {
  if ("text" in node) {
    return node.text.length
  }

  return (node.label ?? node.valuePreview ?? "").length
}

export class RegionDumper {
  build(input: {
    url: string
    timestamp: string
    regions: RoledRegion[]
    expandRegion: (regionId: string) => SemanticRegion | null
    decisions: RegionDumpDecisionLog
  }): RegionDump {
    return {
      url: input.url,
      timestamp: input.timestamp,
      regions: input.regions.map((region) => {
        const expanded = input.expandRegion(region.id)
        const rect = region.element.getBoundingClientRect()

        return {
          id: region.id,
          primitive: region.primitive,
          ...(region.subtype ? { subtype: region.subtype } : {}),
          layoutRole: region.layoutRole,
          dominanceScore: region.dominanceScore,
          roleRank: region.roleRank,
          suppressed: region.suppressed,
          autoSuppressed: region.autoSuppressed,
          explicitSelectionAllowed: region.explicitSelectionAllowed,
          confidence: region.confidence,
          signals: [...region.signals],
          nodeCount: expanded?.nodes.length ?? 0,
          textLength: expanded?.nodes.reduce((sum, node) => sum + textLengthForNode(node), 0) ?? 0,
          boundingRect: toBoundingRect(rect)
        }
      }),
      decisions: input.decisions
    }
  }
}
