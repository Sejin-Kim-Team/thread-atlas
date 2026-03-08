export function buildSemanticSnapshot() {
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
        id: "comment-43210091",
        kind: "comment",
        author: "alice",
        text: "WebSocket is better for interruption and bidirectional updates.",
        depth: 1
      },
      region: "comment-tree"
    },
    context: [
      {
        relation: "parent",
        distance: 1,
        node: {
          id: "comment-43210010",
          kind: "comment",
          text: "Is SSE enough?",
          depth: 0
        }
      }
    ],
    meta: {
      capturedAt: "2026-03-07T14:00:01.500Z",
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

export function buildAnalyzeRequest(mode: "seed" | "memory-candidate" | "visual-summary" = "seed") {
  return {
    tabId: 128,
    mode,
    snapshot: buildSemanticSnapshot(),
    providedPack: {
      version: 1,
      scope: {
        kind: "focus-branch",
        rootNodeId: "comment-43210010",
        focusNodeId: "comment-43210091"
      },
      page: {
        id: "hn-43210000",
        url: "https://news.ycombinator.com/item?id=43210000",
        title: "Ask HN: WebSocket vs SSE",
        kind: "thread",
        metadata: {
          site: "hacker-news"
        }
      },
      focus: {
        id: "comment-43210091",
        kind: "comment",
        relation: "focus",
        distance: 0,
        text: "WebSocket is better for interruption and bidirectional updates.",
        author: "alice",
        depth: 1
      },
      groups: {
        ancestors: [],
        descendants: [],
        siblings: [],
        containers: []
      },
      omitted: {
        nodeCount: 2,
        rootCount: 1,
        note: "collapsed replies"
      },
      provenance: {
        extractorId: "generic+hacker-news-enhancer",
        capturedAt: "2026-03-07T14:00:01.500Z",
        skeletonVersion: 12
      }
    }
  }
}

export function buildStorableMemoryRecord(ownerUserId = "user_sungwoo") {
  return {
    id: randomUUID(),
    ownerUserId,
    kind: "branch-summary",
    summary:
      "This branch prefers WebSocket because interruption and bidirectional updates are first-class.",
    keywords: ["websocket", "sse", "interruption", "bidirectional"],
    entities: ["WebSocket", "SSE"],
    provenance: {
      sourceUrl: "https://news.ycombinator.com/item?id=43199999",
      pageKind: "thread",
      snapshotCapturedAt: "2026-03-05T09:10:00.000Z",
      extractorId: "generic+hacker-news-enhancer",
      skeletonVersion: 8
    },
    source: {
      pageId: "hn-43199999",
      rootNodeIds: ["comment-43199977"],
      unitId: "branch-43199977"
    },
    navigation: {
      canonicalUrl: "https://news.ycombinator.com/item?id=43199999",
      pageTitle: "Show HN: Live Voice Browser Assistant",
      nodeAnchor: {
        commentId: "comment-43199977",
        textQuote: "bidirectional update and interrupt handling"
      },
      openMode: "new-tab"
    },
    evidence: {
      textSpans: [
        "bidirectional update and interrupt handling",
        "WebSocket fits better than SSE"
      ],
      referencedNodeIds: ["comment-43199977", "comment-43199990"]
    },
    createdAt: "2026-03-05T09:12:00.000Z"
  }
}

export function buildIngestMemoryRequest(ownerUserId = "user_sungwoo") {
  return {
    source: "analyze",
    records: [buildStorableMemoryRecord(ownerUserId)]
  }
}
import { randomUUID } from "node:crypto"
