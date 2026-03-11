import { describe, expect, it } from "vitest"
import { buildVisualSummariesFromSnapshot } from "../../src/session/visual/summary"
import { buildSemanticSnapshot } from "../http/helpers/payloads"

describe("buildVisualSummariesFromSnapshot", () => {
  it("does not misclassify toolbar/sidebar UI as chart-summary", () => {
    const snapshot = buildSemanticSnapshot()
    snapshot.page.title = "Workspace sidebar settings"
    snapshot.focus.region = "top-toolbar"
    snapshot.focus.node = {
      id: "toolbar-button",
      kind: "button",
      label: "Sort toolbar",
      text: "Open sidebar settings"
    }

    const summaries = buildVisualSummariesFromSnapshot(snapshot)

    expect(summaries).toHaveLength(1)
    expect(summaries[0]?.kind).toBe("ui-visual-summary")
  })

  it("classifies standalone chart keywords as chart-summary", () => {
    const snapshot = buildSemanticSnapshot()
    snapshot.page.title = "Quarterly bar chart"
    snapshot.focus.node = {
      id: "chart-caption",
      kind: "image",
      label: "Revenue by quarter",
      text: "Bar chart comparing revenue and cost"
    }

    const summaries = buildVisualSummariesFromSnapshot(snapshot)

    expect(summaries).toHaveLength(1)
    expect(summaries[0]?.kind).toBe("chart-summary")
    expect(summaries[0]?.chart?.chartType).toBe("bar")
  })
})
