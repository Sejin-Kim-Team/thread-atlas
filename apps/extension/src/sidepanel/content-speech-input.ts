import type {
  SidePanelToContentMessage,
  SpeechInputControlResponse,
  ServiceWorkerToSidePanelMessage
} from "@threadatlas/shared/runtime"
import type { SpeechInputProvider, SpeechInputState } from "./speech-types"

interface RuntimeMessageSenderLike {
  tab?: {
    id?: number
  }
}

type RuntimeListener = (
  message: ServiceWorkerToSidePanelMessage,
  sender: RuntimeMessageSenderLike
) => void

function makeSessionId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `page-speech-${Date.now()}`
}

export class ContentSpeechInputProvider implements SpeechInputProvider {
  readonly supported: boolean
  onPartialTranscript?: (text: string) => void
  onFinalTranscript?: (text: string) => void
  onError?: (error: Error) => void
  onStateChange?: (state: SpeechInputState, detail?: string) => void

  private currentSessionId: string | null = null
  private currentTabId: number | null = null
  private state: SpeechInputState
  private readonly runtimeListener: RuntimeListener

  constructor(
    private readonly args: {
      getActiveTabId: () => number | null
      getLanguage?: () => string
      sendToContentScript: (tabId: number, message: SidePanelToContentMessage) => Promise<SpeechInputControlResponse>
      addRuntimeListener?: (listener: RuntimeListener) => void
      removeRuntimeListener?: (listener: RuntimeListener) => void
    }
  ) {
    const hasInjectedRuntimeBridge =
      typeof args.addRuntimeListener === "function" && typeof args.removeRuntimeListener === "function"
    const hasChromeRuntimeBridge = typeof chrome !== "undefined" && Boolean(chrome.runtime?.onMessage)
    this.supported =
      typeof args.sendToContentScript === "function" &&
      (hasInjectedRuntimeBridge || hasChromeRuntimeBridge)
    this.state = this.supported ? "idle" : "unsupported"
    this.runtimeListener = (message, sender) => {
      this.handleRuntimeMessage(message, sender)
    }
    if (this.supported) {
      ;(args.addRuntimeListener ?? this.addChromeRuntimeListener)(this.runtimeListener)
    }
  }

  async start(): Promise<void> {
    if (!this.supported) {
      this.emitState("unsupported", "Voice input is unavailable in this browser.")
      return
    }

    const tabId = this.args.getActiveTabId()
    if (tabId === null) {
      this.emitError("No active tab context.")
      return
    }

    await this.cancel()

    const sessionId = makeSessionId()
    this.currentSessionId = sessionId
    this.currentTabId = tabId
    this.onPartialTranscript?.("")
    this.emitState("processing")

    try {
      const response = await this.args.sendToContentScript(tabId, {
        type: "START_PAGE_SPEECH_INPUT",
        payload: {
          sessionId,
          language: this.args.getLanguage?.() ?? window.navigator.language
        }
      })

      if (!response.ok) {
        this.emitError(response.error ?? "Voice input could not be started on the page.")
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Voice input could not be started on the page."
      this.emitError(message)
    }
  }

  async stop(): Promise<void> {
    if (!this.currentSessionId || this.currentTabId === null) {
      return
    }

    this.emitState("processing")
    try {
      await this.args.sendToContentScript(this.currentTabId, {
        type: "STOP_PAGE_SPEECH_INPUT",
        payload: {
          sessionId: this.currentSessionId
        }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Voice input could not be stopped on the page."
      this.emitError(message)
    }
  }

  async cancel(): Promise<void> {
    if (!this.currentSessionId || this.currentTabId === null) {
      if (this.supported && this.state !== "unsupported") {
        this.emitState("idle")
      }
      return
    }

    const sessionId = this.currentSessionId
    const tabId = this.currentTabId
    this.currentSessionId = null
    this.currentTabId = null
    this.onPartialTranscript?.("")

    try {
      await this.args.sendToContentScript(tabId, {
        type: "CANCEL_PAGE_SPEECH_INPUT",
        payload: {
          sessionId
        }
      })
    } catch {
      // Ignore cancellation failures; the UI still needs to reset locally.
    }

    if (this.supported) {
      this.emitState("idle")
    }
  }

  dispose(): void {
    void this.cancel()
    if (this.supported) {
      ;(this.args.removeRuntimeListener ?? this.removeChromeRuntimeListener)(this.runtimeListener)
    }
  }

  private handleRuntimeMessage(message: ServiceWorkerToSidePanelMessage, sender: RuntimeMessageSenderLike): void {
    if (sender.tab?.id !== this.currentTabId || !this.currentSessionId) {
      return
    }

    switch (message.type) {
      case "PAGE_SPEECH_STATE_CHANGED":
        if (message.payload.sessionId !== this.currentSessionId) {
          return
        }
        this.emitState(message.payload.state, message.payload.detail)
        if (message.payload.state === "error") {
          this.onError?.(new Error(message.payload.detail ?? "Voice input failed."))
          this.currentSessionId = null
          this.currentTabId = null
        }
        if (message.payload.state === "unsupported" || message.payload.state === "idle") {
          this.currentSessionId = null
          this.currentTabId = null
        }
        return
      case "PAGE_SPEECH_PARTIAL":
        if (message.payload.sessionId !== this.currentSessionId) {
          return
        }
        this.onPartialTranscript?.(message.payload.text)
        return
      case "PAGE_SPEECH_FINAL":
        if (message.payload.sessionId !== this.currentSessionId) {
          return
        }
        this.onFinalTranscript?.(message.payload.text)
        return
      default:
        return
    }
  }

  private emitState(state: SpeechInputState, detail?: string): void {
    this.state = state
    this.onStateChange?.(state, detail)
  }

  private emitError(message: string): void {
    this.emitState("error", message)
    this.onError?.(new Error(message))
    this.currentSessionId = null
    this.currentTabId = null
  }

  private addChromeRuntimeListener(listener: RuntimeListener): void {
    chrome.runtime.onMessage.addListener(listener as Parameters<typeof chrome.runtime.onMessage.addListener>[0])
  }

  private removeChromeRuntimeListener(listener: RuntimeListener): void {
    chrome.runtime.onMessage.removeListener(listener as Parameters<typeof chrome.runtime.onMessage.removeListener>[0])
  }
}
