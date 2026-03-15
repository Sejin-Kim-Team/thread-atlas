import type {
  SemanticSelectionStateResponse,
  SemanticSnapshotCaptureResponse,
  SidePanelToContentMessage,
  SpeechInputControlResponse,
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

type PageSpeechState = "idle" | "listening" | "processing" | "unsupported" | "error"

interface PageSpeechBridgeInboundMessage {
  source: "threadatlas-page-speech"
  type:
    | "THREADATLAS_PAGE_SPEECH_READY"
    | "THREADATLAS_PAGE_SPEECH_STATE"
    | "THREADATLAS_PAGE_SPEECH_PARTIAL"
    | "THREADATLAS_PAGE_SPEECH_FINAL"
  payload: {
    sessionId?: string
    state?: PageSpeechState
    detail?: string
    text?: string
  }
}

declare global {
  interface Window {
    __threadatlasSemanticCaptureInitialized__?: boolean
    __threadatlasSemanticCaptureSession__?: SemanticCaptureSession
    __threadatlasSemanticTriggerManager__?: TriggerManager
    __threadatlasPageSpeechBridgeInjected__?: boolean
    __threadatlasPageSpeechBridgeReady__?: boolean
    __threadatlasPageSpeechBridgeFailed__?: boolean
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
  ensurePageSpeechBridge()
  window.__threadatlasSemanticCaptureSession__ = session
  window.__threadatlasSemanticTriggerManager__ = triggerManager
  window.__threadatlasSemanticCaptureInitialized__ = true
  void hydrateSelectionMode(triggerManager)

  chrome.runtime.onMessage.addListener(
    (
      message: ServiceWorkerToContentMessage | SidePanelToContentMessage,
      _sender,
      sendResponse: (
        response:
          | SemanticSnapshotCaptureResponse
          | SemanticSelectionStateResponse
          | SemanticRegionDumpResponse
          | SpeechInputControlResponse
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

      if (message.type === "START_PAGE_SPEECH_INPUT") {
        if (window.__threadatlasPageSpeechBridgeFailed__) {
          sendResponse({ ok: false, error: "Voice input bridge failed to load on this page." })
          return true
        }
        if (!window.__threadatlasPageSpeechBridgeReady__) {
          sendResponse({ ok: false, error: "Voice input bridge is not ready on this page yet." })
          return true
        }
        sendPageSpeechBridgeMessage("THREADATLAS_PAGE_SPEECH_START", message.payload)
        sendResponse({ ok: true })
        return true
      }

      if (message.type === "STOP_PAGE_SPEECH_INPUT") {
        sendPageSpeechBridgeMessage("THREADATLAS_PAGE_SPEECH_STOP", message.payload)
        sendResponse({ ok: true })
        return true
      }

      if (message.type === "CANCEL_PAGE_SPEECH_INPUT") {
        sendPageSpeechBridgeMessage("THREADATLAS_PAGE_SPEECH_CANCEL", message.payload)
        sendResponse({ ok: true })
        return true
      }

      return false
    }
  )
}

function ensurePageSpeechBridge(): void {
  if (window.__threadatlasPageSpeechBridgeInjected__) {
    return
  }

  const script = document.createElement("script")
  script.src = chrome.runtime.getURL("page-speech-bridge.js")
  script.async = false
  script.dataset.threadatlasPageSpeechBridge = "true"
  script.addEventListener("load", () => {
    script.remove()
  })
  script.addEventListener("error", () => {
    window.__threadatlasPageSpeechBridgeFailed__ = true
    script.remove()
  })
  ;(document.head ?? document.documentElement).appendChild(script)

  window.addEventListener("message", handlePageSpeechBridgeMessage)
  window.__threadatlasPageSpeechBridgeInjected__ = true
  window.__threadatlasPageSpeechBridgeReady__ = false
  window.__threadatlasPageSpeechBridgeFailed__ = false
}

function sendPageSpeechBridgeMessage(
  type: "THREADATLAS_PAGE_SPEECH_START" | "THREADATLAS_PAGE_SPEECH_STOP" | "THREADATLAS_PAGE_SPEECH_CANCEL",
  payload: { sessionId: string; language?: string }
): void {
  window.postMessage(
    {
      source: "threadatlas-content-speech",
      type,
      payload
    },
    "*"
  )
}

function handlePageSpeechBridgeMessage(event: MessageEvent<PageSpeechBridgeInboundMessage>): void {
  if (event.source !== window) {
    return
  }

  const data = event.data
  if (!data || data.source !== "threadatlas-page-speech") {
    return
  }

  if (data.type === "THREADATLAS_PAGE_SPEECH_READY") {
    window.__threadatlasPageSpeechBridgeReady__ = true
    window.__threadatlasPageSpeechBridgeFailed__ = false
    return
  }

  if (data.type === "THREADATLAS_PAGE_SPEECH_STATE" && data.payload.state) {
    void chrome.runtime.sendMessage({
      type: "PAGE_SPEECH_STATE_CHANGED",
      payload: {
        sessionId: data.payload.sessionId,
        state: data.payload.state,
        ...(data.payload.detail ? { detail: data.payload.detail } : {})
      }
    })
    return
  }

  if (data.type === "THREADATLAS_PAGE_SPEECH_PARTIAL" && typeof data.payload.text === "string") {
    void chrome.runtime.sendMessage({
      type: "PAGE_SPEECH_PARTIAL",
      payload: {
        sessionId: data.payload.sessionId,
        text: data.payload.text
      }
    })
    return
  }

  if (data.type === "THREADATLAS_PAGE_SPEECH_FINAL" && typeof data.payload.text === "string") {
    void chrome.runtime.sendMessage({
      type: "PAGE_SPEECH_FINAL",
      payload: {
        sessionId: data.payload.sessionId,
        text: data.payload.text
      }
    })
  }
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  initializeSemanticCapture()
}
