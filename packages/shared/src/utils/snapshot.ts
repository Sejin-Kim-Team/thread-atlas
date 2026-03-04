import type { Intent, IntentType } from "../types/intent"
import type { SensorData } from "../types/messages"
import type { StateSnapshot } from "../types/state"
import type { ArticleContext } from "../types/article"
import type { ConversationContext } from "../types/context"
import type { ThreadSemantics } from "../types/semantics"

export function cloneSnapshot(snapshot: StateSnapshot): StateSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as StateSnapshot
}

export function buildUserContext(
  intentType: IntentType,
  sensors: SensorData,
  speech: string
): StateSnapshot["user"] {
  switch (intentType) {
    case "contextual_query":
    case "memory_query":
    case "general":
      return {
        speech,
        selection: sensors.selection,
        focus: sensors.focus
      }
    default:
      return {
        speech,
        selection: null,
        focus: null
      }
  }
}

export function buildStateSnapshot(args: {
  intent: Intent
  sensors: SensorData
  viewport: string | null
  sourceArticle: ArticleContext | null
  semantics: ThreadSemantics | null
  conversationContext: ConversationContext | null
}): StateSnapshot {
  const { intent, sensors, viewport, sourceArticle, semantics, conversationContext } = args
  const intentType = intent.intentType ?? "general"
  const speech = intent.transcript ?? null

  return {
    intent,
    page: {
      url: sensors.threadDoc?.url ?? "",
      title: sensors.threadDoc?.title ?? "",
      content: {
        threadDoc: null,
        structure: sensors.structure,
        visibleComments: sensors.visibleComments
      }
    },
    user: buildUserContext(intentType, sensors, speech ?? ""),
    viewport,
    sourceArticle,
    semantics,
    conversationContext
  }
}
