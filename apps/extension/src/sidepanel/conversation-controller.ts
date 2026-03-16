import type { AuthClient } from "./auth-client"
import { PageAudioInputProvider, type ContentAudioInputProvider } from "./content-audio-input"
import { LiveAudioOutputPlayer } from "./live-audio-output"
import { RuntimeTransport, type RuntimeTransportHandlers } from "./runtime-transport"
import type { SemanticSnapshot } from "@threadatlas/shared"
import type { AudioCaptureControlResponse, SidePanelToContentMessage, ServiceWorkerToSidePanelMessage } from "@threadatlas/shared/runtime"
import type { SpeechInputState } from "./speech-types"

export interface ConversationControllerHandlers extends RuntimeTransportHandlers {
  onSpeechStateChange?: (state: SpeechInputState, detail?: string) => void
}

interface ConversationAudioOutput {
  readonly supported: boolean
  onLevel?: (level: number) => void
  playChunk(chunkBase64: string): Promise<void>
  stop(): void
  dispose(): Promise<void>
}

interface ConversationRuntimeTransport {
  sendTextTurn(input: {
    activeTabId: number
    snapshot: SemanticSnapshot
    text: string
    language?: string
  }): Promise<void>
  startVoiceTurn(input: {
    activeTabId: number
    snapshot: SemanticSnapshot
    language?: string
  }): Promise<void>
  appendAudioChunk(chunkBase64: string): void
  commitAudio(): void
  interrupt(reason?: string): Promise<void>
  close(): Promise<void>
}

export class ConversationController {
  readonly audioInput: ContentAudioInputProvider
  readonly audioOutput: ConversationAudioOutput
  readonly transport: ConversationRuntimeTransport
  private ttsEnabled: boolean
  private acceptingVoiceInputChunks = false
  private currentVoiceTurnId: string | null = null
  private voiceTurnLifecycle: "idle" | "capturing" | "awaiting-turn" = "idle"

  constructor(
    private readonly args: {
      apiBaseUrl: string
      authClient: Pick<AuthClient, "issueToken">
      getActiveTabId: () => number | null
      sendToContentScript: (tabId: number, message: SidePanelToContentMessage) => Promise<AudioCaptureControlResponse>
      addRuntimeListener?: (
        listener: (message: ServiceWorkerToSidePanelMessage, sender: { tab?: { id?: number } }) => void
      ) => void
      removeRuntimeListener?: (
        listener: (message: ServiceWorkerToSidePanelMessage, sender: { tab?: { id?: number } }) => void
      ) => void
      handlers: ConversationControllerHandlers
      ttsEnabled: boolean
      audioInput?: ContentAudioInputProvider
      audioOutput?: ConversationAudioOutput
      transport?: ConversationRuntimeTransport
    }
  ) {
    this.ttsEnabled = args.ttsEnabled
    this.audioOutput = args.audioOutput ?? new LiveAudioOutputPlayer()
    this.transport =
      args.transport ??
      new RuntimeTransport({
        apiBaseUrl: args.apiBaseUrl,
        authClient: args.authClient,
        handlers: {
          ...args.handlers,
          onTurnStarted: (event) => {
            if (event.payload.modality === "voice") {
              this.currentVoiceTurnId = event.turnId
            }
            args.handlers.onTurnStarted?.(event)
          },
          onAudioChunk: (event) => {
            if (this.ttsEnabled) {
              void this.audioOutput.playChunk(event.payload.chunkBase64)
            }
            args.handlers.onAudioChunk?.(event)
          },
          onTurnDone: (event) => {
            const isCurrentVoiceTurn =
              event.payload.modality === "voice" && event.turnId === this.currentVoiceTurnId
            if (isCurrentVoiceTurn) {
              this.acceptingVoiceInputChunks = false
              this.currentVoiceTurnId = null
              this.voiceTurnLifecycle = "idle"
              if (this.audioInput.supported) {
                void this.audioInput.cancel()
              }
            }
            args.handlers.onTurnDone?.(event)
            if (isCurrentVoiceTurn || event.payload.modality !== "voice") {
              this.notifySpeechState(this.audioInput.supported ? "idle" : "unsupported")
            }
          },
          onError: (error, event) => {
            args.handlers.onError?.(error, event)
            const shouldHandleAsCurrentVoiceError =
              event.turnId != null
                ? event.turnId === this.currentVoiceTurnId
                : this.voiceTurnLifecycle === "awaiting-turn"

            if (shouldHandleAsCurrentVoiceError) {
              this.acceptingVoiceInputChunks = false
              this.currentVoiceTurnId = null
              this.voiceTurnLifecycle = "idle"
              this.audioOutput.stop()
              if (this.audioInput.supported) {
                void this.audioInput.cancel()
              } else {
                this.notifySpeechState("unsupported")
              }
            }
          }
        }
      })
    this.audioInput =
      args.audioInput ??
      new PageAudioInputProvider({
        getActiveTabId: args.getActiveTabId,
        sendToContentScript: args.sendToContentScript,
        addRuntimeListener: args.addRuntimeListener,
        removeRuntimeListener: args.removeRuntimeListener
      })
    this.audioInput.onChunkBase64 = (chunkBase64) => {
      if (!this.acceptingVoiceInputChunks) {
        return
      }
      this.transport.appendAudioChunk(chunkBase64)
    }
    this.audioInput.onError = (error) => {
      this.acceptingVoiceInputChunks = false
      this.audioOutput.stop()
      this.notifySpeechState("error", error.message)
    }
    this.audioInput.onStateChange = (state, detail) => {
      this.notifySpeechState(state, detail)
    }
    this.notifySpeechState(this.audioInput.supported ? "idle" : "unsupported")
  }

