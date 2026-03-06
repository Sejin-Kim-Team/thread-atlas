import type { CanonicalRegionDump, ScenarioScorecard } from "../../src/content/semantic/core/observability"
import type { CorpusScenarioId } from "./scenarios"

export const CORPUS_EXPECTATIONS: Record<
  CorpusScenarioId,
  {
    dump: CanonicalRegionDump
    scorecard: ScenarioScorecard
  }
> = {
  "hn-front": {
    "dump": {
      "url": "https://news.ycombinator.com/",
      "regions": [
        {
          "id": "authored-block-1",
          "primitive": "authored-block",
          "subtype": "post",
          "category": "content.post",
          "layoutRole": "main-content",
          "roleRank": "primary",
          "suppressed": false,
          "confidence": 0.82,
          "nodeCount": 3,
          "textLength": 78,
          "assembledItemCount": 0,
          "normalizedKind": "article"
        },
        {
          "id": "interactive-block-1",
          "primitive": "interactive-block",
          "subtype": "search",
          "category": "interactive.search",
          "layoutRole": "search-bar",
          "roleRank": "peripheral",
          "suppressed": true,
          "confidence": 0.9,
          "nodeCount": 2,
          "textLength": 18,
          "assembledItemCount": 0
        },
        {
          "id": "navigation-cluster-1",
          "primitive": "navigation-cluster",
          "subtype": "global",
          "category": "navigation.menu",
          "layoutRole": "global-nav",
          "roleRank": "peripheral",
          "suppressed": true,
          "confidence": 0.76,
          "nodeCount": 3,
          "textLength": 12,
          "assembledItemCount": 0
        },
        {
          "id": "navigation-cluster-2",
          "primitive": "navigation-cluster",
          "subtype": "global",
          "category": "navigation.menu",
          "layoutRole": "global-nav",
          "roleRank": "peripheral",
          "suppressed": true,
          "confidence": 0.94,
          "nodeCount": 3,
          "textLength": 12,
          "assembledItemCount": 0
        },
        {
          "id": "navigation-cluster-3",
          "primitive": "navigation-cluster",
          "subtype": "global",
          "category": "navigation.menu",
          "layoutRole": "footer-resources",
          "roleRank": "peripheral",
          "suppressed": true,
          "confidence": 0.76,
          "nodeCount": 3,
          "textLength": 18,
          "assembledItemCount": 0
        },
        {
          "id": "navigation-cluster-4",
          "primitive": "navigation-cluster",
          "subtype": "global",
          "category": "navigation.menu",
          "layoutRole": "footer-resources",
          "roleRank": "peripheral",
          "suppressed": true,
          "confidence": 0.94,
          "nodeCount": 3,
          "textLength": 18,
          "assembledItemCount": 0
        },
        {
          "id": "repeated-item-1",
          "primitive": "repeated-item",
          "subtype": "flat",
          "category": "content.post",
          "layoutRole": "main-content",
          "roleRank": "supporting",
          "suppressed": false,
          "confidence": 0.74,
          "nodeCount": 3,
          "textLength": 31,
          "assembledItemCount": 3,
          "normalizedKind": "card"
        }
      ]
    },
    "scorecard": {
      "regionCount": 7,
      "suppressedCount": 5,
      "repeatedItemAssemblyCount": 3,
      "primitiveCounts": {
        "authored-block": 1,
        "interactive-block": 1,
        "navigation-cluster": 4,
        "repeated-item": 1
      },
      "layoutRoleCounts": {
        "footer-resources": 2,
        "global-nav": 2,
        "main-content": 2,
        "search-bar": 1
      },
      "normalizedKindCounts": {
        "article": 1,
        "card": 1
      }
    }
  },
  "hn-item": {
    "dump": {
      "url": "https://news.ycombinator.com/item?id=123",
      "regions": [
        {
          "id": "authored-block-1",
          "primitive": "authored-block",
          "subtype": "post",
          "category": "content.post",
          "layoutRole": "main-content",
          "roleRank": "supporting",
          "suppressed": false,
          "confidence": 0.82,
          "nodeCount": 3,
          "textLength": 73,
          "assembledItemCount": 0,
          "normalizedKind": "article"
        },
        {
          "id": "repeated-item-1",
          "primitive": "repeated-item",
          "subtype": "nested",
          "category": "discussion.thread",
          "layoutRole": "main-content",
          "roleRank": "primary",
          "suppressed": false,
          "confidence": 0.92,
          "nodeCount": 4,
          "textLength": 63,
          "assembledItemCount": 0,
          "normalizedKind": "thread"
        }
      ]
    },
    "scorecard": {
      "regionCount": 2,
      "suppressedCount": 0,
      "repeatedItemAssemblyCount": 0,
      "primitiveCounts": {
        "authored-block": 1,
        "repeated-item": 1
      },
      "layoutRoleCounts": {
        "main-content": 2
      },
      "normalizedKindCounts": {
        "article": 1,
        "thread": 1
      }
    }
  },
  "docs-landing": {
    "dump": {
      "url": "https://example.com/docs",
      "regions": [
        {
          "id": "authored-block-1",
          "primitive": "authored-block",
          "subtype": "post",
          "category": "content.post",
          "layoutRole": "main-content",
          "roleRank": "primary",
          "suppressed": false,
          "confidence": 0.82,
          "nodeCount": 3,
          "textLength": 170,
          "assembledItemCount": 0,
          "normalizedKind": "article"
        },
        {
          "id": "interactive-block-1",
          "primitive": "interactive-block",
          "subtype": "search",
          "category": "interactive.search",
          "layoutRole": "search-bar",
          "roleRank": "peripheral",
          "suppressed": true,
          "confidence": 0.9,
          "nodeCount": 3,
          "textLength": 23,
          "assembledItemCount": 0
        },
        {
          "id": "navigation-cluster-2",
          "primitive": "navigation-cluster",
          "subtype": "global",
          "category": "navigation.menu",
          "layoutRole": "global-nav",
          "roleRank": "peripheral",
          "suppressed": true,
          "confidence": 0.94,
          "nodeCount": 3,
          "textLength": 15,
          "assembledItemCount": 0
        },
        {
          "id": "navigation-cluster-3",
          "primitive": "navigation-cluster",
          "subtype": "local",
          "category": "navigation.menu",
          "layoutRole": "section-nav",
          "roleRank": "supporting",
          "suppressed": true,
          "confidence": 0.76,
          "nodeCount": 3,
          "textLength": 13,
          "assembledItemCount": 0
        },
        {
          "id": "navigation-cluster-4",
          "primitive": "navigation-cluster",
          "subtype": "local",
          "category": "navigation.menu",
          "layoutRole": "section-nav",
          "roleRank": "supporting",
          "suppressed": true,
          "confidence": 0.94,
          "nodeCount": 3,
          "textLength": 13,
          "assembledItemCount": 0
        },
        {
          "id": "navigation-cluster-5",
          "primitive": "navigation-cluster",
          "subtype": "global",
          "category": "navigation.menu",
          "layoutRole": "footer-resources",
          "roleRank": "peripheral",
          "suppressed": true,
          "confidence": 0.76,
          "nodeCount": 3,
          "textLength": 20,
          "assembledItemCount": 0
        },
        {
          "id": "navigation-cluster-6",
          "primitive": "navigation-cluster",
          "subtype": "global",
          "category": "navigation.menu",
          "layoutRole": "footer-resources",
          "roleRank": "peripheral",
          "suppressed": true,
          "confidence": 0.94,
          "nodeCount": 3,
          "textLength": 20,
          "assembledItemCount": 0
        },
        {
          "id": "repeated-item-1",
          "primitive": "repeated-item",
          "subtype": "grid",
          "category": "content.post",
          "layoutRole": "main-content",
          "roleRank": "supporting",
          "suppressed": false,
          "confidence": 0.8,
          "nodeCount": 3,
          "textLength": 40,
          "assembledItemCount": 3,
          "normalizedKind": "card"
        }
      ]
    },
    "scorecard": {
      "regionCount": 8,
      "suppressedCount": 6,
      "repeatedItemAssemblyCount": 3,
      "primitiveCounts": {
        "authored-block": 1,
        "interactive-block": 1,
        "navigation-cluster": 5,
        "repeated-item": 1
      },
      "layoutRoleCounts": {
        "footer-resources": 2,
        "global-nav": 1,
        "main-content": 2,
        "search-bar": 1,
        "section-nav": 2
      },
      "normalizedKindCounts": {
        "article": 1,
        "card": 1
      }
    }
  },
  "docs-article": {
    "dump": {
      "url": "https://example.com/docs/guide/pipeline",
      "regions": [
        {
          "id": "authored-block-1",
          "primitive": "authored-block",
          "subtype": "article",
          "category": "content.article",
          "layoutRole": "main-content",
          "roleRank": "primary",
          "suppressed": false,
          "confidence": 0.95,
          "nodeCount": 6,
          "textLength": 304,
          "assembledItemCount": 0,
          "normalizedKind": "article"
        },
        {
          "id": "navigation-cluster-1",
          "primitive": "navigation-cluster",
          "subtype": "global",
          "category": "navigation.menu",
          "layoutRole": "global-nav",
          "roleRank": "peripheral",
          "suppressed": true,
          "confidence": 0.76,
          "nodeCount": 2,
          "textLength": 8,
          "assembledItemCount": 0
        },
        {
          "id": "navigation-cluster-2",
          "primitive": "navigation-cluster",
          "subtype": "global",
          "category": "navigation.menu",
          "layoutRole": "global-nav",
          "roleRank": "peripheral",
          "suppressed": true,
          "confidence": 0.94,
          "nodeCount": 2,
          "textLength": 8,
          "assembledItemCount": 0
        },
        {
          "id": "navigation-cluster-3",
          "primitive": "navigation-cluster",
          "subtype": "local",
          "category": "navigation.menu",
          "layoutRole": "section-nav",
          "roleRank": "supporting",
          "suppressed": true,
          "confidence": 0.76,
          "nodeCount": 3,
          "textLength": 19,
          "assembledItemCount": 0
        },
        {
          "id": "navigation-cluster-4",
          "primitive": "navigation-cluster",
          "subtype": "local",
          "category": "navigation.menu",
          "layoutRole": "section-nav",
          "roleRank": "supporting",
          "suppressed": true,
          "confidence": 0.94,
          "nodeCount": 3,
          "textLength": 19,
          "assembledItemCount": 0
        },
        {
          "id": "navigation-cluster-5",
          "primitive": "navigation-cluster",
          "subtype": "global",
          "category": "navigation.menu",
          "layoutRole": "footer-resources",
          "roleRank": "peripheral",
          "suppressed": true,
          "confidence": 0.76,
          "nodeCount": 2,
          "textLength": 15,
          "assembledItemCount": 0
        },
        {
          "id": "navigation-cluster-6",
          "primitive": "navigation-cluster",
          "subtype": "global",
          "category": "navigation.menu",
          "layoutRole": "footer-resources",
          "roleRank": "peripheral",
          "suppressed": true,
          "confidence": 0.94,
          "nodeCount": 2,
          "textLength": 15,
          "assembledItemCount": 0
        }
      ]
    },
    "scorecard": {
      "regionCount": 7,
      "suppressedCount": 6,
      "repeatedItemAssemblyCount": 0,
      "primitiveCounts": {
        "authored-block": 1,
        "navigation-cluster": 6
      },
      "layoutRoleCounts": {
        "footer-resources": 2,
        "global-nav": 2,
        "main-content": 1,
        "section-nav": 2
      },
      "normalizedKindCounts": {
        "article": 1
      }
    }
  },
  "search-grid": {
    "dump": {
      "url": "https://example.com/search",
      "regions": [
        {
          "id": "repeated-item-1",
          "primitive": "repeated-item",
          "subtype": "grid",
          "category": "content.post",
          "layoutRole": "main-content",
          "roleRank": "primary",
          "suppressed": false,
          "confidence": 0.8,
          "nodeCount": 3,
          "textLength": 32,
          "assembledItemCount": 3,
          "normalizedKind": "card"
        }
      ]
    },
    "scorecard": {
      "regionCount": 1,
      "suppressedCount": 0,
      "repeatedItemAssemblyCount": 3,
      "primitiveCounts": {
        "repeated-item": 1
      },
      "layoutRoleCounts": {
        "main-content": 1
      },
      "normalizedKindCounts": {
        "card": 1
      }
    }
  },
  "prose-list-negative": {
    "dump": {
      "url": "https://example.com/blog/semantic-systems",
      "regions": [
        {
          "id": "authored-block-1",
          "primitive": "authored-block",
          "subtype": "post",
          "category": "content.post",
          "layoutRole": "main-content",
          "roleRank": "primary",
          "suppressed": false,
          "confidence": 0.95,
          "nodeCount": 5,
          "textLength": 417,
          "assembledItemCount": 0,
          "normalizedKind": "article"
        },
        {
          "id": "navigation-cluster-1",
          "primitive": "navigation-cluster",
          "subtype": "global",
          "category": "navigation.menu",
          "layoutRole": "global-nav",
          "roleRank": "peripheral",
          "suppressed": true,
          "confidence": 0.76,
          "nodeCount": 4,
          "textLength": 130,
          "assembledItemCount": 0
        }
      ]
    },
    "scorecard": {
      "regionCount": 2,
      "suppressedCount": 1,
      "repeatedItemAssemblyCount": 0,
      "primitiveCounts": {
        "authored-block": 1,
        "navigation-cluster": 1
      },
      "layoutRoleCounts": {
        "global-nav": 1,
        "main-content": 1
      },
      "normalizedKindCounts": {
        "article": 1
      }
    }
  }
}
