import type { AnyRuntimeMessage, SidePanelToServiceWorkerMessage } from "@threadatlas/shared/runtime"
import type { ExtensionAuthState } from "@threadatlas/shared"
import type {
  PageTextSelectionChangedPayload,
  SemanticSelectionStateResponse,
  SemanticSnapshotCaptureResponse
} from "@threadatlas/shared/runtime"
import {
  createSemanticSnapshotCoordinator,
  SEMANTIC_SELECTION_COMMAND,
  SEMANTIC_SNAPSHOT_COMMAND,
  SEMANTIC_SNAPSHOT_CONTEXT_MENU_ID
} from "./semantic-snapshot"
import { createExtensionAuthManager } from "./auth-manager"
import { createChromeLocalStorage } from "../common/extension-config"
import type { RegionDump } from "../content/semantic/core/observability"

type ContentScriptBridgeResponse =
  | SemanticSnapshotCaptureResponse
  | SemanticSelectionStateResponse
  | { dump: RegionDump | null }

function isPageTextSelectionChangedMessage(
  message: unknown
): message is { type: "PAGE_TEXT_SELECTION_CHANGED"; payload: PageTextSelectionChangedPayload } {
  if (typeof message !== "object" || message === null) {
    return false
  }
  const candidate = message as { type?: unknown; payload?: Partial<PageTextSelectionChangedPayload> }
  return (
    candidate.type === "PAGE_TEXT_SELECTION_CHANGED" &&
    typeof candidate.payload?.hasSelection === "boolean" &&
    typeof candidate.payload?.textPreview === "string" &&
    typeof candidate.payload?.timestamp === "number"
  )
}

function safeBroadcastRuntimeMessage(message: unknown): void {
  chrome.runtime.sendMessage(message, () => {
    void chrome.runtime.lastError
  })
}

const knownArticleUrls = new Map<string, string>()
const authManager = createExtensionAuthManager({
  storage: createChromeLocalStorage(),
  broadcastAuthState(state: ExtensionAuthState) {
    safeBroadcastRuntimeMessage({
      type: "AUTH_STATE_CHANGED",
      payload: state
    })
  }
})

const semanticSnapshotCoordinator = createSemanticSnapshotCoordinator({
  async getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    return tabs[0] ?? null
  },
  async getTab(tabId) {
    return (await chrome.tabs.get(tabId)) ?? null
  },
  async sendToContentScript(tabId, message) {
    const trySend = () =>
      new Promise<ContentScriptBridgeResponse>((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, message, (response) => {
          const runtimeError = chrome.runtime.lastError
          if (runtimeError) {
            reject(new Error(runtimeError.message))
            return
          }

          resolve(response)
        })
      })

    try {
      return await trySend()
    } catch (error) {
      const messageText = error instanceof Error ? error.message : ""
      if (
        !messageText.includes("Receiving end does not exist") ||
        !chrome.scripting?.executeScript
      ) {
        throw error
      }

      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content-semantic.js"]
      })

      return trySend()
    }
  },
  async openSidePanel(tabId) {
    if (chrome.sidePanel?.open) {
      await chrome.sidePanel.open({ tabId })
    }
  },
  notifyRuntime(message) {
    safeBroadcastRuntimeMessage(message)
  }
})

function resolveSemanticTabId(
  payloadTabId: number | undefined,
  sender: chrome.runtime.MessageSender
): number | undefined {
  return payloadTabId ?? sender.tab?.id ?? undefined
}

function notifyActiveTabChanged(tabId: number, url: string, title: string): void {
  safeBroadcastRuntimeMessage({
    type: "ACTIVE_TAB_CHANGED",
    payload: {
      tabId,
      url,
      title
    }
  })
}

function registerContextMenus(): void {
  if (!chrome.contextMenus) {
    return
  }

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: SEMANTIC_SNAPSHOT_CONTEXT_MENU_ID,
      title: "Capture Semantic Snapshot",
      contexts: ["page", "selection"]
    })
  })
}

