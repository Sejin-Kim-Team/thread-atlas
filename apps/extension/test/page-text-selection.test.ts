import { beforeEach, describe, expect, it, vi } from "vitest"
import { PageTextSelectionBridge } from "../src/content/page-text-selection"

describe("PageTextSelectionBridge", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it("debounces browser selection changes and emits non-collapsed selections", () => {
    const payloads: Array<{ hasSelection: boolean; textPreview: string; timestamp: number }> = []
    const selection = {
      isCollapsed: false,
      anchorOffset: 1,
      focusOffset: 12,
      toString: () => "  Spotify DJ is shuffle with interludes.  ",
      removeAllRanges: vi.fn()
    }
    const fakeWindow = {
      setTimeout,
      clearTimeout,
      getSelection: () => selection
    } as unknown as Window

    const bridge = new PageTextSelectionBridge(document, fakeWindow, (payload) => {
      payloads.push(payload)
    })

    bridge.initialize()
    document.dispatchEvent(new Event("selectionchange"))
    vi.advanceTimersByTime(130)

    expect(payloads).toHaveLength(1)
    expect(payloads[0]?.hasSelection).toBe(true)
    expect(payloads[0]?.textPreview).toBe("Spotify DJ is shuffle with interludes.")
  })

  it("ignores collapsed selections and clears browser ranges on command", () => {
    const payloads: Array<{ hasSelection: boolean; textPreview: string; timestamp: number }> = []
    const removeAllRanges = vi.fn()
    const selection = {
      isCollapsed: true,
      anchorOffset: 0,
      focusOffset: 0,
      toString: () => "",
      removeAllRanges
    }
    const fakeWindow = {
      setTimeout,
      clearTimeout,
      getSelection: () => selection
    } as unknown as Window

    const bridge = new PageTextSelectionBridge(document, fakeWindow, (payload) => {
      payloads.push(payload)
    })

    bridge.initialize()
    document.dispatchEvent(new Event("selectionchange"))
    vi.advanceTimersByTime(130)
    expect(payloads).toEqual([])

    selection.isCollapsed = false
    selection.focusOffset = 4
    selection.toString = () => "ZFS"
    document.dispatchEvent(new Event("selectionchange"))
    vi.advanceTimersByTime(130)
    expect(payloads).toHaveLength(1)

    bridge.clearSelection()
    expect(removeAllRanges).toHaveBeenCalledTimes(1)
  })
})
