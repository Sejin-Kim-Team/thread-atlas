import type {
  AudioCaptureControlResponse,
  SemanticSelectionStateResponse,
  SemanticSnapshotCaptureResponse,
  SidePanelToContentMessage,
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

type PageAudioCaptureState = "idle" | "listening" | "processing" | "unsupported" | "error"

interface PageAudioBridgeInboundMessage {
  source: "threadatlas-page-audio"
  type:
    | "THREADATLAS_PAGE_AUDIO_READY"
    | "THREADATLAS_PAGE_AUDIO_STATE"
    | "THREADATLAS_PAGE_AUDIO_CHUNK"
  payload: {
    sessionId?: string
    state?: PageAudioCaptureState
    detail?: string
    chunkBase64?: string
  }
}

declare global {
  interface Window {
    __threadatlasSemanticCaptureInitialized__?: boolean
    __threadatlasSemanticCaptureSession__?: SemanticCaptureSession
    __threadatlasSemanticTriggerManager__?: TriggerManager
    __threadatlasPageAudioBridgeReady__?: boolean
    __threadatlasPageAudioBridgeFailed__?: boolean
  }
}

let pageAudioBridgeReadyPromise: Promise<void> | null = null
let resolvePageAudioBridgeReady: (() => void) | null = null
let rejectPageAudioBridgeReady: ((error: Error) => void) | null = null

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
  ensurePageAudioBridge()
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
          | AudioCaptureControlResponse
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

      if (message.type === "START_PAGE_AUDIO_CAPTURE") {
        void waitForPageAudioBridgeReady()
          .then(() => {
            sendPageAudioBridgeMessage("THREADATLAS_PAGE_AUDIO_START", message.payload)
            sendResponse({ ok: true })
          })
          .catch((error: unknown) => {
            sendResponse({
              ok: false,
              error:
                error instanceof Error ? error.message : "Voice input bridge failed to load on this page."
            })
          })
        return true
      }

      if (message.type === "STOP_PAGE_AUDIO_CAPTURE") {
        sendPageAudioBridgeMessage("THREADATLAS_PAGE_AUDIO_STOP", message.payload)
        sendResponse({ ok: true })
        return true
      }

      if (message.type === "CANCEL_PAGE_AUDIO_CAPTURE") {
        sendPageAudioBridgeMessage("THREADATLAS_PAGE_AUDIO_CANCEL", message.payload)
        sendResponse({ ok: true })
        return true
      }

      return false
    }
  )
}

function ensurePageAudioBridge(): void {
  window.removeEventListener("message", handlePageAudioBridgeMessage)
  window.addEventListener("message", handlePageAudioBridgeMessage)

  pageAudioBridgeReadyPromise = new Promise<void>((resolve, reject) => {
    resolvePageAudioBridgeReady = resolve
    rejectPageAudioBridgeReady = reject
  })

  window.__threadatlasPageAudioBridgeReady__ = false
  window.__threadatlasPageAudioBridgeFailed__ = false

  const script = document.createElement("script")
  script.src = chrome.runtime.getURL("page-audio-bridge.js")
  script.async = false
  script.dataset.threadatlasPageAudioBridge = "true"
  script.addEventListener("load", () => {
    script.remove()
  })
  script.addEventListener("error", () => {
    window.__threadatlasPageAudioBridgeFailed__ = true
    window.__threadatlasPageAudioBridgeReady__ = false
    rejectPageAudioBridgeReady?.(new Error("Voice input bridge failed to load on this page."))
    script.remove()
  })
  ;(document.head ?? document.documentElement).appendChild(script)
}

async function waitForPageAudioBridgeReady(timeoutMs = 1500): Promise<void> {
  if (window.__threadatlasPageAudioBridgeFailed__) {
    throw new Error("Voice input bridge failed to load on this page.")
  }

  if (window.__threadatlasPageAudioBridgeReady__) {
    return
  }

  if (!pageAudioBridgeReadyPromise) {
    ensurePageAudioBridge()
  }

  await Promise.race([
    pageAudioBridgeReadyPromise,
    new Promise<void>((_, reject) => {
      window.setTimeout(() => {
        reject(new Error("Voice input bridge is not ready on this page yet."))
      }, timeoutMs)
    })
  ])
}

function sendPageAudioBridgeMessage(
  type: "THREADATLAS_PAGE_AUDIO_START" | "THREADATLAS_PAGE_AUDIO_STOP" | "THREADATLAS_PAGE_AUDIO_CANCEL",
  payload: { sessionId: string }
): void {
  window.postMessage(
    {
      source: "threadatlas-content-audio",
      type,
      payload
    },
    "*"
  )
}

function handlePageAudioBridgeMessage(event: MessageEvent<PageAudioBridgeInboundMessage>): void {
  if (event.source !== window) {
    return
  }

  const data = event.data
  if (!data || data.source !== "threadatlas-page-audio") {
    return
  }

  if (data.type === "THREADATLAS_PAGE_AUDIO_READY") {
    window.__threadatlasPageAudioBridgeReady__ = true
    window.__threadatlasPageAudioBridgeFailed__ = false
    resolvePageAudioBridgeReady?.()
    resolvePageAudioBridgeReady = null
    rejectPageAudioBridgeReady = null

    void chrome.runtime.sendMessage({
      type: "PAGE_AUDIO_CAPTURE_READY",
      payload: {}
    })
    return
  }

  if (data.type === "THREADATLAS_PAGE_AUDIO_STATE" && data.payload.state) {
    void chrome.runtime.sendMessage({
      type: "PAGE_AUDIO_CAPTURE_STATE_CHANGED",
      payload: {
        sessionId: data.payload.sessionId,
        state: data.payload.state,
        ...(data.payload.detail ? { detail: data.payload.detail } : {})
      }
    })
    return
  }

  if (data.type === "THREADATLAS_PAGE_AUDIO_CHUNK" && typeof data.payload.chunkBase64 === "string") {
    void chrome.runtime.sendMessage({
      type: "PAGE_AUDIO_CAPTURE_CHUNK",
      payload: {
        sessionId: data.payload.sessionId,
        chunkBase64: data.payload.chunkBase64
      }
    })
  }
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  initializeSemanticCapture()
}
