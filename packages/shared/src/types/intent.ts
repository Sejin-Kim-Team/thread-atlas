export type IntentType =
  | "briefing_request"
  | "contextual_query"
  | "memory_query"
  | "navigation_request"
  | "clarification_response"
  | "general"

export type IntentSource = "UserSpeech" | "UserSelection" | "PageNavigation"

export interface Intent {
  type: IntentSource
  transcript?: string
  intentType?: IntentType
}
