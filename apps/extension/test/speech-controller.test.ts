import { describe, expect, it, vi } from "vitest"
import { createSpeechController } from "../src/sidepanel/speech-controller"
import type { SpeechInputProvider, SpeechInputState, SpeechOutputProvider } from "../src/sidepanel/speech-types"

function createInputProvider(): SpeechInputProvider & {
  emitPartial(text: string): void
  emitFinal(text: string): void
  emitState(state: SpeechInputState, detail?: string): void
} {
  const provider: SpeechInputProvider & {
    emitPartial(text: string): void
    emitFinal(text: string): void
    emitState(state: SpeechInputState, detail?: string): void
  } = {
    supported: true,
    async start() {
      provider.onStateChange?.("listening")
    },
    async stop() {
      provider.onStateChange?.("processing")
    },
    async cancel() {
      provider.onStateChange?.("idle")
    },
    dispose() {
      return
    },
    emitPartial(text) {
      provider.onPartialTranscript?.(text)
    },
    emitFinal(text) {
      provider.onFinalTranscript?.(text)
    },
    emitState(state, detail) {
      provider.onStateChange?.(state, detail)
    }
  }
  return provider
}

function createOutputProvider(): SpeechOutputProvider & { spoken: string[]; cancelled: number } {
  return {
    supported: true,
    spoken: [],
    cancelled: 0,
    async speak(text: string) {
      this.spoken.push(text)
    },
    cancel() {
      this.cancelled += 1
    },
    dispose() {
      return
    }
  }
}

describe("speech-controller", () => {
  it("combines the base draft with interim and final speech text", async () => {
    const input = createInputProvider()
    const output = createOutputProvider()
    const drafts: string[] = []
    const finalSubmit = vi.fn()
    const states: Array<{ state: SpeechInputState; detail: string | undefined }> = []

    const controller = createSpeechController({
      inputProvider: input,
      outputProvider: output,
      outputEnabled: true,
      onInputStateChange(state, detail) {
        states.push({ state, detail })
      },
      onDraftChange(draft) {
        drafts.push(draft.composedDraft)
      },
      onFinalTranscript(text) {
        finalSubmit(text)
      },
      onOutputError() {
        return
      }
    })

    await controller.startInput("Existing draft")
    input.emitPartial("follow up")
    input.emitFinal("question")

    expect(drafts).toEqual(["Existing draft", "Existing draft follow up", ""])
    expect(finalSubmit).toHaveBeenCalledWith("Existing draft question")
    expect(states.map((item) => item.state)).toContain("listening")
  })

  it("only speaks answers for voice-originated turns", async () => {
    const input = createInputProvider()
    const output = createOutputProvider()
    const controller = createSpeechController({
      inputProvider: input,
      outputProvider: output,
      outputEnabled: true,
      onInputStateChange() {
        return
      },
      onDraftChange() {
        return
      },
      onFinalTranscript() {
        return
      },
      onOutputError() {
        return
      }
    })

    await controller.speakAnswer("Should stay silent", "text")
    await controller.speakAnswer("Should be spoken", "voice")
    controller.setOutputEnabled(false)
    await controller.speakAnswer("Muted answer", "voice")

    expect(output.spoken).toEqual(["Should be spoken"])
    expect(output.cancelled).toBeGreaterThanOrEqual(1)
  })

  it("restores the base draft when voice input is cancelled", async () => {
    const input = createInputProvider()
    const output = createOutputProvider()
    const drafts: string[] = []
    const controller = createSpeechController({
      inputProvider: input,
      outputProvider: output,
      outputEnabled: true,
      onInputStateChange() {
        return
      },
      onDraftChange(draft) {
        drafts.push(draft.composedDraft)
      },
      onFinalTranscript() {
        return
      },
      onOutputError() {
        return
      }
    })

    await controller.startInput("Draft to keep")
    input.emitPartial("temporary words")
    await controller.cancelInput({ restoreBaseDraft: true })

    expect(drafts).toEqual(["Draft to keep", "Draft to keep temporary words", "Draft to keep"])
  })
})
