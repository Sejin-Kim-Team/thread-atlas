import { describe, expect, it } from "vitest"
import { SemanticPipeline } from "../src/content/semantic/core/pipeline/SemanticPipeline"
import {
  buildCanonicalRegionDump,
  buildScenarioScorecard,
  compareCanonicalRegionDumps
} from "../src/content/semantic/core/observability"
import type { CanonicalRegionDumpEntry } from "../src/content/semantic/core/observability"
import { CORPUS_EXPECTATIONS } from "./corpus/expectations"
import type { CorpusScenario, RegionMatchExpectation } from "./corpus/scenarios"
import { CORPUS_SCENARIOS } from "./corpus/scenarios"

function applyScenarioUrl(url: string): void {
  const parsed = new URL(url)
  window.history.replaceState({}, "", `${parsed.pathname}${parsed.search}${parsed.hash}`)
}

function matchesRegionExpectation(
  region: CanonicalRegionDumpEntry,
  expectation: RegionMatchExpectation
): boolean {
  return Object.entries(expectation).every(([key, value]) => {
    const regionKey = key as keyof RegionMatchExpectation
    return region[regionKey as keyof CanonicalRegionDumpEntry] === value
  })
}

function assertScenarioExpectations(scenario: CorpusScenario, regions: CanonicalRegionDumpEntry[]): void {
  for (const expectation of scenario.coreExpectations.requiredRegionMatches ?? []) {
    expect(
      regions.some((region) => matchesRegionExpectation(region, expectation)),
      `missing required region match for ${scenario.id}: ${JSON.stringify(expectation)}`
    ).toBe(true)
  }

  for (const expectation of scenario.coreExpectations.forbiddenRegionMatches ?? []) {
    expect(
      regions.some((region) => matchesRegionExpectation(region, expectation)),
      `found forbidden region match for ${scenario.id}: ${JSON.stringify(expectation)}`
    ).toBe(false)
  }
}

function formatRegressionFailure(
  scenarioId: string,
  comparisonSummary: string[],
  expectedScorecard: unknown,
  actualScorecard: unknown
): string {
  const summary = comparisonSummary.length > 0 ? comparisonSummary : ["scorecard changed"]
  return [
    `scenario regression mismatch: ${scenarioId}`,
    ...summary.map((entry) => `- ${entry}`),
    `expected scorecard: ${JSON.stringify(expectedScorecard)}`,
    `actual scorecard: ${JSON.stringify(actualScorecard)}`
  ].join("\n")
}

describe("Semantic corpus regression", () => {
  for (const scenario of CORPUS_SCENARIOS) {
    it(`matches ${scenario.id}`, () => {
      applyScenarioUrl(scenario.url)
      document.body.innerHTML = scenario.html

      const pipeline = new SemanticPipeline()
      pipeline.build(document)

      const actualDump = {
        ...buildCanonicalRegionDump(pipeline.createRegionDump(document)),
        url: scenario.url
      }
      const actualScorecard = buildScenarioScorecard(actualDump)
      const expected = CORPUS_EXPECTATIONS[scenario.id]
      const comparison = compareCanonicalRegionDumps(expected.dump, actualDump)
      const scorecardMatches = JSON.stringify(actualScorecard) === JSON.stringify(expected.scorecard)

      assertScenarioExpectations(scenario, actualDump.regions)

      if (!comparison.matches || !scorecardMatches) {
        throw new Error(
          formatRegressionFailure(scenario.id, comparison.summary, expected.scorecard, actualScorecard)
        )
      }

      expect(actualDump).toEqual(expected.dump)
      expect(actualScorecard).toEqual(expected.scorecard)
    })
  }
})
