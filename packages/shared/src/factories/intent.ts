import type { Intent, IntentType } from "../types/intent"

export function createUserSpeechIntent(
  transcript: string,
  intentType: IntentType = "general"
): Intent {
  return {
    type: "UserSpeech",
    transcript,
    intentType
  }
}

export function createUserSelectionIntent(transcript: string): Intent {
  return {
    type: "UserSelection",
    transcript,
    intentType: "memory_query"
  }
}

export function createPageNavigationIntent(transcript: string): Intent {
  return {
    type: "PageNavigation",
    transcript,
    intentType: "navigation_request"
  }
}
