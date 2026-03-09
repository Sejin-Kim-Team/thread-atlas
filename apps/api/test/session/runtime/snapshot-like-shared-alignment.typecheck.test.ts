import { describe, expect, it } from "vitest"
import type { SnapshotLike } from "../../../src/session/runtime/types"

type ExpectTrue<T extends true> = T

type HasPageMetadata = "metadata" extends keyof NonNullable<SnapshotLike["page"]> ? true : false
type HasMetaCoverage = "coverage" extends keyof NonNullable<SnapshotLike["meta"]> ? true : false
type FocusNode = NonNullable<NonNullable<SnapshotLike["focus"]>["node"]>
type InteractiveFocusNode = Extract<FocusNode, { kind?: "interactive" }>
type HasUnionNodeKind = "kind" extends keyof FocusNode ? true : false
type HasUnionNodeControlType = "controlType" extends keyof InteractiveFocusNode ? true : false
type HasVisualSignals = "visualSignals" extends keyof SnapshotLike ? true : false
type HasVisualSignalsUiSuspicious =
  "uiSuspicious" extends keyof NonNullable<SnapshotLike["visualSignals"]> ? true : false
type HasVisualSignalsAnomalyScore =
  "anomalyScore" extends keyof NonNullable<SnapshotLike["visualSignals"]> ? true : false

const pageMetadataContract: ExpectTrue<HasPageMetadata> = true
const metaCoverageContract: ExpectTrue<HasMetaCoverage> = true
const unionNodeKindContract: ExpectTrue<HasUnionNodeKind> = true
const unionNodeControlTypeContract: ExpectTrue<HasUnionNodeControlType> = true
const visualSignalsIntersectionContract: ExpectTrue<HasVisualSignals> = true
const visualSignalsUiSuspiciousContract: ExpectTrue<HasVisualSignalsUiSuspicious> = true
const visualSignalsAnomalyScoreContract: ExpectTrue<HasVisualSignalsAnomalyScore> = true

describe("snapshotLike shared alignment type contract (red)", () => {
  it("documents contract assertions for SnapshotLike", () => {
    expect(pageMetadataContract).toBe(true)
    expect(metaCoverageContract).toBe(true)
    expect(unionNodeKindContract).toBe(true)
    expect(unionNodeControlTypeContract).toBe(true)
    expect(visualSignalsIntersectionContract).toBe(true)
    expect(visualSignalsUiSuspiciousContract).toBe(true)
    expect(visualSignalsAnomalyScoreContract).toBe(true)
  })
})
