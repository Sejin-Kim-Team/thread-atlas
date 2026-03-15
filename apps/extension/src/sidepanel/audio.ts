import { ChromeSpeechOutputProvider } from "./chrome-speech-output"
import type { SpeechOutputProvider } from "./speech-types"

export function createAudioOutputProvider(): SpeechOutputProvider {
  return new ChromeSpeechOutputProvider()
}
