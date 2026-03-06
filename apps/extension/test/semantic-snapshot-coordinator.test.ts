import type { SemanticSnapshot } from "@threadatlas/shared"
import type { ServiceWorkerToContentMessage } from "@threadatlas/shared/runtime"
import { describe, expect, it, vi } from "vitest"
import { createSemanticSnapshotCoordinator } from "../src/background/semantic-snapshot"

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
})
