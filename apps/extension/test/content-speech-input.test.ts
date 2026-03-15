import type { ServiceWorkerToSidePanelMessage, SidePanelToContentMessage, SpeechInputControlResponse } from "@threadatlas/shared/runtime"
import { describe, expect, it, vi } from "vitest"
import { ContentSpeechInputProvider } from "../src/sidepanel/content-speech-input"

interface RuntimeMessageSenderLike {
  tab?: {
    id?: number
  }
}

describe("ContentSpeechInputProvider", () => {
  it("starts recognition on the active tab and consumes partial/final events", async () => {
    const listeners = new Set<(message: ServiceWorkerToSidePanelMessage, sender: RuntimeMessageSenderLike) => void>()
    const sendToContentScript = vi.fn(
      async (_tabId: number, _message: SidePanelToContentMessage): Promise<SpeechInputControlResponse> => ({
        ok: true
      })
    )
    const provider = new ContentSpeechInputProvider({
      getActiveTabId: () => 17,
      getLanguage: () => "en-US",
      sendToContentScript,
      addRuntimeListener(listener) {
        listeners.add(listener)
      },
      removeRuntimeListener(listener) {
        listeners.delete(listener)
      }
    })
    const partials: string[] = []
    const finals: string[] = []
    const states: string[] = []

    provider.onPartialTranscript = (text) => {
      partials.push(text)
    }
    provider.onFinalTranscript = (text) => {
      finals.push(text)
    }
    provider.onStateChange = (state) => {
      states.push(state)
    }

    await provider.start()

    expect(sendToContentScript).toHaveBeenCalledTimes(1)
    const startMessage = sendToContentScript.mock.calls[0]?.[1]
    expect(startMessage).toMatchObject({
      type: "START_PAGE_SPEECH_INPUT",
      payload: {
        language: "en-US"
      }
    })

    const sessionId = (startMessage as Extract<SidePanelToContentMessage, { type: "START_PAGE_SPEECH_INPUT" }>).payload.sessionId
    for (const listener of listeners) {
      listener(
        {
          type: "PAGE_SPEECH_STATE_CHANGED",
          payload: {
            sessionId,
            state: "listening"
          }
        },
        { tab: { id: 17 } }
      )
      listener(
        {
          type: "PAGE_SPEECH_PARTIAL",
          payload: {
            sessionId,
            text: "Summarize this page"
          }
        },
        { tab: { id: 17 } }
      )
      listener(
        {
          type: "PAGE_SPEECH_FINAL",
          payload: {
            sessionId,
            text: "Summarize this page"
          }
        },
        { tab: { id: 17 } }
      )
      listener(
        {
          type: "PAGE_SPEECH_STATE_CHANGED",
          payload: {
            sessionId,
            state: "idle"
          }
        },
        { tab: { id: 17 } }
      )
    }

    expect(partials).toEqual(["", "Summarize this page"])
    expect(finals).toEqual(["Summarize this page"])
    expect(states).toEqual(["idle", "processing", "listening", "idle"])
  })

  it("surfaces page speech errors and ignores events from other tabs", async () => {
    const listeners = new Set<(message: ServiceWorkerToSidePanelMessage, sender: RuntimeMessageSenderLike) => void>()
    const sendToContentScript = vi.fn(
      async (_tabId: number, _message: SidePanelToContentMessage): Promise<SpeechInputControlResponse> => ({
        ok: true
      })
    )
    const provider = new ContentSpeechInputProvider({
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
    const states: Array<{ state: string; detail: string | undefined }> = []

    provider.onError = (error) => {
      errors.push(error.message)
    }
    provider.onStateChange = (state, detail) => {
      states.push({ state, detail })
    }

    await provider.start()
    const sessionId = (
      sendToContentScript.mock.calls[0]?.[1] as Extract<SidePanelToContentMessage, { type: "START_PAGE_SPEECH_INPUT" }>
    ).payload.sessionId

    for (const listener of listeners) {
      listener(
        {
          type: "PAGE_SPEECH_STATE_CHANGED",
          payload: {
            sessionId,
            state: "error",
            detail: "Speech recognition is unavailable in this browsing context."
          }
        },
        { tab: { id: 999 } }
      )
      listener(
        {
          type: "PAGE_SPEECH_STATE_CHANGED",
          payload: {
            sessionId,
            state: "error",
            detail: "Speech recognition is unavailable in this browsing context."
          }
        },
        { tab: { id: 17 } }
      )
    }

    expect(errors).toEqual(["Speech recognition is unavailable in this browsing context."])
    expect(states).toContainEqual({
      state: "error",
      detail: "Speech recognition is unavailable in this browsing context."
    })
  })

  it("cancels the active page speech session", async () => {
    const listeners = new Set<(message: ServiceWorkerToSidePanelMessage, sender: RuntimeMessageSenderLike) => void>()
    const sendToContentScript = vi.fn(
      async (_tabId: number, _message: SidePanelToContentMessage): Promise<SpeechInputControlResponse> => ({
        ok: true
      })
    )
    const provider = new ContentSpeechInputProvider({
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
        type: "CANCEL_PAGE_SPEECH_INPUT"
      })
    )
  })
})
