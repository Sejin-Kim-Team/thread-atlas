import type { SemanticCategory, SemanticPrimitive } from "@threadatlas/shared"
import type { LayoutRole, NormalizedMetadata, RoleRank, RoledRegion } from "../types"

export interface RegionDumpBoundingRect {
  top: number
  left: number
  right: number
  bottom: number
  width: number
  height: number
  x: number
  y: number
}

export interface RegionDumpEntry {
  id: string
  primitive: SemanticPrimitive
  subtype?: string
  category: SemanticCategory
  layoutRole: LayoutRole
  dominanceScore: number
  roleRank: RoleRank
  suppressed: boolean
  autoSuppressed: boolean
  explicitSelectionAllowed: boolean
  confidence: number
  signals: string[]
  nodeCount: number
  textLength: number
  assembledItemCount: number
  normalizedKind?: NormalizedMetadata["kind"]
  boundingRect: RegionDumpBoundingRect
}

export interface RegionDumpDecisionLog {
  overlapResolutions: string[]
  assemblyMerges: string[]
  suppressions: string[]
}

export interface RegionDump {
  url: string
  timestamp: string
  regions: RegionDumpEntry[]
  decisions: RegionDumpDecisionLog
}

export interface CanonicalRegionDumpEntry {
  id: string
  primitive: SemanticPrimitive
  subtype?: string
  category: SemanticCategory
  layoutRole: LayoutRole
  roleRank: RoleRank
  suppressed: boolean
  confidence: number
  nodeCount: number
  textLength: number
  assembledItemCount: number
  normalizedKind?: NormalizedMetadata["kind"]
}

export interface CanonicalRegionDump {
  url: string
  regions: CanonicalRegionDumpEntry[]
}

export interface CanonicalRegionChange {
  regionId: string
  field: keyof Omit<CanonicalRegionDumpEntry, "id">
  expected: unknown
  actual: unknown
}

export interface RegionDumpComparison {
  matches: boolean
  summary: string[]
  changes: CanonicalRegionChange[]
}

export interface ScenarioScorecard {
  regionCount: number
  suppressedCount: number
  repeatedItemAssemblyCount: number
  primitiveCounts: Record<string, number>
  layoutRoleCounts: Record<string, number>
  normalizedKindCounts: Record<string, number>
}

export interface LayoutAssignmentResult {
  regions: RoledRegion[]
  suppressions: string[]
}
