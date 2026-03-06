import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  bindPopupActions,
  renderPopupSelectionState,
  renderPopupSnapshotState
} from "../src/popup/index"

describe("popup ui", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button id="popup-capture-button" type="button">Capture Snapshot</button>
      <button id="popup-copy-button" type="button">Copy JSON</button>
      <button id="popup-open-sidepanel-button" type="button">Open Sidepanel</button>
      <button id="popup-selection-button" type="button">Selection Off</button>
      <div id="popup-status"></div>
      <pre id="popup-summary"></pre>
    `
  })

  it("renders snapshot summary and selection state", () => {
    const onCapture = vi.fn()
    const onCopy = vi.fn()
    const onOpenSidepanel = vi.fn()
    const onToggleSelection = vi.fn()

    bindPopupActions({
      onCapture,
      onCopy,
      onOpenSidepanel,
      onToggleSelection
    })

    document.getElementById("popup-capture-button")?.dispatchEvent(new MouseEvent("click"))
    document.getElementById("popup-copy-button")?.dispatchEvent(new MouseEvent("click"))
    document.getElementById("popup-open-sidepanel-button")?.dispatchEvent(new MouseEvent("click"))
    document.getElementById("popup-selection-button")?.dispatchEvent(new MouseEvent("click"))

    renderPopupSnapshotState({
      tabId: 7,
      snapshot: {
        page: {
          id: "article-example.com",
          url: "https://example.com",
          title: "Example",
          kind: "article"
        },
        focus: {
          nodeId: "article-node-1",
          node: {
            kind: "content",
            id: "article-node-1",
            type: "heading",
            text: "Example"
          },
          region: "article-body"
        },
        context: [],
        meta: {
          capturedAt: "2026-03-06T00:00:00.000Z",
          skeletonVersion: 1,
          extractorId: "generic-article"
        }
      },
      error: null
    })
    renderPopupSelectionState({
      tabId: 7,
      enabled: true,
      selectedTarget: {
        regionId: "article-body",
        primitive: "authored-block",
        category: "content.article",
        nodeKind: "content",
        nodeId: "article-node-1",
        rootNodeId: "article-node-1",
        scopeRootId: "article-node-1",
        label: "Article Node",
        displayLabel: "Article section",
        text: "Example"
      }
    })

    expect(onCapture).toHaveBeenCalledTimes(1)
    expect(onCopy).toHaveBeenCalledTimes(1)
    expect(onOpenSidepanel).toHaveBeenCalledTimes(1)
    expect(onToggleSelection).toHaveBeenCalledTimes(1)
    expect(document.getElementById("popup-status")?.textContent).toContain("Latest")
    expect(document.getElementById("popup-summary")?.textContent).toContain("\"article-body\"")
    expect(document.getElementById("popup-selection-button")?.textContent).toContain("On")
  })
})
