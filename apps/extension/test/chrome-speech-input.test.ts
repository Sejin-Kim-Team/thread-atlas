import { describe, expect, it, vi } from "vitest"
import { ChromeSpeechInputProvider } from "../src/sidepanel/chrome-speech-input"

class FakeRecognition {
  continuous = true
  interimResults = false
  lang = ""
  onstart: ((event: Event) => void) | null = null
  onresult: ((event: Event & { resultIndex: number; results: ArrayLike<{ isFinal: boolean; length: number; [index: number]: { transcript: string } }> }) => void) | null = null
  onerror: ((event: Event & { error?: string; message?: string }) => void) | null = null
  onend: ((event: Event) => void) | null = null
  start = vi.fn(() => {
    this.onstart?.(new Event("start"))
  })
  stop = vi.fn(() => {
    this.onend?.(new Event("end"))
  })
  abort = vi.fn(() => {
    this.onend?.(new Event("end"))
  })
}

function makeResult(isFinal: boolean, transcript: string) {
  return {
    isFinal,
    length: 1,
    0: { transcript }
  }
}

describe("ChromeSpeechInputProvider", () => {
  it("requests microphone access, then streams interim text and emits the final transcript on end", async () => {
    const recognition = new FakeRecognition()
    const stopTrack = vi.fn()
    const requestMicrophoneAccess = vi.fn(async () => ({
      getTracks: () => [{ stop: stopTrack }]
    }))
    const provider = new ChromeSpeechInputProvider({
      createRecognition: () => recognition,
      getLanguage: () => "en-US",
      requestMicrophoneAccess
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
    recognition.onresult?.({
      resultIndex: 0,
      results: [makeResult(false, "Summarize this page")]
    } as unknown as Event & {
      resultIndex: number
      results: ArrayLike<{ isFinal: boolean; length: number; [index: number]: { transcript: string } }>
    })
    recognition.onresult?.({
      resultIndex: 1,
      results: [makeResult(false, "Summarize this page"), makeResult(true, "in one sentence")]
    } as unknown as Event & {
      resultIndex: number
      results: ArrayLike<{ isFinal: boolean; length: number; [index: number]: { transcript: string } }>
    })
    recognition.onend?.(new Event("end"))

    expect(recognition.start).toHaveBeenCalledTimes(1)
    expect(requestMicrophoneAccess).toHaveBeenCalledTimes(1)
    expect(stopTrack).toHaveBeenCalledTimes(1)
    expect(recognition.continuous).toBe(false)
    expect(recognition.interimResults).toBe(true)
    expect(recognition.lang).toBe("en-US")
    expect(partials).toEqual(["", "Summarize this page", "", ""])
    expect(finals).toEqual(["in one sentence"])
    expect(states).toEqual(["idle", "processing", "listening", "processing", "idle"])
  })

  it("maps recognition errors to a readable message", async () => {
    const recognition = new FakeRecognition()
    const requestMicrophoneAccess = vi.fn(async () => ({
      getTracks: () => []
    }))
    const provider = new ChromeSpeechInputProvider({
      createRecognition: () => recognition,
      requestMicrophoneAccess
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
    recognition.onerror?.({ error: "not-allowed" } as Event & { error?: string })
    recognition.onend?.(new Event("end"))

    expect(errors).toEqual(["Microphone permission was denied."])
    expect(states).toContainEqual({
      state: "error",
      detail: "Microphone permission was denied."
    })
  })

  it("surfaces permission denial before speech recognition starts", async () => {
    const recognition = new FakeRecognition()
    const requestMicrophoneAccess = vi.fn(async () => {
      const error = new Error("Permission denied")
      Object.assign(error, { name: "NotAllowedError" })
      throw error
    })
    const provider = new ChromeSpeechInputProvider({
      createRecognition: () => recognition,
      requestMicrophoneAccess
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

    expect(recognition.start).not.toHaveBeenCalled()
    expect(errors).toEqual(["Microphone permission was denied."])
    expect(states).toEqual([
      { state: "idle", detail: undefined },
      { state: "processing", detail: undefined },
      { state: "error", detail: "Microphone permission was denied." }
    ])
  })

  it("reports unsupported input cleanly", async () => {
    const provider = new ChromeSpeechInputProvider({
      browserWindow: {}
    })
    const states: Array<{ state: string; detail: string | undefined }> = []

    provider.onStateChange = (state, detail) => {
      states.push({ state, detail })
    }

    await provider.start()

    expect(provider.supported).toBe(false)
    expect(states).toEqual([
      {
        state: "unsupported",
        detail: "Voice input is unavailable in this browser."
      }
    ])
  })
})
