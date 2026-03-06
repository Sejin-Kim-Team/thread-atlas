import { DEFAULT_API_BASE_URL, type TokenResponse } from "@threadatlas/shared"
import type { SidePanelToServiceWorkerMessage } from "@threadatlas/shared/runtime"
import {
  createSemanticSnapshotCoordinator,
  SEMANTIC_SELECTION_COMMAND,
  SEMANTIC_SNAPSHOT_COMMAND,
  SEMANTIC_SNAPSHOT_CONTEXT_MENU_ID
} from "./semantic-snapshot"

const knownArticleUrls = new Map<string, string>()
const API_BASE_URL = DEFAULT_API_BASE_URL

const semanticSnapshotCoordinator = createSemanticSnapshotCoordinator({
  async getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    return tabs[0] ?? null
  },
  async getTab(tabId) {
    return (await chrome.tabs.get(tabId)) ?? null
  },
  async sendToContentScript(tabId, message) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        const runtimeError = chrome.runtime.lastError
        if (runtimeError) {
          reject(new Error(runtimeError.message))
          return
        }

        resolve(response)
      })
    })
  },
  async openSidePanel(tabId) {
    if (chrome.sidePanel?.open) {
      await chrome.sidePanel.open({ tabId })
    }
  },
  notifyRuntime(message) {
    chrome.runtime.sendMessage(message)
  }
})

function resolveSemanticTabId(
  payloadTabId: number | undefined,
  sender: chrome.runtime.MessageSender
): number | undefined {
  return payloadTabId ?? sender.tab?.id ?? undefined
}

function notifyActiveTabChanged(tabId: number, url: string, title: string): void {
  chrome.runtime.sendMessage({
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

    chrome.runtime.sendMessage({
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

async function requestToken(): Promise<TokenResponse> {
  const response = await fetch(`${API_BASE_URL}/api/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: "user_sungwoo" })
  })

  return (await response.json()) as TokenResponse
}

chrome.runtime.onMessage.addListener((msg: SidePanelToServiceWorkerMessage, sender, sendResponse) => {
  switch (msg.type) {
    case "CAPTURE_VIEWPORT": {
      chrome.tabs.captureVisibleTab({ format: "jpeg", quality: 70 }, (dataUrl) => {
        const viewport = dataUrl?.split(",")[1] ?? null
        sendResponse({ viewport })
      })
      return true
    }

    case "REGISTER_ARTICLE_URL": {
      knownArticleUrls.set(msg.payload.url, msg.payload.threadId)
      sendResponse({ ok: true })
      return true
    }

    case "OPEN_TAB": {
      chrome.tabs.create({ url: msg.payload.url, active: msg.payload.active }, (tab) => {
        sendResponse({ tabId: tab.id })
      })
      return true
    }

    case "REQUEST_TOKEN": {
      void requestToken()
        .then((token) => sendResponse(token))
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "request token failed"
          sendResponse({ token: "", expiresAt: 0, error: message })
        })
      return true
    }

    case "REQUEST_SEMANTIC_SNAPSHOT": {
      void semanticSnapshotCoordinator
        .captureActiveTab(resolveSemanticTabId(msg.payload?.tabId, sender), msg.payload?.source ?? "sidepanel", {
          openPanel: false
        })
        .then((payload) => sendResponse(payload))
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "semantic snapshot request failed"
          sendResponse({ tabId: null, snapshot: null, error: message })
        })
      return true
    }

    case "GET_LATEST_SEMANTIC_SNAPSHOT": {
      void semanticSnapshotCoordinator
        .getLatest(resolveSemanticTabId(msg.payload?.tabId, sender))
        .then((payload) => sendResponse(payload))
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "semantic snapshot lookup failed"
          sendResponse({ tabId: null, snapshot: null, error: message })
        })
      return true
    }

    case "GET_SEMANTIC_SNAPSHOT_HISTORY": {
      void semanticSnapshotCoordinator
        .getHistory(resolveSemanticTabId(msg.payload?.tabId, sender))
        .then((payload) => sendResponse(payload))
        .catch(() => {
          sendResponse({ tabId: null, snapshots: [] })
        })
      return true
    }

    case "TOGGLE_SEMANTIC_SELECTION": {
      void semanticSnapshotCoordinator
        .toggleSelectionMode(resolveSemanticTabId(msg.payload?.tabId, sender))
        .then((payload) => sendResponse(payload))
        .catch(() => {
          sendResponse({ tabId: null, enabled: false, selectedTarget: null })
        })
      return true
    }

    case "GET_SEMANTIC_SELECTION_STATE": {
      void semanticSnapshotCoordinator
        .getSelectionState(resolveSemanticTabId(msg.payload?.tabId, sender))
        .then((payload) => sendResponse(payload))
        .catch(() => {
          sendResponse({ tabId: null, enabled: false, selectedTarget: null })
        })
      return true
    }

    case "CLEAR_SEMANTIC_SELECTION": {
      void semanticSnapshotCoordinator
        .clearSelection(resolveSemanticTabId(msg.payload?.tabId, sender))
        .then((payload) => sendResponse(payload))
        .catch(() => {
          sendResponse({ tabId: null, enabled: false, selectedTarget: null })
        })
      return true
    }

    case "SYNC_SEMANTIC_SELECTION_STATE": {
      const tabId = sender.tab?.id ?? null
      const payload = semanticSnapshotCoordinator.syncSelectionState(tabId, {
          enabled: msg.payload.enabled,
          selectedTarget: msg.payload.selectedTarget
        },
        typeof msg.payload.snapshot !== "undefined" || typeof msg.payload.error !== "undefined"
          ? {
              snapshot: msg.payload.snapshot ?? null,
              error: msg.payload.error ?? null
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
