import {
  hashUrl,
  type ConversationContext,
  type Intent,
  type StateSnapshot,
  type ThreadSemantics
} from "@threadatlas/shared"
import { buildStateSnapshot, type SensorData } from "@threadatlas/shared/runtime"
import { ContentGraphManager } from "./content-graph"

export async function assembleStateSnapshot(args: {
  intent: Intent
  sensors: SensorData
  contentGraph: ContentGraphManager
  cachedSemantics: ThreadSemantics | null
  conversationContext: ConversationContext | null
  viewport: string | null
}): Promise<StateSnapshot> {
  const { intent, sensors, contentGraph, cachedSemantics, conversationContext, viewport } = args

  const threadId = hashUrl(sensors.threadDoc?.url ?? "")
  const sourceArticle = contentGraph.getSourceArticle(threadId)

  return buildStateSnapshot({
    intent,
    sensors,
    viewport,
    sourceArticle,
    semantics: cachedSemantics,
    conversationContext
  })
}
