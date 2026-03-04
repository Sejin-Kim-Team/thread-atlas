import { DEFAULT_API_BASE_URL, type SidePanelToServiceWorkerMessage, type TokenResponse } from "@threadatlas/shared"

const knownArticleUrls = new Map<string, string>()
const API_BASE_URL = DEFAULT_API_BASE_URL

if (chrome.sidePanel?.setPanelBehavior) {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
}

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId)
  chrome.runtime.sendMessage({
    type: "ACTIVE_TAB_CHANGED",
    payload: {
      tabId: activeInfo.tabId,
      url: tab.url ?? "",
      title: tab.title ?? ""
    }
  })
})

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) {
    return
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

chrome.runtime.onMessage.addListener((msg: SidePanelToServiceWorkerMessage, _sender, sendResponse) => {
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

    default:
      return false
  }
})
