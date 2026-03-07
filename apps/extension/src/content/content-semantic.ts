import type {
  SemanticSelectionStateResponse,
  SemanticSnapshotCaptureResponse,
  ServiceWorkerToContentMessage
} from "@threadatlas/shared/runtime"
import { TriggerManager } from "./capture/TriggerManager"
import { BrowserCapture } from "./capture/BrowserCapture"
import { RegionHighlighter } from "./overlay/RegionHighlighter"
import { SnapshotIndicator } from "./overlay/SnapshotIndicator"
import { SemanticCaptureSession } from "./semantic/session"
import type { RegionDump } from "./semantic/core/observability"

interface SemanticRegionDumpResponse {
  dump: RegionDump | null
}

declare global {
  interface Window {
    __threadatlasSemanticCaptureInitialized__?: boolean
    __threadatlasSemanticCaptureSession__?: SemanticCaptureSession
    __threadatlasSemanticTriggerManager__?: TriggerManager
  }
}

async function hydrateSelectionMode(triggerManager: TriggerManager): Promise<void> {
  try {
    const state = await chrome.runtime.sendMessage({
      type: "GET_SEMANTIC_SELECTION_STATE"
    })

    if (state?.enabled && !triggerManager.getSelectionState().enabled) {
      triggerManager.toggleSelectionMode()
    }
  } catch {
    // Ignore hydration failures and keep semantic capture usable.
  }
}

function initializeSemanticCapture(): void {
  if (window.__threadatlasSemanticCaptureInitialized__) {
    return
  }

  const session = new SemanticCaptureSession(document, window)
  const browserCapture = new BrowserCapture(document, window)
  const regionHighlighter = new RegionHighlighter(document, window)
  const snapshotIndicator = new SnapshotIndicator(document, window)
  const triggerManager = new TriggerManager(
    session,
    browserCapture,
    regionHighlighter,
    snapshotIndicator,
    (state, capture) => {
      void chrome.runtime.sendMessage({
        type: "SYNC_SEMANTIC_SELECTION_STATE",
        payload: {
          enabled: state.enabled,
          selectedTarget: state.selectedTarget,
          snapshot: capture?.snapshot ?? undefined,
          error: capture?.error ?? undefined
        }
      })
    }
  )

  session.initialize()
  browserCapture.initialize()
  window.__threadatlasSemanticCaptureSession__ = session
  window.__threadatlasSemanticTriggerManager__ = triggerManager
  window.__threadatlasSemanticCaptureInitialized__ = true
  void hydrateSelectionMode(triggerManager)

  chrome.runtime.onMessage.addListener(
    (
      message: ServiceWorkerToContentMessage,
      _sender,
      sendResponse: (
        response: SemanticSnapshotCaptureResponse | SemanticSelectionStateResponse | SemanticRegionDumpResponse
      ) => void
    ) => {
      if (message.type === "CAPTURE_SEMANTIC_SNAPSHOT") {
        void triggerManager.captureSnapshot(message.payload.source).then(sendResponse)
        return true
      }

      if (message.type === "TOGGLE_SEMANTIC_SELECTION") {
        sendResponse(triggerManager.toggleSelectionMode())
        return true
      }

      if (message.type === "GET_SEMANTIC_SELECTION_STATE") {
        sendResponse(triggerManager.getSelectionState())
        return true
      }

      if (message.type === "GET_SEMANTIC_REGION_DUMP") {
        sendResponse({
          dump: session.dumpObservability()
        })
        return true
      }

      if (message.type === "CLEAR_SEMANTIC_SELECTION") {
        sendResponse(triggerManager.clearSelection())
        return true
      }

      return false
    }
  )
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  initializeSemanticCapture()
}