registerContextMenus()

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId)
  notifyActiveTabChanged(activeInfo.tabId, tab.url ?? "", tab.title ?? "")
})

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) {
    return
  }

  if (tab.active) {
    notifyActiveTabChanged(tabId, tab.url ?? "", tab.title ?? "")
  }

  if (!knownArticleUrls.has(tab.url)) {
    return
  }

  try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content-article.js"]
      })

      safeBroadcastRuntimeMessage({
        type: "ARTICLE_INJECTED",
        payload: {
          tabId,
          url: tab.url
      }
    })
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("content-article inject failed", error)
  }
})

chrome.runtime.onMessage.addListener((msg: AnyRuntimeMessage, sender, sendResponse) => {
  if (sender.tab?.id != null) {
    if (isPageTextSelectionChangedMessage(msg)) {
      safeBroadcastRuntimeMessage({
        type: "PAGE_TEXT_SELECTION_CHANGED",
        payload: {
          ...msg.payload,
          tabId: sender.tab.id
        }
      })
      sendResponse({ ok: true })
      return true
    }

    switch (msg.type) {
      case "PAGE_AUDIO_CAPTURE_READY": {
        safeBroadcastRuntimeMessage({
          type: "PAGE_AUDIO_CAPTURE_READY",
          payload: {
            tabId: sender.tab.id
          }
        })
        sendResponse({ ok: true })
        return true
      }
      case "PAGE_AUDIO_CAPTURE_STATE_CHANGED": {
        safeBroadcastRuntimeMessage({
          type: "PAGE_AUDIO_CAPTURE_STATE_CHANGED",
          payload: {
            ...msg.payload,
            tabId: sender.tab.id
          }
        })
        sendResponse({ ok: true })
        return true
      }
      case "PAGE_AUDIO_CAPTURE_CHUNK": {
        safeBroadcastRuntimeMessage({
          type: "PAGE_AUDIO_CAPTURE_CHUNK",
          payload: {
            ...msg.payload,
            tabId: sender.tab.id
          }
        })
        sendResponse({ ok: true })
        return true
      }
    }
  }

  const sidePanelMessage = msg as SidePanelToServiceWorkerMessage

  switch (sidePanelMessage.type) {
    case "CAPTURE_VIEWPORT": {
      chrome.tabs.captureVisibleTab({ format: "jpeg", quality: 70 }, (dataUrl) => {
        const viewport = dataUrl?.split(",")[1] ?? null
        sendResponse({ viewport })
      })
      return true
    }

    case "REGISTER_ARTICLE_URL": {
      knownArticleUrls.set(sidePanelMessage.payload.url, sidePanelMessage.payload.threadId)
      sendResponse({ ok: true })
      return true
    }

    case "OPEN_TAB": {
      chrome.tabs.create({ url: sidePanelMessage.payload.url, active: sidePanelMessage.payload.active }, (tab) => {
        sendResponse({ tabId: tab.id })
      })
      return true
    }

    case "REQUEST_SEMANTIC_SNAPSHOT": {
      void semanticSnapshotCoordinator
        .captureActiveTab(
          resolveSemanticTabId(sidePanelMessage.payload?.tabId, sender),
          sidePanelMessage.payload?.source ?? "sidepanel",
          {
          openPanel: false
          }
        )
        .then((payload) => sendResponse(payload))
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "semantic snapshot request failed"
          sendResponse({ tabId: null, snapshot: null, error: message })
        })
      return true
    }

    case "GET_AUTH_STATE": {
      void authManager
        .getState()
        .then((payload) => sendResponse(payload))
        .catch((error: unknown) => {
          sendResponse({
            status: "error",
            provider: "google",
            user: null,
            session: null,
            errorMessage: error instanceof Error ? error.message : "failed to read auth state"
          })
        })
      return true
    }

    case "SIGN_IN_WITH_GOOGLE": {
      void authManager
        .signInWithGoogle()
        .then((payload) => sendResponse(payload))
        .catch((error: unknown) => {
          sendResponse({
            status: "error",
            provider: "google",
            user: null,
            session: null,
            errorMessage: error instanceof Error ? error.message : "failed to sign in with Google"
          })
        })
      return true
    }

    case "ENSURE_AUTH_SESSION": {
      void authManager
        .ensureAuthSession()
        .then((payload) => sendResponse(payload))
        .catch((error: unknown) => {
          sendResponse({
            ok: false,
            state: {
              status: "error",
              provider: "google",
              user: null,
              session: null,
              errorMessage:
                error instanceof Error ? error.message : "failed to ensure an authenticated session"
            },
            error: error instanceof Error ? error.message : "failed to ensure an authenticated session"
          })
        })
      return true
    }

    case "SIGN_OUT": {
      void authManager
        .signOut()
        .then((payload) => sendResponse(payload))
        .catch((error: unknown) => {
          sendResponse({
            status: "error",
            provider: "google",
            user: null,
            session: null,
            errorMessage: error instanceof Error ? error.message : "failed to sign out"
          })
        })
      return true
    }

    case "GET_LATEST_SEMANTIC_SNAPSHOT": {
      void semanticSnapshotCoordinator
        .getLatest(resolveSemanticTabId(sidePanelMessage.payload?.tabId, sender))
        .then((payload) => sendResponse(payload))
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "semantic snapshot lookup failed"
          sendResponse({ tabId: null, snapshot: null, error: message })
        })
      return true
    }

    case "GET_SEMANTIC_SNAPSHOT_HISTORY": {
      void semanticSnapshotCoordinator
        .getHistory(resolveSemanticTabId(sidePanelMessage.payload?.tabId, sender))
        .then((payload) => sendResponse(payload))
        .catch(() => {
          sendResponse({ tabId: null, snapshots: [] })
        })
      return true
    }

    case "TOGGLE_SEMANTIC_SELECTION": {
      void semanticSnapshotCoordinator
        .toggleSelectionMode(resolveSemanticTabId(sidePanelMessage.payload?.tabId, sender))
        .then((payload) => sendResponse(payload))
        .catch(() => {
          sendResponse({ tabId: null, enabled: false, selectedTarget: null })
        })
      return true
    }

    case "GET_SEMANTIC_SELECTION_STATE": {
      void semanticSnapshotCoordinator
        .getSelectionState(resolveSemanticTabId(sidePanelMessage.payload?.tabId, sender))
        .then((payload) => sendResponse(payload))
        .catch(() => {
          sendResponse({ tabId: null, enabled: false, selectedTarget: null })
        })
      return true
    }

    case "GET_SEMANTIC_REGION_DUMP": {
      void semanticSnapshotCoordinator
        .getRegionDump(resolveSemanticTabId(sidePanelMessage.payload?.tabId, sender))
        .then((payload) => sendResponse(payload))
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "semantic region dump lookup failed"
          sendResponse({ tabId: null, dump: null, error: message })
        })
      return true
    }

    case "CLEAR_SEMANTIC_SELECTION": {
      void semanticSnapshotCoordinator
        .clearSelection(resolveSemanticTabId(sidePanelMessage.payload?.tabId, sender))
        .then((payload) => sendResponse(payload))
        .catch(() => {
          sendResponse({ tabId: null, enabled: false, selectedTarget: null })
        })
      return true
    }

    case "SYNC_SEMANTIC_SELECTION_STATE": {
      const tabId = sender.tab?.id ?? null
      const payload = semanticSnapshotCoordinator.syncSelectionState(tabId, {
          enabled: sidePanelMessage.payload.enabled,
          selectedTarget: sidePanelMessage.payload.selectedTarget
        },
        typeof sidePanelMessage.payload.snapshot !== "undefined" ||
          typeof sidePanelMessage.payload.error !== "undefined"
          ? {
              snapshot: sidePanelMessage.payload.snapshot ?? null,
              error: sidePanelMessage.payload.error ?? null
            }
          : undefined
        )
      sendResponse(payload)
      return true
    }

    default:
      return false
  }
})

if (chrome.runtime.onInstalled) {
  chrome.runtime.onInstalled.addListener(() => {
    registerContextMenus()
  })
}

if (chrome.contextMenus?.onClicked) {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== SEMANTIC_SNAPSHOT_CONTEXT_MENU_ID) {
      return
    }

    void semanticSnapshotCoordinator.captureForTab(tab?.id ?? null, "context-menu")
  })
}

if (chrome.commands?.onCommand) {
  chrome.commands.onCommand.addListener((command) => {
    if (command === SEMANTIC_SNAPSHOT_COMMAND) {
      void semanticSnapshotCoordinator.captureActiveTab(undefined, "command")
      return
    }

    if (command === SEMANTIC_SELECTION_COMMAND) {
      void semanticSnapshotCoordinator.toggleSelectionMode()
    }
  })
}
