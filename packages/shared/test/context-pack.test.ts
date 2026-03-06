import { describe, expect, it } from "vitest"
import {
  buildContextPack,
  type SemanticSnapshot
} from "../src"
import { renderCompactJson, renderLinearText } from "../src/projection-policy"

function buildThreadSnapshot(): SemanticSnapshot {
  return {
    page: {
      id: "hn-thread-1",
      url: "https://news.ycombinator.com/item?id=1",
      title: "Thread Title",
      kind: "thread"
    },
    focus: {
      nodeId: "comment-c2",
      region: "comment-tree",
      node: {
        kind: "comment",
        id: "comment-c2",
        text: "focused child",
        depth: 1,
        parentId: "comment-c1",
        author: "bob",
        timestamp: "2 hours ago"
      }
    },
    context: [
      {
        relation: "parent",
        distance: 1,
        node: {
          kind: "comment",
          id: "comment-c1",
          text: "parent",
          depth: 0,
          author: "alice",
          timestamp: "3 hours ago"
        }
      },
      {
        relation: "ancestor",
        distance: 2,
        node: {
          kind: "comment",
          id: "comment-root",
          text: "root",
          depth: 0,
          author: "rooter",
          timestamp: "5 hours ago"
        }
      },
      {
        relation: "child",
        distance: 1,
        node: {
          kind: "comment",
          id: "comment-c3",
          text: "direct child",
          depth: 2,
          parentId: "comment-c2",
          author: "carol",
          timestamp: "1 hour ago"
        }
      },
      {
        relation: "child",
        distance: 2,
        node: {
          kind: "comment",
          id: "comment-c4",
          text: "deep child",
          depth: 3,
          parentId: "comment-c3",
          author: "dave",
          timestamp: "30 minutes ago"
        }
      },
      {
        relation: "sibling",
        distance: 1,
        node: {
          kind: "comment",
          id: "comment-c5",
          text: "peer",
          depth: 1,
          parentId: "comment-c1",
          author: "erin",
          timestamp: "45 minutes ago"
        }
      }
    ],
    meta: {
      capturedAt: "2026-03-06T00:00:00.000Z",
      skeletonVersion: 3,
      extractorId: "hackernews",
      coverage: {
        kind: "focus-branch",
        rootNodeId: "comment-root",
        capturedNodeCount: 5,
        omittedNodeCount: 2,
        omittedRootCount: 4
      }
    }
  }
}

describe("ContextPack", () => {
  it("builds grouped branch context with root-first ancestors", () => {
    const pack = buildContextPack(buildThreadSnapshot())

    expect(pack.scope).toEqual({
      kind: "focus-branch",
      rootNodeId: "comment-root",
      focusNodeId: "comment-c2"
    })
    expect(pack.groups.ancestors.map((node) => node.id)).toEqual(["comment-root", "comment-c1"])
    expect(pack.groups.descendants.map((node) => node.id)).toEqual(["comment-c3", "comment-c4"])
    expect(pack.groups.siblings.map((node) => node.id)).toEqual(["comment-c5"])
    expect(pack.omitted).toEqual({
      nodeCount: 2,
      rootCount: 4,
      note: "Only the focus-branch semantic scope is included."
    })
  })

  it("filters deep relatives out of reply-assist projections", () => {
    const pack = buildContextPack(buildThreadSnapshot())
    const compact = JSON.parse(renderCompactJson(pack, "reply-assist"))

    expect(compact.groups.ancestors.map((node: { id: string }) => node.id)).toEqual(["comment-c1"])
    expect(compact.groups.descendants.map((node: { id: string }) => node.id)).toEqual(["comment-c3"])
    expect(compact.groups.siblings.map((node: { id: string }) => node.id)).toEqual(["comment-c5"])
  })

  it("omits siblings from claim-extraction projections and renders legacy coverage warnings", () => {
    const snapshot = buildThreadSnapshot()
    delete snapshot.meta.coverage
    const pack = buildContextPack(snapshot)
    const linear = renderLinearText(pack, "claim-extraction")

    expect(pack.omitted.note).toBe("Coverage metadata unavailable.")
    expect(linear).toContain("Ancestors")
    expect(linear).toContain("Descendants")
    expect(linear).not.toContain("Siblings")
  })

  it("renders interactive focus nodes with control metadata", () => {
    const pack = buildContextPack({
      page: {
        id: "search-page",
        url: "https://example.com/search",
        title: "Search",
        kind: "generic"
      },
      focus: {
        nodeId: "interactive-2",
        region: "interactive-block-1",
        node: {
          kind: "interactive",
          id: "interactive-2",
          controlType: "input",
          label: "Search docs",
          action: "search",
          valuePreview: "rate limiter"
        }
      },
      context: [
        {
          relation: "parent",
          distance: 1,
          node: {
            kind: "interactive",
            id: "interactive-1",
            controlType: "group",
            label: "Search",
            action: "search"
          }
        }
      ],
      meta: {
        capturedAt: "2026-03-06T00:00:00.000Z",
        skeletonVersion: 1,
        extractorId: "generic-semantic",
        coverage: {
          kind: "focus-section",
          rootNodeId: "interactive-1",
          capturedNodeCount: 2,
          omittedNodeCount: 0,
          omittedRootCount: 0
        }
      }
    })

    const compact = JSON.parse(renderCompactJson(pack, "branch-summary"))
    const linear = renderLinearText(pack, "branch-summary")

    expect(compact.focus.controlType).toBe("input")
    expect(compact.focus.action).toBe("search")
    expect(compact.focus.valuePreview).toBe("rate limiter")
    expect(linear).toContain("input, search")
  })
})
