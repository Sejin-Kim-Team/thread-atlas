import type {
  AudioCaptureControlResponse,
  PageTextSelectionChangedPayload,
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
import { PageTextSelectionBridge } from "./page-text-selection"
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
    __threadatlasPageTextSelectionBridge__?: PageTextSelectionBridge
    __threadatlasPageAudioBridgeReady__?: boolean
    __threadatlasPageAudioBridgeFailed__?: boolean
  }
}

const SELECTION_SCOPE_STYLE_ID = "threadatlas-selection-scope-style"
const SELECTION_SCOPE_ROOT_CLASS = "threadatlas-selection-scope-root"
const SELECTION_SCOPE_FOCUS_CLASS = "threadatlas-selection-scope-focus"

let selectionScopeRootElement: Element | null = null
let selectionScopeFocusElement: Element | null = null

function nearestSemanticElement(node: Node | null): Element | null {
  if (!node) {
    return null
  }
  const element = node instanceof Element ? node : node.parentElement
  return element?.closest("[data-semantic-node-id]") ?? element?.closest("[data-semantic-region]") ?? null
}

function buildSemanticAncestorChain(element: Element | null): Element[] {
  const chain: Element[] = []
  let current: Element | null = element
  while (current) {
    const semanticElement = current.closest("[data-semantic-node-id],[data-semantic-region]")
    if (!semanticElement || chain.includes(semanticElement)) {
      break
    }
    chain.push(semanticElement)
    current = semanticElement.parentElement
  }
  return chain
}

function resolveSelectionCaptureElement(selection: Selection | null): Element | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null
  }

  const range = selection.getRangeAt(0)
  const anchorElement = nearestSemanticElement(selection.anchorNode)
  const focusElement = nearestSemanticElement(selection.focusNode)
  if (anchorElement && focusElement) {
    if (anchorElement === focusElement) {
      return anchorElement
    }

    const focusChain = new Set(buildSemanticAncestorChain(focusElement))
    for (const candidate of buildSemanticAncestorChain(anchorElement)) {
      if (focusChain.has(candidate)) {
        return candidate
      }
    }
  }

  return (
    nearestSemanticElement(range.commonAncestorContainer) ??
    anchorElement ??
    focusElement ??
    null
  )
}

function capturePageTextSelectionSnapshot(session: SemanticCaptureSession): SemanticSnapshotCaptureResponse {
  const selection = window.getSelection()
  const selectedElement = resolveSelectionCaptureElement(selection)
  if (!selection || selection.isCollapsed || !selectedElement) {
    return {
      snapshot: null,
      error: "No usable page selection could be resolved."
    }
  }

  return session.captureSnapshot({
    source: "sidepanel",
    activeElement: selectedElement,
    selection: null,
    triggerTarget: selectedElement,
    selectedElement,
    lastHoveredElement: selectedElement
  })
}

function ensureSelectionScopeStyles(document: Document): void {
  if (document.getElementById(SELECTION_SCOPE_STYLE_ID)) {
    return
  }
  const style = document.createElement("style")
  style.id = SELECTION_SCOPE_STYLE_ID
  style.textContent = `
    .${SELECTION_SCOPE_ROOT_CLASS},
    .${SELECTION_SCOPE_FOCUS_CLASS} {
      transition:
        box-shadow 160ms ease,
        background-color 160ms ease,
        outline-color 160ms ease;
      scroll-margin-top: 96px;
    }

    .${SELECTION_SCOPE_ROOT_CLASS} {
      outline: 1px solid rgba(90, 114, 238, 0.24);
      background-color: rgba(90, 114, 238, 0.06);
      box-shadow: 0 0 0 6px rgba(90, 114, 238, 0.08);
      border-radius: 10px;
    }

    .${SELECTION_SCOPE_FOCUS_CLASS} {
      outline: 2px solid rgba(90, 114, 238, 0.9);
      background-color: rgba(90, 114, 238, 0.12);
      box-shadow: 0 0 0 8px rgba(90, 114, 238, 0.12);
      border-radius: 12px;
    }
  `
  document.head.appendChild(style)
}

function clearSelectionScopeHighlight(): void {
  selectionScopeRootElement?.classList.remove(SELECTION_SCOPE_ROOT_CLASS)
  selectionScopeFocusElement?.classList.remove(SELECTION_SCOPE_FOCUS_CLASS)
  selectionScopeRootElement = null
  selectionScopeFocusElement = null
}

function findSemanticElement(document: Document, regionId: string, nodeId: string | null | undefined): Element | null {
  if (!nodeId) {
    return document.querySelector(`[data-semantic-region="${regionId}"]`)
  }
  return (
    document.querySelector(`[data-semantic-region="${regionId}"][data-semantic-node-id="${nodeId}"]`) ??
    document.querySelector(`[data-semantic-node-id="${nodeId}"]`)
  )
}

