export type SpeechInputState = "idle" | "listening" | "processing" | "unsupported" | "error"

export type TurnOrigin = "text" | "voice"

export interface SpeechInputProvider {
  readonly supported: boolean
  start(): Promise<void>
  stop(): Promise<void>
  cancel(): Promise<void>
  dispose(): void
  onPartialTranscript?: (text: string) => void
  onFinalTranscript?: (text: string) => void
  onError?: (error: Error) => void
  onStateChange?: (state: SpeechInputState, detail?: string) => void
}

export interface SpeechOutputProvider {
  readonly supported: boolean
  speak(text: string): Promise<void>
  cancel(): void
  dispose(): void
  onStart?: () => void
  onEnd?: () => void
  onError?: (error: Error) => void
}
