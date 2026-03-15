import type {
  AudioCaptureControlResponse,
  ServiceWorkerToSidePanelMessage,
  SidePanelToContentMessage
} from "@threadatlas/shared/runtime"
import { describe, expect, it, vi } from "vitest"
import { PageAudioInputProvider } from "../src/sidepanel/content-audio-input"

interface RuntimeMessageSenderLike {
  tab?: {
    id?: number
  }
}

describe("PageAudioInputProvider", () => {
  it("starts page capture, forwards audio chunks, and waits for stop acknowledgement", async () => {
    const listeners = new Set<(message: ServiceWorkerToSidePanelMessage, sender: RuntimeMessageSenderLike) => void>()
    const sendToContentScript = vi.fn(
      async (_tabId: number, _message: SidePanelToContentMessage): Promise<AudioCaptureControlResponse> => ({
        ok: true
      })
    )
    const provider = new PageAudioInputProvider({
      getActiveTabId: () => 17,
      sendToContentScript,
      addRuntimeListener(listener) {
        listeners.add(listener)
      },
      removeRuntimeListener(listener) {
        listeners.delete(listener)
      }
    })

    const chunks: string[] = []
    const states: string[] = []
    provider.onChunkBase64 = (chunkBase64) => {
      chunks.push(chunkBase64)
    }
    provider.onStateChange = (state) => {
      states.push(state)
    }

    await provider.start()

    expect(sendToContentScript).toHaveBeenCalledWith(
      17,
      expect.objectContaining({
        type: "START_PAGE_AUDIO_CAPTURE"
      })
    )

    const startMessage = sendToContentScript.mock.calls[0]?.[1] as Extract<
      SidePanelToContentMessage,
      { type: "START_PAGE_AUDIO_CAPTURE" }
    >
    const sessionId = startMessage.payload.sessionId

    for (const listener of listeners) {
      listener(
        {
          type: "PAGE_AUDIO_CAPTURE_STATE_CHANGED",
          payload: {
            tabId: 17,
            sessionId,
            state: "listening"
          }
        },
        {}
      )
      listener(
        {
          type: "PAGE_AUDIO_CAPTURE_CHUNK",
          payload: {
            tabId: 17,
            sessionId,
            chunkBase64: "audio-chunk"
          }
        },
        {}
      )
    }

    const stopPromise = provider.stop()
    expect(sendToContentScript).toHaveBeenNthCalledWith(
      2,
      17,
      expect.objectContaining({
        type: "STOP_PAGE_AUDIO_CAPTURE"
      })
    )

    for (const listener of listeners) {
      listener(
        {
          type: "PAGE_AUDIO_CAPTURE_STATE_CHANGED",
          payload: {
            tabId: 17,
            sessionId,
            state: "idle"
          }
        },
        {}
      )
    }

    await stopPromise

    expect(chunks).toEqual(["audio-chunk"])
    expect(states).toEqual(["idle", "processing", "listening", "processing"])
  })

  it("surfaces page capture errors and ignores direct content messages", async () => {
    const listeners = new Set<(message: ServiceWorkerToSidePanelMessage, sender: RuntimeMessageSenderLike) => void>()
    const sendToContentScript = vi.fn(
      async (_tabId: number, _message: SidePanelToContentMessage): Promise<AudioCaptureControlResponse> => ({
        ok: true
      })
    )
    const provider = new PageAudioInputProvider({
      getActiveTabId: () => 17,
      sendToContentScript,
      addRuntimeListener(listener) {
        listeners.add(listener)
      },
      removeRuntimeListener(listener) {
        listeners.delete(listener)
      }
    })

    const errors: string[] = []
    provider.onError = (error) => {
      errors.push(error.message)
    }

    await provider.start()
    const sessionId = (
      sendToContentScript.mock.calls[0]?.[1] as Extract<SidePanelToContentMessage, { type: "START_PAGE_AUDIO_CAPTURE" }>
    ).payload.sessionId

    for (const listener of listeners) {
      listener(
        {
          type: "PAGE_AUDIO_CAPTURE_STATE_CHANGED",
          payload: {
            tabId: 17,
            sessionId,
            state: "error",
            detail: "Microphone permission was denied."
          }
        },
        { tab: { id: 17 } }
      )
      listener(
        {
          type: "PAGE_AUDIO_CAPTURE_STATE_CHANGED",
          payload: {
            tabId: 17,
            sessionId,
            state: "error",
            detail: "Microphone permission was denied."
          }
        },
        {}
      )
    }

    expect(errors).toEqual(["Microphone permission was denied."])
  })

  it("cancels the active page capture session", async () => {
    const listeners = new Set<(message: ServiceWorkerToSidePanelMessage, sender: RuntimeMessageSenderLike) => void>()
    const sendToContentScript = vi.fn(
      async (_tabId: number, _message: SidePanelToContentMessage): Promise<AudioCaptureControlResponse> => ({
        ok: true
      })
    )
    const provider = new PageAudioInputProvider({
      getActiveTabId: () => 17,
      sendToContentScript,
      addRuntimeListener(listener) {
        listeners.add(listener)
      },
      removeRuntimeListener(listener) {
        listeners.delete(listener)
      }
    })

    await provider.start()
    await provider.cancel()

    expect(sendToContentScript).toHaveBeenNthCalledWith(
      2,
      17,
      expect.objectContaining({
        type: "CANCEL_PAGE_AUDIO_CAPTURE"
      })
    )
  })
})
