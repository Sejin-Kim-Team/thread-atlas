import type { AssembledRegion, LayoutRole, RoledRegion, RoleRank } from "../types"
import type { LayoutAssignmentResult } from "../observability"

function areaFor(element: Element): number {
  const rect = element.getBoundingClientRect()
  return rect.width * rect.height
}

function textLengthFor(region: AssembledRegion): number {
  return region.nodeBlueprints.reduce((sum, blueprint) => sum + (blueprint.textPreview?.length ?? 0), 0)
}

function isInFooter(element: Element): boolean {
  return Boolean(element.closest("footer,[role='contentinfo']"))
}

function isInHeader(element: Element): boolean {
  return Boolean(element.closest("header"))
}

function isInAside(element: Element): boolean {
  return Boolean(element.closest("aside,[role='complementary']"))
}

function roleRankScore(rank: RoleRank): number {
  if (rank === "primary") {
    return 3
  }
  if (rank === "supporting") {
    return 2
  }
  return 1
}

export class DominanceScorer {
  score(region: AssembledRegion): number {
    let score = 0

    if (region.primitive === "repeated-item" && region.subtype === "nested") {
      score += 1000
    } else if (region.primitive === "authored-block") {
      score += 900
    } else if (region.primitive === "repeated-item" && region.subtype === "grid") {
      score += 650
    } else if (region.primitive === "repeated-item") {
      score += 700
    } else if (region.primitive === "interactive-block") {
      score += 250
    } else if (region.primitive === "navigation-cluster") {
      score += 150
    }

    score += Math.min(400, Math.round(areaFor(region.element) / 1000))
    score += Math.min(300, textLengthFor(region))

    if (isInAside(region.element)) {
      score -= 120
    }
    if (isInHeader(region.element) || isInFooter(region.element)) {
      score -= 180
    }

    return score
  }
}

export class RoleRanker {
  assignPrimary(regions: AssembledRegion[], scorer: DominanceScorer): string | null {
    const ranked = regions
      .filter((region) => !isInHeader(region.element) && !isInFooter(region.element))
      .map((region) => ({ region, score: scorer.score(region) }))
      .sort((left, right) => right.score - left.score)[0]

    return ranked?.region.id ?? null
  }
}

export class UtilitySuppressor {
  classify(region: AssembledRegion, primaryRegionId: string | null): {
    autoSuppressed: boolean
    explicitSelectionAllowed: boolean
  } {
    if (region.id === primaryRegionId) {
      return {
        autoSuppressed: false,
        explicitSelectionAllowed: true
      }
    }

    if (region.primitive === "navigation-cluster") {
      return {
        autoSuppressed: true,
        explicitSelectionAllowed: true
      }
    }

    if (region.primitive === "interactive-block") {
      return {
        autoSuppressed: true,
        explicitSelectionAllowed: true
      }
    }

    return {
      autoSuppressed: false,
      explicitSelectionAllowed: true
    }
  }
}

export class LayoutRoleAssigner {
  private readonly scorer = new DominanceScorer()
  private readonly ranker = new RoleRanker()
  private readonly suppressor = new UtilitySuppressor()

  assign(regions: AssembledRegion[]): RoledRegion[] {
    return this.assignDetailed(regions).regions
  }

  assignDetailed(regions: AssembledRegion[]): LayoutAssignmentResult {
    const primaryRegionId = this.ranker.assignPrimary(regions, this.scorer)
    const suppressions: string[] = []

    const roled = regions.map((region) => {
      const dominanceScore = this.scorer.score(region)
      const { layoutRole, roleRank } = this.resolveRole(region, primaryRegionId)
      const suppression = this.suppressor.classify(region, primaryRegionId)

      if (suppression.autoSuppressed) {
        suppressions.push(
          `suppressed ${region.id}: ${layoutRole} auto-suppressed as ${roleRank} region`
        )
      }

      return {
        ...region,
        layoutRole,
        roleRank,
        dominanceScore,
        autoSuppressed: suppression.autoSuppressed,
        explicitSelectionAllowed: suppression.explicitSelectionAllowed,
        suppressed: suppression.autoSuppressed || !suppression.explicitSelectionAllowed
      }
    })

    return {
      regions: roled,
      suppressions
    }
  }

  private resolveRole(
    region: AssembledRegion,
    primaryRegionId: string | null
  ): {
    layoutRole: LayoutRole
    roleRank: RoleRank
  } {
    if (region.id === primaryRegionId) {
      return {
        layoutRole: "main-content",
        roleRank: "primary"
      }
    }

    if (region.primitive === "navigation-cluster") {
      if (isInFooter(region.element)) {
        return {
          layoutRole: "footer-resources",
          roleRank: "peripheral"
        }
      }
      if (isInAside(region.element)) {
        return {
          layoutRole: "section-nav",
          roleRank: "supporting"
        }
      }

      return {
        layoutRole: "global-nav",
        roleRank: "peripheral"
      }
    }

    if (region.primitive === "interactive-block") {
      if (region.subtype === "search") {
        return {
          layoutRole: "search-bar",
          roleRank: "peripheral"
        }
      }

      return {
        layoutRole: isInAside(region.element) ? "sidebar" : "utility",
        roleRank: isInAside(region.element) ? "supporting" : "peripheral"
      }
    }

    if (region.primitive === "authored-block") {
      return {
        layoutRole: "main-content",
        roleRank: "supporting"
      }
    }

    if (region.primitive === "repeated-item") {
      if (region.subtype === "nested") {
        return {
          layoutRole: "main-content",
          roleRank: primaryRegionId === null ? "primary" : "supporting"
        }
      }

      return {
        layoutRole: "main-content",
        roleRank: "supporting"
      }
    }

    return {
      layoutRole: "utility",
      roleRank: "peripheral"
    }
  }
}

export function sortRegionsForFallback(left: RoledRegion, right: RoledRegion): number {
  const rankDelta = roleRankScore(right.roleRank) - roleRankScore(left.roleRank)
  if (rankDelta !== 0) {
    return rankDelta
  }

  if (right.dominanceScore !== left.dominanceScore) {
    return right.dominanceScore - left.dominanceScore
  }

  return 0
}
