import {
  DEFAULT_API_BASE_URL,
  type AnyRuntimeMessage,
  type ConversationContext,
  type Intent,
  type Projection,
  type SensorData,
  type ThreadSemantics,
  type TokenResponse
} from "@threadatlas/shared"
import { assembleStateSnapshot } from "./state-assembler"
import { callEvaluate } from "./sse-client"
import { routeProjection } from "./projection-router"
import { ContentGraphManager } from "./content-graph"
import { connectGeminiLive, type LiveSession } from "./gemini-live"
import { initializeAudio } from "./audio"
import { TokenManager } from "./token-manager"
import { renderPresent, showNotify, showSuggestChips, updatePhaseIndicator, type Phase } from "./ui"

interface SidePanelState {
  phase: Phase
  geminiLiveSession: LiveSession | null
  tokenExpiresAt: number | null
  contentGraph: ContentGraphManager
  activeTabId: number | null
  conversationContext: ConversationContext | null
  cachedSemantics: ThreadSemantics | null
  currentAbortController: AbortController | null
}

const API_BASE_URL = window.localStorage.getItem("THREADATLAS_API_BASE_URL") ?? DEFAULT_API_BASE_URL

const state: SidePanelState = {
  phase: "initializing",
  geminiLiveSession: null,
  tokenExpiresAt: null,
  contentGraph: new ContentGraphManager(),
  activeTabId: null,
  conversationContext: null,
  cachedSemantics: null,
  currentAbortController: null
}

function setPhase(phase: Phase): void {
  state.phase = phase
  updatePhaseIndicator(phase)
}

async function sendRuntimeMessage<TResponse>(message: AnyRuntimeMessage): Promise<TResponse> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
      reject(new Error("chrome.runtime.sendMessage unavailable"))
      return
    }

    chrome.runtime.sendMessage(message, (response: TResponse) => {
      const runtimeError = chrome.runtime.lastError
      if (runtimeError) {
        reject(new Error(runtimeError.message))
        return
      }
      resolve(response)
    })
  })
}

async function sendToContentScript<TResponse>(tabId: number, message: unknown): Promise<TResponse> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === "undefined" || !chrome.tabs?.sendMessage) {
      reject(new Error("chrome.tabs.sendMessage unavailable"))
      return
    }

    chrome.tabs.sendMessage(tabId, message, (response: TResponse) => {
      const runtimeError = chrome.runtime.lastError
      if (runtimeError) {
        reject(new Error(runtimeError.message))
        return
      }
      resolve(response)
    })
  })
}

async function requestToken(): Promise<TokenResponse> {
  if (typeof chrome !== "undefined" && chrome.runtime) {
    try {
      return await sendRuntimeMessage<TokenResponse>({ type: "REQUEST_TOKEN" })
    } catch {
      // fall back to direct API call
    }
  }

  const response = await fetch(`${API_BASE_URL}/api/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: "user_sungwoo" })
  })
  return (await response.json()) as TokenResponse
}

function splitSuggestOptions(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4)
}

async function executeProjection(projection: Projection): Promise<void> {
  routeProjection(projection, {
    respond(payload) {
      state.geminiLiveSession?.sendFunctionResult({
        name: "agentResponse",
        response: { text: payload.text }
      })

      if (payload.mode === "suggest") {
        const options = splitSuggestOptions(payload.text)
        showSuggestChips(options, (choice) => {
          state.geminiLiveSession?.sendText(choice)
        })
      }
    },
    focus(payload) {
      if (state.activeTabId === null) {
        return
      }
      void sendToContentScript(state.activeTabId, {
        type: "EXECUTE_PROJECTION",
        projection: payload
      })
    },
    navigate(payload) {
      if (typeof chrome !== "undefined" && chrome.tabs?.create) {
        chrome.tabs.create({ url: payload.url, active: payload.options?.activate ?? true })
      }
    },
    present(payload) {
      renderPresent(payload.content)
    },
    notify(payload) {
      showNotify(payload.message, payload.level)
    },
    copy(payload) {
      void navigator.clipboard.writeText(payload.text)
    }
  })
}

async function captureViewportIfNeeded(intent: Intent): Promise<string | null> {
  if (intent.intentType !== "contextual_query" && intent.intentType !== "general") {
    return null
  }

  try {
    const response = await sendRuntimeMessage<{ viewport: string | null }>({ type: "CAPTURE_VIEWPORT" })
    return response.viewport
  } catch {
    return null
  }
}

async function handleUserIntent(intent: Intent): Promise<void> {
  if (state.activeTabId === null) {
    showNotify("No active tab context.", "error")
    return
  }

  setPhase("conversing")

  if (state.currentAbortController) {
    state.currentAbortController.abort()
  }

  const abortController = new AbortController()
  state.currentAbortController = abortController

  const sensors = await sendToContentScript<SensorData>(state.activeTabId, {
    type: "COLLECT_SENSORS"
  })

  const viewport = await captureViewportIfNeeded(intent)

  const snapshot = await assembleStateSnapshot({
    intent,
    sensors,
    contentGraph: state.contentGraph,
    cachedSemantics: state.cachedSemantics,
    conversationContext: state.conversationContext,
    viewport
  })

  const request =
    state.conversationContext !== null
      ? {
          stateSnapshot: snapshot,
          conversationContext: state.conversationContext
        }
      : {
          stateSnapshot: snapshot
        }

  await callEvaluate({
    apiBaseUrl: API_BASE_URL,
    request,
    signal: abortController.signal,
    onProjection(projection) {
      void executeProjection(projection)
    },
    onDone(payload) {
      state.conversationContext = payload.conversationContext
      setPhase("ready")
    },
    onError(payload) {
      showNotify(payload.message, "error")
      setPhase("ready")
    }
  })
}

async function initialize(): Promise<void> {
  setPhase("initializing")

  await initializeAudio()

  const tokenManager = new TokenManager(
    requestToken,
    async (token) => {
      state.geminiLiveSession = await connectGeminiLive(token)
    },
    (error) => {
      setPhase("error")
      showNotify(error.message, "error")
    }
  )

  const token = await tokenManager.initialize()
  state.geminiLiveSession = await connectGeminiLive(token)
  state.geminiLiveSession.onFunctionCall = handleUserIntent

  if (typeof chrome !== "undefined" && chrome.tabs?.query) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      state.activeTabId = tabs[0]?.id ?? null
    })
  }

  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message: AnyRuntimeMessage) => {
      if (message.type === "ACTIVE_TAB_CHANGED") {
        state.activeTabId = message.payload.tabId
        const isHnThread = /news\.ycombinator\.com\/item\?id=\d+/.test(message.payload.url)
        setPhase(isHnThread ? "ready" : "dormant")
      }

      if (message.type === "ARTICLE_CONTENT") {
        state.contentGraph.addArticle(
          message.payload.url,
          message.payload.title,
          message.payload.text,
          message.payload.structure,
          message.payload.extractedAt
        )
      }
    })
  }

  setPhase("ready")
}

void initialize().catch((error) => {
  setPhase("error")
  showNotify(error instanceof Error ? error.message : "failed to initialize", "error")
})
