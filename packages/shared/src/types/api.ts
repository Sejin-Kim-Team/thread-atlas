import type { ConversationContext } from "./context"
import type { MemoryDelta } from "./memory"
import type { Projection } from "./projection"
import type { StateSnapshot } from "./state"
import type { ThreadDoc } from "./thread"
import type { ThreadSemantics } from "./semantics"

export interface EvaluateRequest {
  stateSnapshot: StateSnapshot
  conversationContext?: ConversationContext
}

export interface EvaluateDonePayload {
  conversationContext: ConversationContext
  memoryDelta: MemoryDelta | null
}

export type EvaluateErrorCode = "GEMINI_FAILED" | "TIMEOUT" | "INTERNAL_ERROR"

export interface EvaluateErrorPayload {
  code: EvaluateErrorCode
  message: string
}

export type EvaluateSseEvent =
  | { event: "projection"; data: Projection }
  | { event: "done"; data: EvaluateDonePayload }
  | { event: "error"; data: EvaluateErrorPayload }

export interface LegacyTokenRequest {
  userId: string
}

export interface LegacyTokenResponse {
  token: string
  expiresAt: number
}

export interface LegacyAnalyzeRequest {
  userId: string
  threadDoc: ThreadDoc
  articleUrl: string | null
}

export interface LegacyAnalyzeResponse {
  threadSemantics: ThreadSemantics
  cached: boolean
}
