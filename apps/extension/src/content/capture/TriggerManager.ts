import type {
  SemanticSnapshot,
} from "@threadatlas/shared"
import type { CaptureSource } from "@threadatlas/shared/browser-runtime"
import type {
  SemanticSelectionStateResponse,
  SemanticSelectionTarget,
  SemanticSnapshotCaptureResponse
} from "@threadatlas/shared/runtime"
import { SemanticCaptureSession } from "../semantic/session"
import { BrowserCapture } from "./BrowserCapture"
import { SnapshotIndicator } from "../overlay/SnapshotIndicator"
import { RegionHighlighter } from "../overlay/RegionHighlighter"

function copyUsingExecCommand(document: Document, text: string): boolean {
  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "true")
  Object.assign(textarea.style, {
    position: "fixed",
    top: "-9999px",
    left: "-9999px"
  })
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  const copied = document.execCommand?.("copy") ?? false
  textarea.remove()
  return copied
}

async function copyWithClipboardApi(text: string): Promise<boolean> {
  if (!navigator.clipboard?.writeText) {
    return false
  }

  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export class TriggerManager {
  private selectionModeEnabled = false
  private selectedTarget: SemanticSelectionTarget | null = null

  constructor(
    private readonly session: SemanticCaptureSession,
    private readonly browserCapture: BrowserCapture,
    private readonly regionHighlighter: RegionHighlighter,
    private readonly snapshotIndicator: SnapshotIndicator,
    private readonly onSelectionStateChange?: (
      state: SemanticSelectionStateResponse,
      capture?: SemanticSnapshotCaptureResponse
    ) => void
  ) {
    this.regionHighlighter.setSelectionHandler((target, element) => {
      this.selectedTarget = target ? this.session.refineSelectionTarget(target) : null
      this.browserCapture.setSelectedElement(element)
      const state = this.getSelectionState()
      const capture = this.selectedTarget
        ? this.session.captureSnapshot(this.browserCapture.buildResolveFocusInput("sidepanel"))
        : undefined
      this.onSelectionStateChange?.(state, capture)
    })
    this.sessionDocument.addEventListener("keydown", this.handleKeydown, true)
  }

  async captureSnapshot(source: CaptureSource): Promise<SemanticSnapshotCaptureResponse> {
    const result = this.session.captureSnapshot(this.browserCapture.buildResolveFocusInput(source))
    if (!result.snapshot) {
      return result
    }

    const copied = await this.copySnapshot(result.snapshot)
    this.snapshotIndicator.showCapture(
      this.session.getRegionElement(result.snapshot.focus.region),
      this.session.getRegionCategory(result.snapshot.focus.region),
      copied
    )

    return result
  }

  toggleSelectionMode(): SemanticSelectionStateResponse {
    this.selectionModeEnabled = this.regionHighlighter.toggle()
    if (!this.selectionModeEnabled) {
      this.selectedTarget = null
      this.browserCapture.clearSelectedElement()
    }

    const state = {
      enabled: this.selectionModeEnabled,
      selectedTarget: this.selectedTarget
    }
    this.onSelectionStateChange?.(state)
    return state
  }

  getSelectionState(): SemanticSelectionStateResponse {
    return {
      enabled: this.selectionModeEnabled,
      selectedTarget: this.selectedTarget
    }
  }

  clearSelection(): SemanticSelectionStateResponse {
    this.selectedTarget = null
    this.browserCapture.clearSelectedElement()
    this.regionHighlighter.clearSelection()
    const state = {
      enabled: this.selectionModeEnabled,
      selectedTarget: null
    }
    this.onSelectionStateChange?.(state)
    return state
  }

  dispose(): void {
    this.sessionDocument.removeEventListener("keydown", this.handleKeydown, true)
    this.browserCapture.dispose()
    this.regionHighlighter.dispose()
    this.snapshotIndicator.dispose()
  }

  private get sessionDocument(): Document {
    return document
  }

  private async copySnapshot(snapshot: SemanticSnapshot): Promise<boolean> {
    const json = JSON.stringify(snapshot, null, 2)
    if (copyUsingExecCommand(document, json)) {
      return true
    }

    return copyWithClipboardApi(json)
  }

  private readonly handleKeydown = (event: KeyboardEvent): void => {
    if (!event.altKey || !event.shiftKey || event.metaKey || event.ctrlKey) {
      return
    }

    if (event.key.toLowerCase() !== "d") {
      return
    }

    event.preventDefault()
    this.dumpObservability()
  }

  private dumpObservability(): void {
    const dump = this.session.dumpObservability()
    if (!dump) {
      // eslint-disable-next-line no-console
      console.warn("[ThreadAtlas] Region dump unavailable on this page.")
      this.snapshotIndicator.showMessage("Region dump unavailable")
      return
    }

    // eslint-disable-next-line no-console
    console.groupCollapsed(`[ThreadAtlas] RegionDump ${dump.url}`)
    // eslint-disable-next-line no-console
    console.table(
      dump.regions.map((region) => ({
        id: region.id,
        primitive: region.primitive,
        subtype: region.subtype ?? "",
        layoutRole: region.layoutRole,
        roleRank: region.roleRank,
        autoSuppressed: region.autoSuppressed,
        nodeCount: region.nodeCount,
        textLength: region.textLength,
        confidence: region.confidence
      }))
    )
    // eslint-disable-next-line no-console
    console.log("decisions", dump.decisions)
    // eslint-disable-next-line no-console
    console.log("dump", dump)
    // eslint-disable-next-line no-console
    console.groupEnd()

    this.snapshotIndicator.showMessage("Region dump logged to console")
  }
}
