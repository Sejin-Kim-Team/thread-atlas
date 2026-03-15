import type { SpeechInputProvider, SpeechInputState, SpeechOutputProvider, TurnOrigin } from "./speech-types"

function combineDraft(baseDraft: string, nextDraft: string): string {
  const normalizedBase = baseDraft.trim()
  const normalizedNext = nextDraft.trim()
  if (!normalizedBase) {
    return normalizedNext
  }
  if (!normalizedNext) {
    return normalizedBase
  }
  return `${normalizedBase} ${normalizedNext}`
}

export interface SpeechController {
  readonly inputSupported: boolean
  readonly outputSupported: boolean
  startInput(baseDraft: string): Promise<void>
  stopInput(): Promise<void>
  cancelInput(options?: { restoreBaseDraft?: boolean }): Promise<void>
  cancelOutput(): void
  interruptAll(): Promise<void>
  setOutputEnabled(enabled: boolean): void
  speakAnswer(text: string, origin: TurnOrigin | null): Promise<void>
  dispose(): void
}

export function createSpeechController(args: {
  inputProvider: SpeechInputProvider
  outputProvider: SpeechOutputProvider
  outputEnabled: boolean
  onInputStateChange: (state: SpeechInputState, detail?: string) => void
  onDraftChange: (draft: { baseDraft: string; interimDraft: string; composedDraft: string }) => void
  onFinalTranscript: (text: string) => Promise<void> | void
  onOutputError: (message: string) => void
}): SpeechController {
  let baseDraft = ""
  let interimDraft = ""
  let outputEnabled = args.outputEnabled

  function emitDraft(): void {
    args.onDraftChange({
      baseDraft,
      interimDraft,
      composedDraft: combineDraft(baseDraft, interimDraft)
    })
  }

  args.inputProvider.onStateChange = (state, detail) => {
    args.onInputStateChange(state, detail)
  }
  args.inputProvider.onPartialTranscript = (text) => {
    interimDraft = text
    emitDraft()
  }
  args.inputProvider.onFinalTranscript = (text) => {
    const finalText = combineDraft(baseDraft, text)
    baseDraft = ""
    interimDraft = ""
    emitDraft()
    if (finalText) {
      void args.onFinalTranscript(finalText)
    }
  }
  args.inputProvider.onError = (error) => {
    args.onInputStateChange("error", error.message)
  }
  args.outputProvider.onError = (error) => {
    args.onOutputError(error.message)
  }

  return {
    inputSupported: args.inputProvider.supported,
    outputSupported: args.outputProvider.supported,
    async startInput(nextBaseDraft: string) {
      baseDraft = nextBaseDraft
      interimDraft = ""
      emitDraft()
      args.outputProvider.cancel()
      await args.inputProvider.start()
    },
    async stopInput() {
      await args.inputProvider.stop()
    },
    async cancelInput(options = {}) {
      await args.inputProvider.cancel()
      if (!options.restoreBaseDraft) {
        baseDraft = ""
      }
      interimDraft = ""
      emitDraft()
    },
    cancelOutput() {
      args.outputProvider.cancel()
    },
    async interruptAll() {
      await args.inputProvider.cancel()
      args.outputProvider.cancel()
      baseDraft = ""
      interimDraft = ""
      emitDraft()
    },
    setOutputEnabled(enabled: boolean) {
      outputEnabled = enabled
      if (!enabled) {
        args.outputProvider.cancel()
      }
    },
    async speakAnswer(text: string, origin: TurnOrigin | null) {
      if (!outputEnabled || origin !== "voice") {
        return
      }

      await args.outputProvider.speak(text)
    },
    dispose() {
      args.inputProvider.dispose()
      args.outputProvider.dispose()
    }
  }
}
