import type { AuthClient } from "./auth-client"
import {
  VoiceSessionTransport,
  type VoiceSessionTransportHandlers
} from "./voice-session-transport"

export function createGeminiLiveTransport(args: {
  apiBaseUrl: string
  authClient: Pick<AuthClient, "issueToken">
  handlers: VoiceSessionTransportHandlers
}): VoiceSessionTransport {
  return new VoiceSessionTransport(args)
}

export { VoiceSessionTransport }
export type { VoiceSessionTransportHandlers }
