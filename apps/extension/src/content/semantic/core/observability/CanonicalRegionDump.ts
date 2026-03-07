import type { CanonicalRegionDump, CanonicalRegionDumpEntry, RegionDump } from "./types"

function roundConfidence(value: number): number {
  return Math.round(value * 100) / 100
}

function compareEntries(left: CanonicalRegionDumpEntry, right: CanonicalRegionDumpEntry): number {
  return left.id.localeCompare(right.id)
}

export function buildCanonicalRegionDump(dump: RegionDump): CanonicalRegionDump {
  return {
    url: dump.url,
    regions: dump.regions
      .map((region) => ({
        id: region.id,
        primitive: region.primitive,
        ...(region.subtype ? { subtype: region.subtype } : {}),
        category: region.category,
        layoutRole: region.layoutRole,
        roleRank: region.roleRank,
        suppressed: region.suppressed,
        confidence: roundConfidence(region.confidence),
        nodeCount: region.nodeCount,
        textLength: region.textLength,
        assembledItemCount: region.assembledItemCount,
        ...(region.normalizedKind ? { normalizedKind: region.normalizedKind } : {})
      }))
      .sort(compareEntries)
  }
}