function applySelectionScopeHighlight(payload: {
  regionId: string
  focusNodeId: string
  rootNodeId?: string | null
}): void {
  clearSelectionScopeHighlight()
  ensureSelectionScopeStyles(document)

  const rootElement = findSemanticElement(document, payload.regionId, payload.rootNodeId)
  const focusElement = findSemanticElement(document, payload.regionId, payload.focusNodeId)

  if (rootElement) {
    rootElement.classList.add(SELECTION_SCOPE_ROOT_CLASS)
    selectionScopeRootElement = rootElement
  }
  if (focusElement) {
    focusElement.classList.add(SELECTION_SCOPE_FOCUS_CLASS)
    selectionScopeFocusElement = focusElement
  }
}

let pageAudioBridgeReadyPromise: Promise<void> | null = null
let resolvePageAudioBridgeReady: (() => void) | null = null
let rejectPageAudioBridgeReady: ((error: Error) => void) | null = null

function isClearPageTextSelectionMessage(
  message: ServiceWorkerToContentMessage | SidePanelToContentMessage
): message is Extract<SidePanelToContentMessage, { type: "CLEAR_PAGE_TEXT_SELECTION" }> {
  return message.type === "CLEAR_PAGE_TEXT_SELECTION"
}

function isCapturePageTextSelectionSnapshotMessage(
  message: unknown
): message is Extract<SidePanelToContentMessage, { type: "CAPTURE_PAGE_TEXT_SELECTION_SNAPSHOT" }> {
  if (typeof message !== "object" || message === null) {
    return false
  }
  return (message as { type?: unknown }).type === "CAPTURE_PAGE_TEXT_SELECTION_SNAPSHOT"
}

function isApplyPageSelectionScopeHighlightMessage(
  message: unknown
): message is Extract<SidePanelToContentMessage, { type: "APPLY_PAGE_SELECTION_SCOPE_HIGHLIGHT" }> {
  return toApplyPageSelectionScopeHighlightPayload(message) !== null
}

function isClearPageSelectionScopeHighlightMessage(
  message: unknown
): message is Extract<SidePanelToContentMessage, { type: "CLEAR_PAGE_SELECTION_SCOPE_HIGHLIGHT" }> {
  if (typeof message !== "object" || message === null) {
    return false
  }
  return (message as { type?: unknown }).type === "CLEAR_PAGE_SELECTION_SCOPE_HIGHLIGHT"
}

function toApplyPageSelectionScopeHighlightPayload(message: unknown): {
  regionId: string
  focusNodeId: string
  rootNodeId?: string | null
} | null {
  if (typeof message !== "object" || message === null) {
    return null
  }
  const candidate = message as {
    type?: unknown
    payload?: { regionId?: unknown; focusNodeId?: unknown; rootNodeId?: unknown }
  }
  if (
    candidate.type !== "APPLY_PAGE_SELECTION_SCOPE_HIGHLIGHT" ||
    typeof candidate.payload?.regionId !== "string" ||
    typeof candidate.payload?.focusNodeId !== "string" ||
    (candidate.payload?.rootNodeId !== undefined &&
      candidate.payload?.rootNodeId !== null &&
      typeof candidate.payload?.rootNodeId !== "string")
  ) {
    return null
  }
  return {
    regionId: candidate.payload.regionId,
    focusNodeId: candidate.payload.focusNodeId,
    ...(candidate.payload.rootNodeId !== undefined
      ? { rootNodeId: candidate.payload.rootNodeId as string | null }
      : {})
  }
}

function toPageTextSelectionPayload(payload: unknown): PageTextSelectionChangedPayload | null {
  if (typeof payload !== "object" || payload === null) {
    return null
  }
  const candidate = payload as Partial<PageTextSelectionChangedPayload>
  if (
    typeof candidate.hasSelection !== "boolean" ||
    typeof candidate.textPreview !== "string" ||
    typeof candidate.timestamp !== "number"
  ) {
    return null
  }
  return {
    hasSelection: candidate.hasSelection,
    textPreview: candidate.textPreview,
    timestamp: candidate.timestamp
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
  const pageTextSelectionBridge = new PageTextSelectionBridge(
    document,
    window,
    (payload) => {
      const normalizedPayload = toPageTextSelectionPayload(payload)
      if (!normalizedPayload) {
        return
      }
      void chrome.runtime.sendMessage({
        type: "PAGE_TEXT_SELECTION_CHANGED",
        payload: normalizedPayload
      })
    }
  )
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
  pageTextSelectionBridge.initialize()
  ensurePageAudioBridge()
  window.__threadatlasSemanticCaptureSession__ = session
  window.__threadatlasSemanticTriggerManager__ = triggerManager
  window.__threadatlasPageTextSelectionBridge__ = pageTextSelectionBridge
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
      if (isCapturePageTextSelectionSnapshotMessage(message)) {
        sendResponse(capturePageTextSelectionSnapshot(session))
        return true
      }

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

      if (isClearPageTextSelectionMessage(message)) {
        pageTextSelectionBridge.clearSelection()
        sendResponse({ ok: true })
        return true
      }

      const selectionScopeHighlightPayload = toApplyPageSelectionScopeHighlightPayload(message)
      if (selectionScopeHighlightPayload) {
        applySelectionScopeHighlight(selectionScopeHighlightPayload)
        sendResponse({ ok: true })
        return true
      }

      if (isClearPageSelectionScopeHighlightMessage(message)) {
        clearSelectionScopeHighlight()
        sendResponse({ ok: true })
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
