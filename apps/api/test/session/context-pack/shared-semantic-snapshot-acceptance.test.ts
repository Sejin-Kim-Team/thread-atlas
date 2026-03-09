import { describe, expect, it } from "vitest"
import type { SemanticSnapshot } from "@threadatlas/shared"
import { buildCanonicalContextPack } from "../../../src/session/context-pack/build"
import { validateSemanticSnapshot } from "../../../src/session/context-pack/validate"

function buildSharedRichSnapshot(): SemanticSnapshot {
  return {
    page: {
      id: "hn-43210000",
      url: "https://news.ycombinator.com/item?id=43210000",
      title: "Ask HN: WebSocket vs SSE",
      kind: "thread",
      metadata: {
        site: "hacker-news",
        locale: "en-US"
      }
    },
    focus: {
      nodeId: "comment-43210091",
      node: {
        kind: "comment",
        id: "comment-43210091",
        author: "alice",
        text: "WebSocket is better for interruption and bidirectional updates.",
        depth: 1,
        parentId: "comment-43210010",
        metadata: {
          sentiment: "positive"
        }
      },
      region: "comment-tree"
    },
    context: [
      {
        relation: "parent",
        distance: 1,
        node: {
          kind: "comment",
          id: "comment-43210010",
          author: "bob",
          text: "Is SSE enough?",
          depth: 0
        }
      },
      {
        relation: "child",
        distance: 1,
        node: {
          kind: "interactive",
          id: "control-1",
          controlType: "button",
          label: "reply",
          action: "submit",
          state: "expanded",
          role: "button"
        }
      }
    ],
    meta: {
      capturedAt: "2026-03-08T11:00:00.000Z",
      skeletonVersion: 12,
      extractorId: "generic+hacker-news-enhancer",
      coverage: {
        kind: "focus-branch",
        rootNodeId: "comment-43210010",
        capturedNodeCount: 12,
        omittedNodeCount: 2,
        omittedRootCount: 1
      }
    }
  }
}

describe("shared SemanticSnapshot acceptance", () => {
  it("accepts shared snapshot with page.metadata, meta.coverage, comment/interactive fields", () => {
    const snapshot = buildSharedRichSnapshot()
    const result = validateSemanticSnapshot(snapshot)

    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it("keeps INVALID_SNAPSHOT behavior for focus id mismatch", () => {
    const snapshot = buildSharedRichSnapshot()
    snapshot.focus.nodeId = "mismatch-node-id"

    const result = validateSemanticSnapshot(snapshot)
    expect(result.ok).toBe(false)
    expect(result.errors).toContain("focus.nodeId must match focus.node.id")
  })

  it("builds canonical ContextPack with shared scope/groups/omitted fields", () => {
    const snapshot = buildSharedRichSnapshot()
    const pack = buildCanonicalContextPack(snapshot) as unknown as Record<string, unknown>

    expect(pack.version).toBe(1)
    expect(pack.scope).toBeDefined()
    expect(pack.groups).toBeDefined()
    expect(pack.omitted).toBeDefined()
  })
})
