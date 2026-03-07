import type { SemanticSnapshot } from "@threadatlas/shared"
import type { ServiceWorkerToContentMessage } from "@threadatlas/shared/runtime"
import { describe, expect, it, vi } from "vitest"
import { createSemanticSnapshotCoordinator } from "../src/background/semantic-snapshot"
import type { RegionDump } from "../src/content/semantic/core/observability"

const snapshot: SemanticSnapshot = {
  page: {
    id: "hn-thread-1",
    url: "https://news.ycombinator.com/item?id=1",
    title: "Thread Title",
    kind: "thread" as const
  },
  focus: {
    nodeId: "comment-c1",
    node: {
      kind: "comment",
      id: "comment-c1",
      text: "hello",
      depth: 0
    },
    region: "comment-tree"
  },
  context: [],
  meta: {
    capturedAt: new Date().toISOString(),
    skeletonVersion: 1,
    extractorId: "hackernews"
  }
}

const regionDump: RegionDump = {
  url: "https://news.ycombinator.com/item?id=1",
  timestamp: "2026-03-06T00:00:00.000Z",
  regions: [
    {
      id: "comment-tree",
      primitive: "repeated-item",
      subtype: "nested",
      category: "discussion.thread",
      layoutRole: "main-content",
      dominanceScore: 1,
      roleRank: "primary",
      suppressed: false,
      autoSuppressed: false,
      explicitSelectionAllowed: true,
      confidence: 0.92,
      signals: ["depth-variation", "repeated-rows"],
      nodeCount: 4,
      textLength: 80,
      assembledItemCount: 0,
      normalizedKind: "thread",
      boundingRect: {
        top: 0,
        left: 0,
        right: 100,
        bottom: 100,
        width: 100,
        height: 100,
        x: 0,
        y: 0
      }
    }
  ],
  decisions: {
    overlapResolutions: [],
    assemblyMerges: [],
    suppressions: []
  }
}

describe("semantic snapshot coordinator", () => {
  it("captures the active tab, stores latest snapshot, and emits history updates", async () => {
    const sendToContentScript = vi.fn(async (_tabId: number, message: ServiceWorkerToContentMessage) => {
      if (message.type === "CAPTURE_SEMANTIC_SNAPSHOT") {
        return {
          snapshot,
          error: null
        }
      }

      return { enabled: false, selectedTarget: null }
    })
    const notifyRuntime = vi.fn()

    const coordinator = createSemanticSnapshotCoordinator({
      async getActiveTab() {
        return {
          id: 7,
          url: "https://news.ycombinator.com/item?id=7"
        }
      },
      async getTab(tabId) {
        return {
          id: tabId,
          url: `https://news.ycombinator.com/item?id=${tabId}`
        }
      },
      sendToContentScript,
      openSidePanel: vi.fn(async () => {}),
      notifyRuntime
    })

    const payload = await coordinator.captureActiveTab(undefined, "popup", { openPanel: false })
    const latest = await coordinator.getLatest(7)
    const history = await coordinator.getHistory(7)

    expect(sendToContentScript).toHaveBeenCalledWith(7, {
      type: "CAPTURE_SEMANTIC_SNAPSHOT",
      payload: { source: "popup" }
    })
    expect(payload.snapshot).toEqual(snapshot)
    expect(latest.snapshot).toEqual(snapshot)
    expect(history.snapshots).toEqual([snapshot])
    expect(notifyRuntime).toHaveBeenCalledWith({
      type: "SEMANTIC_SNAPSHOT_HISTORY_UPDATED",
      payload: {
        tabId: 7,
        snapshots: [snapshot]
      }
    })
  })

  it("returns an error for unsupported tabs without messaging content scripts", async () => {
    const sendToContentScript = vi.fn()

    const coordinator = createSemanticSnapshotCoordinator({
      async getActiveTab() {
        return {
          id: 3,
          url: "chrome://extensions"
        }
      },
      async getTab(tabId) {
        return {
          id: tabId,
          url: "chrome://extensions"
        }
      },
      sendToContentScript,
      openSidePanel: vi.fn(async () => {}),
      notifyRuntime: vi.fn()
    })

    const payload = await coordinator.captureActiveTab(undefined, "command", { openPanel: false })
    expect(payload.snapshot).toBeNull()
    expect(payload.error).toContain("standard web pages")
    expect(sendToContentScript).not.toHaveBeenCalled()
  })

  it("toggles and reads cached selection state", async () => {
    const sendToContentScript = vi.fn(async (_tabId: number, message: ServiceWorkerToContentMessage) => {
      if (message.type === "TOGGLE_SEMANTIC_SELECTION") {
        return { enabled: true, selectedTarget: null }
      }

      return { enabled: true, selectedTarget: null }
    })

    const coordinator = createSemanticSnapshotCoordinator({
      async getActiveTab() {
        return {
          id: 11,
          url: "https://example.com/article"
        }
      },
      async getTab(tabId) {
        return {
          id: tabId,
          url: "https://example.com/article"
        }
      },
      sendToContentScript,
      openSidePanel: vi.fn(async () => {}),
      notifyRuntime: vi.fn()
    })

    const toggled = await coordinator.toggleSelectionMode()
    const read = await coordinator.getSelectionState()

    expect(toggled.enabled).toBe(true)
    expect(toggled.selectedTarget).toBeNull()
    expect(read.enabled).toBe(true)
    expect(read.selectedTarget).toBeNull()
  })

  it("loads the current region dump for supported tabs", async () => {
    const sendToContentScript = vi.fn(async (_tabId: number, message: ServiceWorkerToContentMessage) => {
      if (message.type === "GET_SEMANTIC_REGION_DUMP") {
        return { dump: regionDump }
      }

      return { enabled: false, selectedTarget: null }
    })

    const coordinator = createSemanticSnapshotCoordinator({
      async getActiveTab() {
        return {
          id: 13,
          url: "https://news.ycombinator.com/item?id=13"
        }
      },
      async getTab(tabId) {
        return {
          id: tabId,
          url: "https://news.ycombinator.com/item?id=13"
        }
      },
      sendToContentScript,
      openSidePanel: vi.fn(async () => {}),
      notifyRuntime: vi.fn()
    })

    const payload = await coordinator.getRegionDump()

    expect(sendToContentScript).toHaveBeenCalledWith(13, {
      type: "GET_SEMANTIC_REGION_DUMP"
    })
    expect(payload.dump).toEqual(regionDump)
    expect(payload.error).toBeNull()
  })
})
