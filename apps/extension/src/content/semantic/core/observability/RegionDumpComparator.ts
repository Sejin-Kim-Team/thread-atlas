import type {
  CanonicalRegionChange,
  CanonicalRegionDump,
  CanonicalRegionDumpEntry,
  RegionDumpComparison
} from "./types"

const COMPARABLE_FIELDS: Array<keyof Omit<CanonicalRegionDumpEntry, "id">> = [
  "primitive",
  "subtype",
  "category",
  "layoutRole",
  "roleRank",
  "suppressed",
  "confidence",
  "nodeCount",
  "textLength",
  "assembledItemCount",
  "normalizedKind"
]

function compareValues(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function formatFieldLabel(field: keyof Omit<CanonicalRegionDumpEntry, "id">): string {
  switch (field) {
    case "layoutRole":
      return "layout role"
    case "roleRank":
      return "role rank"
    case "assembledItemCount":
      return "assembly count"
    case "normalizedKind":
      return "normalized kind"
    case "nodeCount":
      return "node count"
    case "textLength":
      return "text length"
    default:
      return field
  }
}

function countSuppressedRegions(dump: CanonicalRegionDump): number {
  return dump.regions.filter((region) => region.suppressed).length
}

function countAssembledItems(dump: CanonicalRegionDump): number {
  return dump.regions.reduce((sum, region) => sum + region.assembledItemCount, 0)
}

function buildRegionIndex(dump: CanonicalRegionDump): Map<string, CanonicalRegionDumpEntry> {
  return new Map(dump.regions.map((region) => [region.id, region]))
}

function sortChanges(left: CanonicalRegionChange, right: CanonicalRegionChange): number {
  return left.regionId.localeCompare(right.regionId) || left.field.localeCompare(right.field)
}

export function compareCanonicalRegionDumps(
  expected: CanonicalRegionDump,
  actual: CanonicalRegionDump
): RegionDumpComparison {
  const summary: string[] = []
  const changes: CanonicalRegionChange[] = []
  const expectedIndex = buildRegionIndex(expected)
  const actualIndex = buildRegionIndex(actual)
  const expectedIds = [...expectedIndex.keys()].sort()
  const actualIds = [...actualIndex.keys()].sort()

  if (expected.url !== actual.url) {
    summary.push(`url changed: ${expected.url} -> ${actual.url}`)
  }

  const expectedSuppressed = countSuppressedRegions(expected)
  const actualSuppressed = countSuppressedRegions(actual)
  if (expectedSuppressed !== actualSuppressed) {
    summary.push(`suppressed count changed: ${expectedSuppressed} -> ${actualSuppressed}`)
  }

  const expectedAssemblyCount = countAssembledItems(expected)
  const actualAssemblyCount = countAssembledItems(actual)
  if (expectedAssemblyCount !== actualAssemblyCount) {
    summary.push(`assembly count changed: ${expectedAssemblyCount} -> ${actualAssemblyCount}`)
  }

  for (const regionId of expectedIds) {
    if (!actualIndex.has(regionId)) {
      summary.push(`region removed: ${regionId}`)
    }
  }

  for (const regionId of actualIds) {
    if (!expectedIndex.has(regionId)) {
      summary.push(`region added: ${regionId}`)
    }
  }

  for (const regionId of expectedIds) {
    const expectedRegion = expectedIndex.get(regionId)
    const actualRegion = actualIndex.get(regionId)
    if (!expectedRegion || !actualRegion) {
      continue
    }

    for (const field of COMPARABLE_FIELDS) {
      if (compareValues(expectedRegion[field], actualRegion[field])) {
        continue
      }

      changes.push({
        regionId,
        field,
        expected: expectedRegion[field],
        actual: actualRegion[field]
      })
    }
  }

  for (const change of changes.sort(sortChanges)) {
    summary.push(
      `${formatFieldLabel(change.field)} changed for ${change.regionId}: ${String(change.expected)} -> ${String(change.actual)}`
    )
  }

  return {
    matches: summary.length === 0,
    summary,
    changes
  }
}
