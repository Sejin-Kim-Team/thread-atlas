import type { SemanticSnapshot } from "@threadatlas/shared"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  bindSemanticSnapshotActions,
  renderSemanticSnapshot,
  setSemanticSnapshotBusy
} from "../src/sidepanel/ui"

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
      depth: 0,
      author: "alice",
      timestamp: "1 hour ago"
    },
    region: "comment-tree"
  },
  context: [
    {
      relation: "container" as const,
      node: {
        kind: "content",
        id: "story-title",
        type: "heading" as const,
        text: "Thread Title",
        level: 1
      },
      distance: 1
    }
  ],
  meta: {
    capturedAt: "2026-03-06T00:00:00.000Z",
    skeletonVersion: 1,
    extractorId: "hackernews"
  }
}

describe("sidepanel semantic snapshot ui", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button id="semantic-capture-button" type="button">Capture Snapshot</button>
      <button id="semantic-copy-button" type="button">Copy JSON</button>
      <button id="semantic-selection-button" type="button">Selection Off</button>
      <button id="semantic-selection-clear-button" type="button">Clear Selection</button>
      <button id="semantic-raw-toggle-button" type="button">Show Raw JSON</button>
      <button id="semantic-context-copy-button" type="button">Copy LLM Context</button>
      <select id="semantic-context-profile">
        <option value="branch-summary">branch-summary</option>
        <option value="reply-assist">reply-assist</option>
        <option value="claim-extraction">claim-extraction</option>
      </select>
      <button id="semantic-context-pack-tab" type="button">Context Pack</button>
      <button id="semantic-context-compact-tab" type="button">Compact JSON</button>
      <button id="semantic-context-linear-tab" type="button">Linear Text</button>
      <div id="semantic-snapshot-status"></div>
      <div id="semantic-page-summary"></div>
      <div id="semantic-focus-detail"></div>
      <div id="semantic-context-groups"></div>
      <div id="semantic-history-list"></div>
      <div id="semantic-selection-status"></div>
      <div id="semantic-selection-detail"></div>
      <div id="semantic-context-status"></div>
      <pre id="semantic-context-preview"></pre>
      <pre id="semantic-snapshot-json" class="hidden"></pre>
    `
  })

  it("renders viewer sections and binds actions", () => {
    const onCapture = vi.fn()
    const onCopy = vi.fn()
    const onCopyContext = vi.fn()
    const onToggleSelection = vi.fn()
    const onClearSelection = vi.fn()
    const onToggleRaw = vi.fn()
    const onSelectHistory = vi.fn()
    const onSelectContextProfile = vi.fn()
    const onSelectContextFormat = vi.fn()

    bindSemanticSnapshotActions({
      onCapture,
      onCopy,
      onCopyContext,
      onToggleSelection,
      onClearSelection,
      onToggleRaw,
      onSelectHistory,
      onSelectContextProfile,
      onSelectContextFormat
    })

    document.getElementById("semantic-capture-button")?.dispatchEvent(new MouseEvent("click"))
    document.getElementById("semantic-copy-button")?.dispatchEvent(new MouseEvent("click"))
    document.getElementById("semantic-context-copy-button")?.dispatchEvent(new MouseEvent("click"))
    document.getElementById("semantic-selection-button")?.dispatchEvent(new MouseEvent("click"))
    document.getElementById("semantic-selection-clear-button")?.dispatchEvent(new MouseEvent("click"))
    document.getElementById("semantic-raw-toggle-button")?.dispatchEvent(new MouseEvent("click"))
    document.getElementById("semantic-context-pack-tab")?.dispatchEvent(new MouseEvent("click"))
    document.getElementById("semantic-context-compact-tab")?.dispatchEvent(new MouseEvent("click"))
    document.getElementById("semantic-context-linear-tab")?.dispatchEvent(new MouseEvent("click"))
    const profile = document.getElementById("semantic-context-profile") as HTMLSelectElement
    profile.value = "reply-assist"
    profile.dispatchEvent(new Event("change"))

    renderSemanticSnapshot({
      snapshot,
      error: null,
      history: [snapshot],
      selectedSnapshotId: snapshot.meta.capturedAt,
      rawVisible: true,
      selectionEnabled: true,
      selectedTarget: {
        regionId: "comment-tree",
        primitive: "repeated-item",
        subtype: "nested",
        category: "discussion.comment",
        nodeKind: "comment",
        nodeId: "comment-c1",
        rootNodeId: "comment-c1",
        scopeRootId: "comment-c1",
        label: "Comment by alice",
        displayLabel: "Comment by alice",
        text: "hello"
      },
      contextProfile: "reply-assist",
      contextFormat: "compact-json",
      contextPreview: "{\n  \"scope\": \"focus-branch\"\n}",
      contextAvailable: true,
      contextStatus: "reply-assist · compact-json"
    })

    document
      .querySelector<HTMLButtonElement>("[data-snapshot-id]")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))

    expect(onCapture).toHaveBeenCalledTimes(1)
    expect(onCopy).toHaveBeenCalledTimes(1)
    expect(onCopyContext).toHaveBeenCalledTimes(1)
    expect(onToggleSelection).toHaveBeenCalledTimes(1)
    expect(onClearSelection).toHaveBeenCalledTimes(1)
    expect(onToggleRaw).toHaveBeenCalledTimes(1)
    expect(onSelectHistory).toHaveBeenCalledWith(snapshot.meta.capturedAt)
    expect(onSelectContextProfile).toHaveBeenCalledWith("reply-assist")
    expect(onSelectContextFormat).toHaveBeenCalledWith("context-pack-json")
    expect(onSelectContextFormat).toHaveBeenCalledWith("compact-json")
    expect(onSelectContextFormat).toHaveBeenCalledWith("linear-text")
    expect(document.getElementById("semantic-page-summary")?.textContent).toContain("Thread Title")
    expect(document.getElementById("semantic-focus-detail")?.textContent).toContain("alice")
    expect(document.getElementById("semantic-context-groups")?.textContent).toContain("container")
    expect(document.getElementById("semantic-selection-button")?.textContent).toContain("On")
    expect(document.getElementById("semantic-selection-detail")?.textContent).toContain("Comment by alice")
    expect(document.getElementById("semantic-snapshot-json")?.textContent).toContain("\"comment-c1\"")
    expect(document.getElementById("semantic-context-status")?.textContent).toContain("reply-assist")
    expect(document.getElementById("semantic-context-preview")?.textContent).toContain("\"scope\"")
  })

  it("updates busy and empty states", () => {
    setSemanticSnapshotBusy(true)
    expect((document.getElementById("semantic-capture-button") as HTMLButtonElement).disabled).toBe(true)

    renderSemanticSnapshot({
      snapshot: null,
      error: "Semantic snapshots are unavailable.",
      history: [],
      selectedSnapshotId: null,
      rawVisible: false,
      selectionEnabled: false,
      selectedTarget: null,
      contextProfile: "branch-summary",
      contextFormat: "context-pack-json",
      contextPreview: "No semantic snapshot selected.",
      contextAvailable: false,
      contextStatus: "No semantic snapshot selected."
    })

    expect(document.getElementById("semantic-snapshot-status")?.textContent).toContain("unavailable")
    expect(document.getElementById("semantic-history-list")?.textContent).toContain("No snapshots")
    expect(document.getElementById("semantic-snapshot-json")?.textContent).toBe("")
    expect((document.getElementById("semantic-context-copy-button") as HTMLButtonElement).disabled).toBe(true)
  })

  it("disables unsupported llm context profiles for interactive snapshots", () => {
    renderSemanticSnapshot({
      snapshot: {
        page: {
          id: "search-page",
          url: "https://example.com/search",
          title: "Search",
          kind: "generic"
        },
        focus: {
          nodeId: "interactive-2",
          node: {
            kind: "interactive",
            id: "interactive-2",
            controlType: "input",
            label: "Search docs",
            action: "search",
            valuePreview: "rate limiter"
          },
          region: "interactive-block-1"
        },
        context: [],
        meta: {
          capturedAt: "2026-03-06T00:00:00.000Z",
          skeletonVersion: 1,
          extractorId: "generic-semantic"
        }
      },
      error: null,
      history: [],
      selectedSnapshotId: null,
      rawVisible: false,
      selectionEnabled: false,
      selectedTarget: null,
      contextProfile: "branch-summary",
      contextFormat: "linear-text",
      contextPreview: "Interactive semantic snapshots currently support only the branch-summary profile.",
      contextAvailable: false,
      contextStatus: "Interactive snapshots support branch-summary only.",
      disabledContextProfiles: ["reply-assist", "claim-extraction"]
    })

    const profile = document.getElementById("semantic-context-profile") as HTMLSelectElement
    expect(profile.options[0]?.disabled).toBe(false)
    expect(profile.options[1]?.disabled).toBe(true)
    expect(profile.options[2]?.disabled).toBe(true)
    expect((document.getElementById("semantic-context-copy-button") as HTMLButtonElement).disabled).toBe(true)
  })
})
