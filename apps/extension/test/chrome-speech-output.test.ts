import { beforeEach, describe, expect, it, vi } from "vitest"
import { ChromeSpeechOutputProvider } from "../src/sidepanel/chrome-speech-output"

interface FakeUtterance {
  text: string
  lang: string
  voice: { lang?: string; name?: string } | null
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
}

class FakeSpeechSynthesis {
  readonly listeners = new Map<string, Set<() => void>>()
  readonly spoken: FakeUtterance[] = []
  voices: Array<{ lang?: string; name?: string }> = []
  cancel = vi.fn()

  speak(utterance: FakeUtterance): void {
    this.spoken.push(utterance)
    utterance.onstart?.()
  }

  getVoices(): Array<{ lang?: string; name?: string }> {
    return this.voices
  }

  addEventListener(type: "voiceschanged", listener: () => void): void {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: "voiceschanged", listener: () => void): void {
    this.listeners.get(type)?.delete(listener)
  }

  emitVoicesChanged(): void {
    for (const listener of this.listeners.get("voiceschanged") ?? []) {
      listener()
    }
  }
}

function createUtterance(text: string): FakeUtterance {
  return {
    text,
    lang: "",
    voice: null,
    onstart: null,
    onend: null,
    onerror: null
  }
}

describe("ChromeSpeechOutputProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it("selects a matching voice and speaks the answer", async () => {
    const synth = new FakeSpeechSynthesis()
    synth.voices = [
      { lang: "en-GB", name: "UK voice" },
      { lang: "en-US", name: "US voice" }
    ]
    const provider = new ChromeSpeechOutputProvider({
      browserWindow: {
        navigator: { language: "en-US" },
        speechSynthesis: synth,
        SpeechSynthesisUtterance: class {} as never
      },
      getLanguage: () => "en-US",
      createUtterance
    })

    const speakPromise = provider.speak("Hello there")
    await Promise.resolve()
    expect(synth.cancel).toHaveBeenCalledTimes(1)
    expect(synth.spoken).toHaveLength(1)
    expect(synth.spoken[0]?.voice?.name).toBe("US voice")
    expect(synth.spoken[0]?.lang).toBe("en-US")

    synth.spoken[0]?.onend?.()
    await speakPromise
  })

  it("waits for voiceschanged when the initial voice list is empty", async () => {
    const synth = new FakeSpeechSynthesis()
    const provider = new ChromeSpeechOutputProvider({
      browserWindow: {
        navigator: { language: "ko-KR" },
        speechSynthesis: synth,
        SpeechSynthesisUtterance: class {} as never
      },
      getLanguage: () => "ko-KR",
      createUtterance
    })

    const speakPromise = provider.speak("안녕하세요")
    await Promise.resolve()

    synth.voices = [{ lang: "ko-KR", name: "Korean voice" }]
    synth.emitVoicesChanged()
    await Promise.resolve()
    await Promise.resolve()

    expect(synth.spoken).toHaveLength(1)
    expect(synth.spoken[0]?.voice?.name).toBe("Korean voice")

    synth.spoken[0]?.onend?.()
    await speakPromise
  })

  it("does nothing when speech synthesis is unavailable", async () => {
    const provider = new ChromeSpeechOutputProvider({
      browserWindow: {}
    })

    await provider.speak("No output")

    expect(provider.supported).toBe(false)
  })
})
