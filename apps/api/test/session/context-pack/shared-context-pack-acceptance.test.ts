import { describe, expect, it } from "vitest"
import type { SemanticSnapshot } from "@threadatlas/shared/domain"
import { buildCanonicalContextPack } from "../../../src/session/context-pack/build"

function buildSnapshotForContextPack(): SemanticSnapshot {
  return {
    page: {
      id: "doc-100",
      url: "https://example.com/ui-debug",
      title: "UI Debug",
      kind: "article",
      metadata: {
        source: "example"
      }
    },
    focus: {
      nodeId: "ctrl-1",
      node: {
        kind: "interactive",
        id: "ctrl-1",
        controlType: "button",
        label: "Apply Filter",
        action: "filter",
        state: "expanded",
        role: "button"
      },
      region: "toolbar"
    },
    context: [
      {
        relation: "ancestor",
        distance: 1,
        node: {
          kind: "content",
          id: "section-1",
          type: "heading",
          text: "Controls"
        }
      }
    ],
    meta: {
      capturedAt: "2026-03-08T12:30:00.000Z",
      skeletonVersion: 3,
      extractorId: "generic-runtime",
      coverage: {
        kind: "focus-section",
        rootNodeId: "section-1",
        capturedNodeCount: 4,
        omittedNodeCount: 2,
        omittedRootCount: 1
      }
    }
  }
}

describe("shared ContextPack acceptance", () => {
  it("preserves shared scope/groups/omitted shape when building canonical pack", () => {
    const snapshot = buildSnapshotForContextPack()
    const actual = buildCanonicalContextPack(snapshot) as Record<string, unknown>

    expect(actual.scope).toBeDefined()
    expect(actual.groups).toBeDefined()
    expect(actual.omitted).toBeDefined()
  })
})

