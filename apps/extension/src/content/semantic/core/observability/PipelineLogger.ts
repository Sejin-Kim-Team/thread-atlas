import type { DetectedRegion } from "../types"
import type { RegionDumpDecisionLog } from "./types"

export class PipelineLogger {
  private readonly overlapResolutions: string[] = []
  private readonly assemblyMerges: string[] = []
  private readonly suppressions: string[] = []

  reset(): void {
    this.overlapResolutions.length = 0
    this.assemblyMerges.length = 0
    this.suppressions.length = 0
  }

  recordOverlapResolutions(raw: DetectedRegion[], accepted: DetectedRegion[]): void {
    const winnersByElement = new Map<Element, DetectedRegion>()
    for (const region of accepted) {
      winnersByElement.set(region.element, region)
    }

    for (const region of raw) {
      const winner = winnersByElement.get(region.element)
      if (!winner || winner.id === region.id) {
        continue
      }

      this.overlapResolutions.push(
        `deduped ${region.id} (${region.primitive}) in favor of ${winner.id} (${winner.primitive}) on the same anchor element`
      )
    }
  }

  recordContainment(regions: DetectedRegion[]): void {
    for (const region of regions) {
      if (!region.parentId) {
        continue
      }

      this.overlapResolutions.push(
        `kept ${region.id} (${region.primitive}) nested under ${region.parentId} after containment resolution`
      )
    }
  }

  recordAssembly(decisions: string[]): void {
    this.assemblyMerges.push(...decisions)
  }

  recordSuppressions(decisions: string[]): void {
    this.suppressions.push(...decisions)
  }

  snapshot(): RegionDumpDecisionLog {
    return {
      overlapResolutions: [...this.overlapResolutions],
      assemblyMerges: [...this.assemblyMerges],
      suppressions: [...this.suppressions]
    }
  }
}
