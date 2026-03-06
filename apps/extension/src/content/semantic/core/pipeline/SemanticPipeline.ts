import type { SemanticRegion } from "@threadatlas/shared/browser-runtime"
import { SemanticASTBuilder } from "../../ast"
import { RepeatedItemAssembler } from "../assembly/repeated-item-assembly"
import { assignContainment, createDefaultRecognizers, dedupeRegions } from "../detection/recognizers"
import { LayoutRoleAssigner } from "../layout/layout-role"
import { ArticleNormalizer, CardNormalizer, ThreadNormalizer } from "../normalization"
import type { SemanticNormalizer } from "../normalization"
import { PipelineLogger, RegionDumper } from "../observability"
import type { RegionDump } from "../observability"
import type { GenericRecognizer, PipelineRegionState, RoledRegion } from "../types"

export class SemanticPipeline {
  private readonly astBuilder = new SemanticASTBuilder()
  private readonly repeatedItemAssembler = new RepeatedItemAssembler()
  private readonly layoutRoleAssigner = new LayoutRoleAssigner()
  private readonly logger = new PipelineLogger()
  private readonly regionDumper = new RegionDumper()
  private readonly normalizers: SemanticNormalizer[] = [
    new ThreadNormalizer(),
    new ArticleNormalizer(),
    new CardNormalizer()
  ]
  private readonly state = new Map<string, PipelineRegionState>()

  constructor(private readonly recognizers: GenericRecognizer[] = createDefaultRecognizers()) {}

  reset(): void {
    this.state.clear()
    this.logger.reset()
  }

  build(document: Document): { regions: RoledRegion[] } {
    this.reset()

    const raw = this.recognizers.flatMap((recognizer) => recognizer.detectDetailed(document))
    const detected = dedupeRegions(raw)
    this.logger.recordOverlapResolutions(raw, detected)
    assignContainment(detected)
    this.logger.recordContainment(detected)

    const assembled = detected.map((region) => {
      const result = this.repeatedItemAssembler.assembleDetailed(region)
      this.logger.recordAssembly(result.decisions)
      return result.region
    })
    const layoutResult = this.layoutRoleAssigner.assignDetailed(assembled)
    this.logger.recordSuppressions(layoutResult.suppressions)
    const roled = layoutResult.regions

    for (const region of roled) {
      this.state.set(region.id, {
        assembled: region,
        layout: region
      })
    }

    return {
      regions: roled
    }
  }

  getRegion(regionId: string): RoledRegion | null {
    return this.state.get(regionId)?.layout ?? null
  }

  getState(regionId: string): PipelineRegionState | null {
    return this.state.get(regionId) ?? null
  }

  createRegionDump(document: Document): RegionDump {
    const regions = [...this.state.values()].map((entry) => entry.layout)
    return this.regionDumper.build({
      url: document.location.href,
      timestamp: new Date().toISOString(),
      regions,
      expandRegion: (regionId) => this.expandRegion(regionId, document),
      getState: (regionId) => this.getState(regionId),
      decisions: this.logger.snapshot()
    })
  }

  expandRegion(regionId: string, document: Document): SemanticRegion | null {
    const state = this.state.get(regionId)
    if (!state) {
      return null
    }

    const recognizer = this.recognizers.find((candidate) => candidate.primitive === state.layout.primitive)
    if (!recognizer) {
      return null
    }

    const baseRegion = recognizer.extractDetailed(state.layout, document)
    const ast = this.astBuilder.build(state.layout.element)
    const normalizer = this.normalizers.find((candidate) => candidate.canNormalize(state.layout))

    if (!normalizer) {
      return baseRegion
    }

    const result = normalizer.normalize({
      region: state.layout,
      semanticRegion: baseRegion,
      ast,
      document
    })

    state.normalized = result.metadata
    return result.region
  }
}
