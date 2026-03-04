import type { ConversationContext } from "../types/context"
import { MAX_ACTIVE_TOPICS, MAX_CONTEXT_TURNS } from "./limits"

export const DEFAULT_USER_ID = "user_sungwoo"
export const DEFAULT_API_BASE_URL = "http://localhost:8080"

export const EMPTY_CONVERSATION_CONTEXT: ConversationContext = {
  turns: [],
  activeTopics: [],
  threadUrl: ""
}

export const CONTEXT_LIMITS = {
  maxTurns: MAX_CONTEXT_TURNS,
  maxActiveTopics: MAX_ACTIVE_TOPICS
}
