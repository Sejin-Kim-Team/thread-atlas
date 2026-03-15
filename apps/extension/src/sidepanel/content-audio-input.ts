import type {
  AudioCaptureControlResponse,
  ServiceWorkerToSidePanelMessage,
  SidePanelToContentMessage
} from "@threadatlas/shared/runtime"
import type { SpeechInputState } from "./speech-types"
import { measurePcm16Base64Level } from "./audio-level"

interface RuntimeMessageSenderLike {
  tab?: {
    id?: number
  }
}

type RuntimeListener = (
  message: ServiceWorkerToSidePanelMessage,
  sender: RuntimeMessageSenderLike
) => void

function makeCaptureSessionId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `page-audio-${Date.now()}`
}

export interface ContentAudioInputProvider {
  readonly supported: boolean
  start(): Promise<void>
  stop(): Promise<void>
  cancel(): Promise<void>
  dispose(): void
  onLevel?: ((level: number) => void) | undefined
  onChunkBase64?: ((chunkBase64: string) => void) | undefined
  onError?: ((error: Error) => void) | undefined
  onStateChange?: ((state: SpeechInputState, detail?: string) => void) | undefined
}

export class PageAudioInputProvider implements ContentAudioInputProvider {
  readonly supported: boolean
  onLevel?: (level: number) => void
  onChunkBase64?: (chunkBase64: string) => void
  onError?: (error: Error) => void
  onStateChange?: (state: SpeechInputState, detail?: string) => void

  private currentSessionId: string | null = null
  private currentTabId: number | null = null
  private state: SpeechInputState
  private stopPromise: Promise<void> | null = null
  private resolveStop: (() => void) | null = null
  private rejectStop: ((error: Error) => void) | null = null
  private readonly runtimeListener: RuntimeListener

  constructor(
    private readonly args: {
      getActiveTabId: () => number | null
      sendToContentScript: (tabId: number, message: SidePanelToContentMessage) => Promise<AudioCaptureControlResponse>
      addRuntimeListener?: ((listener: RuntimeListener) => void) | undefined
      removeRuntimeListener?: ((listener: RuntimeListener) => void) | undefined
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
      throw new Error("Voice input is unavailable in this browser.")
    }

    const tabId = this.args.getActiveTabId()
    if (tabId === null) {
      throw new Error("No active tab context.")
    }

    await this.cancel()

    const sessionId = makeCaptureSessionId()
    this.currentSessionId = sessionId
    this.currentTabId = tabId
    this.clearStopPromise()
    this.emitState("processing")

    const response = await this.args.sendToContentScript(tabId, {
      type: "START_PAGE_AUDIO_CAPTURE",
      payload: {
        sessionId
      }
    })

    if (!response.ok) {
      this.emitError(response.error ?? "Voice input could not be started on the page.")
      throw new Error(response.error ?? "Voice input could not be started on the page.")
    }
  }

  async stop(): Promise<void> {
    if (!this.currentSessionId || this.currentTabId === null) {
      return
    }

    this.emitState("processing")
    this.stopPromise = new Promise<void>((resolve, reject) => {
      this.resolveStop = resolve
      this.rejectStop = reject
    })

    const response = await this.args.sendToContentScript(this.currentTabId, {
      type: "STOP_PAGE_AUDIO_CAPTURE",
      payload: {
        sessionId: this.currentSessionId
      }
    })

    if (!response.ok) {
      const error = new Error(response.error ?? "Voice input could not be stopped on the page.")
      this.rejectStop?.(error)
      this.clearStopPromise()
      this.emitError(error.message)
      throw error
    }

    await Promise.race([
      this.stopPromise,
      new Promise<void>((_, reject) => {
        window.setTimeout(() => {
          reject(new Error("Voice input did not finish stopping on the page."))
        }, 1500)
      })
    ]).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Voice input did not finish stopping on the page."
      this.emitError(message)
      throw new Error(message)
    })
  }

  async cancel(): Promise<void> {
    const sessionId = this.currentSessionId
    const tabId = this.currentTabId

    this.currentSessionId = null
    this.currentTabId = null
    this.clearStopPromise()

    if (!sessionId || tabId === null) {
      if (this.supported && this.state !== "unsupported") {
        this.onLevel?.(0)
        this.emitState("idle")
      }
      return
    }

    try {
      await this.args.sendToContentScript(tabId, {
        type: "CANCEL_PAGE_AUDIO_CAPTURE",
        payload: {
          sessionId
        }
      })
    } catch {
      // Ignore cancellation failures; local runtime state is already reset.
    }

    if (this.supported) {
      this.onLevel?.(0)
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
    if (sender.tab?.id != null) {
      return
    }

    const payload = "payload" in message ? (message.payload as { tabId?: number | null } | undefined) : undefined
    if (payload?.tabId !== this.currentTabId) {
      return
    }

    switch (message.type) {
      case "PAGE_AUDIO_CAPTURE_STATE_CHANGED":
        if (message.payload.sessionId !== this.currentSessionId) {
          return
        }

        if (message.payload.state === "idle") {
          this.currentSessionId = null
          this.currentTabId = null
          this.resolveStop?.()
          this.clearStopPromise()
          return
        }

        this.emitState(message.payload.state, message.payload.detail)
        if (message.payload.state === "error") {
          this.emitError(message.payload.detail ?? "Voice input failed.")
        }
        if (message.payload.state === "unsupported") {
          this.currentSessionId = null
          this.currentTabId = null
          this.clearStopPromise()
        }
        return
      case "PAGE_AUDIO_CAPTURE_CHUNK":
        if (message.payload.sessionId !== this.currentSessionId) {
          return
        }
        this.onLevel?.(measurePcm16Base64Level(message.payload.chunkBase64))
        this.onChunkBase64?.(message.payload.chunkBase64)
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
    const error = new Error(message)
    this.rejectStop?.(error)
    this.clearStopPromise()
    this.currentSessionId = null
    this.currentTabId = null
    this.onLevel?.(0)
    this.emitState("error", message)
    this.onError?.(error)
  }

  private clearStopPromise(): void {
    this.stopPromise = null
    this.resolveStop = null
    this.rejectStop = null
  }

  private addChromeRuntimeListener(listener: RuntimeListener): void {
    chrome.runtime.onMessage.addListener(listener as Parameters<typeof chrome.runtime.onMessage.addListener>[0])
  }

  private removeChromeRuntimeListener(listener: RuntimeListener): void {
    chrome.runtime.onMessage.removeListener(listener as Parameters<typeof chrome.runtime.onMessage.removeListener>[0])
  }
}
