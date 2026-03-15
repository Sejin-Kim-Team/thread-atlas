import type { SpeechInputProvider, SpeechInputState } from "./speech-types"

interface SpeechRecognitionAlternativeLike {
  transcript: string
}

interface SpeechRecognitionResultLike {
  isFinal: boolean
  length: number
  [index: number]: SpeechRecognitionAlternativeLike
}

interface SpeechRecognitionResultListLike {
  length: number
  [index: number]: SpeechRecognitionResultLike
}

interface SpeechRecognitionErrorEventLike extends Event {
  error?: string
  message?: string
}

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number
  results: SpeechRecognitionResultListLike
}

interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  onstart: ((event: Event) => void) | null
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: ((event: Event) => void) | null
  start(): void
  stop(): void
  abort(): void
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

interface BrowserWindowLike {
  webkitSpeechRecognition?: SpeechRecognitionConstructor
  navigator?: {
    language?: string
    mediaDevices?: {
      getUserMedia(constraints: { audio: boolean }): Promise<MediaStreamLike>
    }
  }
}

interface MediaStreamTrackLike {
  stop(): void
}

interface MediaStreamLike {
  getTracks(): MediaStreamTrackLike[]
}

function normalizeTranscript(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function joinTranscript(base: string, next: string): string {
  const normalizedBase = normalizeTranscript(base)
  const normalizedNext = normalizeTranscript(next)
  if (!normalizedBase) {
    return normalizedNext
  }
  if (!normalizedNext) {
    return normalizedBase
  }
  return `${normalizedBase} ${normalizedNext}`
}

function mapRecognitionError(event: SpeechRecognitionErrorEventLike): string {
  switch (event.error) {
    case "aborted":
      return "Voice input was interrupted."
    case "audio-capture":
      return "Microphone capture failed."
    case "network":
      return "Voice input network request failed."
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone permission was denied."
    case "no-speech":
      return "No speech was detected."
    default:
      return event.message?.trim() || "Voice input failed."
  }
}

function mapMicrophonePermissionError(error: unknown): string {
  const name = typeof error === "object" && error !== null && "name" in error ? String((error as { name?: unknown }).name) : ""
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "Microphone permission was denied."
    case "NotFoundError":
      return "No microphone was found."
    case "NotReadableError":
    case "TrackStartError":
      return "Microphone capture failed."
    default:
      return error instanceof Error && error.message.trim().length > 0
        ? error.message
        : "Microphone permission could not be requested."
  }
}

export class ChromeSpeechInputProvider implements SpeechInputProvider {
  readonly supported: boolean
  onPartialTranscript?: (text: string) => void
  onFinalTranscript?: (text: string) => void
  onError?: (error: Error) => void
  onStateChange?: (state: SpeechInputState, detail?: string) => void

  private recognition: SpeechRecognitionLike | null = null
  private readonly recognitionCtor: SpeechRecognitionConstructor | null
  private finalTranscript = ""
  private cancelRequested = false
  private state: SpeechInputState

  constructor(
    private readonly args: {
      browserWindow?: BrowserWindowLike
      getLanguage?: () => string
      createRecognition?: () => SpeechRecognitionLike
      requestMicrophoneAccess?: () => Promise<MediaStreamLike>
    } = {}
  ) {
    const browserWindow = args.browserWindow ?? (window as unknown as BrowserWindowLike)
    this.recognitionCtor = args.createRecognition
      ? null
      : typeof browserWindow.webkitSpeechRecognition === "function"
        ? browserWindow.webkitSpeechRecognition
        : null
    this.supported = Boolean(args.createRecognition || this.recognitionCtor)
    this.state = this.supported ? "idle" : "unsupported"
  }

  async start(): Promise<void> {
    if (!this.supported) {
      this.emitState("unsupported", "Voice input is unavailable in this browser.")
      return
    }

    await this.cancel()
    this.cancelRequested = false
    this.finalTranscript = ""
    this.onPartialTranscript?.("")
    this.emitState("processing")

    try {
      await this.requestMicrophoneAccess()
    } catch (error) {
      const message = mapMicrophonePermissionError(error)
      this.emitState("error", message)
      this.onError?.(new Error(message))
      return
    }

    const recognition = this.args.createRecognition?.() ?? (this.recognitionCtor ? new this.recognitionCtor() : null)
    if (!recognition) {
      this.emitState("unsupported", "Voice input is unavailable in this browser.")
      return
    }

    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = this.args.getLanguage?.() ?? window.navigator.language
    recognition.onstart = () => {
      this.emitState("listening")
    }
    recognition.onresult = (event) => {
      let interimTranscript = ""
      for (let idx = event.resultIndex; idx < event.results.length; idx += 1) {
        const result = event.results[idx]
        if (!result || !result[0]) {
          continue
        }
        if (result.isFinal) {
          this.finalTranscript = joinTranscript(this.finalTranscript, result[0].transcript)
        } else {
          interimTranscript = joinTranscript(interimTranscript, result[0].transcript)
        }
      }

      this.onPartialTranscript?.(normalizeTranscript(interimTranscript))
      if (this.finalTranscript) {
        this.emitState("processing")
      }
    }
    recognition.onerror = (event) => {
      if (this.cancelRequested && event.error === "aborted") {
        return
      }

      const message = mapRecognitionError(event)
      this.emitState("error", message)
      this.onError?.(new Error(message))
    }
    recognition.onend = () => {
      const finalTranscript = normalizeTranscript(this.finalTranscript)
      this.recognition = null
      this.finalTranscript = ""
      this.cancelRequested = false
      this.onPartialTranscript?.("")
      if (finalTranscript) {
        this.onFinalTranscript?.(finalTranscript)
      }
      if (this.state !== "error") {
        this.emitState("idle")
      }
    }

    this.recognition = recognition
    recognition.start()
  }

  async stop(): Promise<void> {
    if (!this.recognition) {
      return
    }

    this.emitState("processing")
    this.recognition.stop()
  }

  async cancel(): Promise<void> {
    if (!this.recognition) {
      if (this.supported && this.state !== "unsupported") {
        this.emitState("idle")
      }
      return
    }

    this.cancelRequested = true
    this.finalTranscript = ""
    this.recognition.abort()
    this.recognition = null
    this.onPartialTranscript?.("")
    if (this.supported) {
      this.emitState("idle")
    }
  }

  dispose(): void {
    void this.cancel()
  }

  private emitState(state: SpeechInputState, detail?: string): void {
    this.state = state
    this.onStateChange?.(state, detail)
  }

  private async requestMicrophoneAccess(): Promise<void> {
    const browserWindow = this.args.browserWindow ?? (window as unknown as BrowserWindowLike)
    const requestAccess =
      this.args.requestMicrophoneAccess ??
      (browserWindow.navigator?.mediaDevices?.getUserMedia
        ? () => browserWindow.navigator!.mediaDevices!.getUserMedia({ audio: true })
        : null)

    if (!requestAccess) {
      return
    }

    const stream = await requestAccess()
    for (const track of stream.getTracks()) {
      track.stop()
    }
  }
}
