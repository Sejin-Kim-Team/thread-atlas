import type { Intent } from "@threadatlas/shared"

export interface LiveSession {
  sendFunctionResult(payload: { name: string; response: { text: string } }): void
  sendText(text: string): void
  close(): void
  onFunctionCall?: (intent: Intent) => Promise<void>
}

class StubLiveSession implements LiveSession {
  onFunctionCall?: (intent: Intent) => Promise<void>

  sendFunctionResult(payload: { name: string; response: { text: string } }): void {
    // eslint-disable-next-line no-console
    console.log("[LiveSession] function result", payload)
  }

  sendText(text: string): void {
    // eslint-disable-next-line no-console
    console.log("[LiveSession] text", text)
  }

  close(): void {
    // eslint-disable-next-line no-console
    console.log("[LiveSession] closed")
  }
}

export async function connectGeminiLive(_token: string): Promise<LiveSession> {
  return new StubLiveSession()
}
