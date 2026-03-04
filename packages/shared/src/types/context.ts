export interface TurnSummary {
  intent: {
    type: string
    summary: string
  }
  action: string
  result: string
  timestamp: number
}

export interface ConversationContext {
  turns: TurnSummary[]
  activeTopics: string[]
  pendingClarification?: string
  threadUrl: string
}
