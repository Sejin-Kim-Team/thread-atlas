import type { CanonicalRegionDump, ScenarioScorecard } from "./types"

function incrementCounter(counter: Record<string, number>, key: string): void {
  counter[key] = (counter[key] ?? 0) + 1
}

function sortCounter(counter: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(counter).sort(([left], [right]) => left.localeCompare(right)))
}

export function buildScenarioScorecard(dump: CanonicalRegionDump): ScenarioScorecard {
  const primitiveCounts: Record<string, number> = {}
  const layoutRoleCounts: Record<string, number> = {}
  const normalizedKindCounts: Record<string, number> = {}

  for (const region of dump.regions) {
    incrementCounter(primitiveCounts, region.primitive)
    incrementCounter(layoutRoleCounts, region.layoutRole)
    if (region.normalizedKind) {
      incrementCounter(normalizedKindCounts, region.normalizedKind)
    }
  }

  return {
    regionCount: dump.regions.length,
    suppressedCount: dump.regions.filter((region) => region.suppressed).length,
    repeatedItemAssemblyCount: dump.regions.reduce(
      (sum, region) => sum + (region.primitive === "repeated-item" ? region.assembledItemCount : 0),
      0
    ),
    primitiveCounts: sortCounter(primitiveCounts),
    layoutRoleCounts: sortCounter(layoutRoleCounts),
    normalizedKindCounts: sortCounter(normalizedKindCounts)
  }
}