  get inputSupported(): boolean {
    return this.audioInput.supported
  }

  get outputSupported(): boolean {
    return this.audioOutput.supported
  }

  setVoiceOutputEnabled(enabled: boolean): void {
    this.ttsEnabled = enabled
    if (!enabled) {
      this.audioOutput.stop()
    }
  }

  async sendTextTurn(input: {
    activeTabId: number
    snapshot: SemanticSnapshot
    text: string
    language?: string
  }): Promise<void> {
    this.acceptingVoiceInputChunks = false
    this.currentVoiceTurnId = null
    this.voiceTurnLifecycle = "idle"
    this.audioOutput.stop()
    await this.transport.sendTextTurn(input)
  }

  async startVoiceTurn(input: {
    activeTabId: number
    snapshot: SemanticSnapshot
    language?: string
  }): Promise<void> {
    if (!this.audioInput.supported) {
      throw new Error("Voice input is unavailable in this browser.")
    }

    this.acceptingVoiceInputChunks = false
    this.currentVoiceTurnId = null
    this.voiceTurnLifecycle = "capturing"
    this.audioOutput.stop()
    await this.transport.startVoiceTurn(input)
    try {
      await this.audioInput.start()
      this.acceptingVoiceInputChunks = true
    } catch (error) {
      this.acceptingVoiceInputChunks = false
      throw error
    }
  }

  async finishVoiceTurn(): Promise<void> {
    if (!this.audioInput.supported || this.voiceTurnLifecycle !== "capturing") {
      return
    }
    this.acceptingVoiceInputChunks = false
    this.voiceTurnLifecycle = "awaiting-turn"
    try {
      await this.audioInput.stop()
      this.transport.commitAudio()
    } catch (error) {
      this.voiceTurnLifecycle = "idle"
      throw error
    }
  }

  async cancelVoiceTurn(): Promise<void> {
    this.acceptingVoiceInputChunks = false
    this.currentVoiceTurnId = null
    this.voiceTurnLifecycle = "idle"
    if (this.audioInput.supported) {
      await this.audioInput.cancel()
    }
    await this.transport.interrupt("cancelled")
    this.audioOutput.stop()
    this.notifySpeechState(this.audioInput.supported ? "idle" : "unsupported")
  }

  async interrupt(reason: string): Promise<void> {
    this.acceptingVoiceInputChunks = false
    this.currentVoiceTurnId = null
    this.voiceTurnLifecycle = "idle"
    if (this.audioInput.supported) {
      await this.audioInput.cancel()
    }
    await this.transport.interrupt(reason)
    this.audioOutput.stop()
    this.notifySpeechState(this.audioInput.supported ? "idle" : "unsupported")
  }

  async close(): Promise<void> {
    this.acceptingVoiceInputChunks = false
    this.currentVoiceTurnId = null
    this.voiceTurnLifecycle = "idle"
    if (this.audioInput.supported) {
      await this.audioInput.cancel()
    }
    this.audioInput.dispose()
    await this.transport.close()
    await this.audioOutput.dispose()
  }

  private notifySpeechState(state: SpeechInputState, detail?: string): void {
    this.args.handlers.onSpeechStateChange?.(state, detail)
  }
}
