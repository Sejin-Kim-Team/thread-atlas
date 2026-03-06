import type { SemanticPrimitive } from "@threadatlas/shared"
import type { LayoutRole, RoleRank, RoledRegion } from "../types"

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

export interface LayoutAssignmentResult {
  regions: RoledRegion[]
  suppressions: string[]
}
