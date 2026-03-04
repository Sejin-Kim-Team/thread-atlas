import { CONTEXT_LIMITS } from "../constants/defaults"
import type { ConversationContext, TurnSummary } from "../types/context"

export function trimTurns(turns: TurnSummary[]): TurnSummary[] {
  if (turns.length <= CONTEXT_LIMITS.maxTurns) {
    return turns
  }
  return turns.slice(turns.length - CONTEXT_LIMITS.maxTurns)
}

export function appendTurn(
  context: ConversationContext,
  turn: TurnSummary
): ConversationContext {
  return {
    ...context,
    turns: trimTurns([...context.turns, turn])
  }
}

export function setActiveTopics(
  context: ConversationContext,
  topics: string[]
): ConversationContext {
  return {
    ...context,
    activeTopics: topics.slice(0, CONTEXT_LIMITS.maxActiveTopics)
  }
}
