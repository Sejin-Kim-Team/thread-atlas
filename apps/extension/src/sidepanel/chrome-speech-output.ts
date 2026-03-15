import type { SpeechOutputProvider } from "./speech-types"

interface SpeechSynthesisVoiceLike {
  lang?: string
  name?: string
}

interface SpeechSynthesisUtteranceLike {
  lang: string
  voice: SpeechSynthesisVoiceLike | null
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
}

interface SpeechSynthesisLike {
  speak(utterance: SpeechSynthesisUtteranceLike): void
  cancel(): void
  getVoices(): SpeechSynthesisVoiceLike[]
  addEventListener(type: "voiceschanged", listener: () => void): void
  removeEventListener(type: "voiceschanged", listener: () => void): void
}

interface BrowserWindowLike {
  navigator?: {
    language?: string
  }
  speechSynthesis?: SpeechSynthesisLike
  SpeechSynthesisUtterance?: new (text: string) => SpeechSynthesisUtteranceLike
}

function normalizeLanguage(value: string | undefined): string {
  return value?.trim().toLowerCase() || "en-us"
}

export class ChromeSpeechOutputProvider implements SpeechOutputProvider {
  readonly supported: boolean
  onStart?: () => void
  onEnd?: () => void
  onError?: (error: Error) => void

  private readonly synth: SpeechSynthesisLike | null
  private readonly createUtterance: ((text: string) => SpeechSynthesisUtteranceLike) | null
  private cachedVoices: SpeechSynthesisVoiceLike[] = []
  private currentUtterance: SpeechSynthesisUtteranceLike | null = null
  private readonly handleVoicesChanged = (): void => {
    this.cachedVoices = this.synth?.getVoices() ?? []
  }

  constructor(
    private readonly args: {
      browserWindow?: BrowserWindowLike
      getLanguage?: () => string
      createUtterance?: (text: string) => SpeechSynthesisUtteranceLike
    } = {}
  ) {
    const browserWindow = args.browserWindow ?? (window as unknown as BrowserWindowLike)
    this.synth = browserWindow.speechSynthesis ?? null
    this.createUtterance = args.createUtterance
      ? args.createUtterance
      : typeof browserWindow.SpeechSynthesisUtterance === "function"
        ? (text) => new browserWindow.SpeechSynthesisUtterance!(text)
        : null
    this.supported = Boolean(this.synth && this.createUtterance)
    if (this.supported) {
      this.cachedVoices = this.synth?.getVoices() ?? []
      this.synth?.addEventListener("voiceschanged", this.handleVoicesChanged)
    }
  }

  async speak(text: string): Promise<void> {
    const normalizedText = text.trim()
    if (!this.supported || !normalizedText || !this.synth || !this.createUtterance) {
      return
    }

    const synth = this.synth
    this.cancel()
    await this.waitForVoices()

    const utterance = this.createUtterance(normalizedText)
    const preferredLanguage = normalizeLanguage(this.args.getLanguage?.() ?? window.navigator.language)
    const voice = this.selectVoice(preferredLanguage)
    utterance.lang = voice?.lang ?? preferredLanguage
    utterance.voice = voice ?? null

    await new Promise<void>((resolve) => {
      utterance.onstart = () => {
        this.onStart?.()
      }
      utterance.onend = () => {
        if (this.currentUtterance === utterance) {
          this.currentUtterance = null
        }
        this.onEnd?.()
        resolve()
      }
      utterance.onerror = () => {
        if (this.currentUtterance === utterance) {
          this.currentUtterance = null
        }
        this.onError?.(new Error("Voice output failed."))
        resolve()
      }

      this.currentUtterance = utterance
      synth.speak(utterance)
    })
  }

  cancel(): void {
    if (!this.supported) {
      return
    }

    this.currentUtterance = null
    this.synth?.cancel()
  }

  dispose(): void {
    this.cancel()
    this.synth?.removeEventListener("voiceschanged", this.handleVoicesChanged)
  }

  private async waitForVoices(): Promise<void> {
    if (this.cachedVoices.length > 0 || !this.synth) {
      return
    }

    const synth = this.synth
    await new Promise<void>((resolve) => {
      const timeoutId = window.setTimeout(() => {
        synth.removeEventListener("voiceschanged", handleReady)
        resolve()
      }, 400)

      const handleReady = () => {
        this.cachedVoices = synth.getVoices() ?? []
        if (this.cachedVoices.length === 0) {
          return
        }

        window.clearTimeout(timeoutId)
        synth.removeEventListener("voiceschanged", handleReady)
        resolve()
      }

      synth.addEventListener("voiceschanged", handleReady)
      handleReady()
    })
  }

  private selectVoice(language: string): SpeechSynthesisVoiceLike | undefined {
    if (this.cachedVoices.length === 0) {
      this.cachedVoices = this.synth?.getVoices() ?? []
    }

    const exactMatch = this.cachedVoices.find((voice) => normalizeLanguage(voice.lang) === language)
    if (exactMatch) {
      return exactMatch
    }

    const prefix = language.split("-")[0] ?? language
    return this.cachedVoices.find((voice) => normalizeLanguage(voice.lang).startsWith(prefix))
  }
}
