import {
  appendTurn,
  setActiveTopics,
  type ConversationContext,
  type EvaluateDonePayload,
  type StateSnapshot
} from "@threadatlas/shared"
import { createStubResponseProjection } from "./projection"
import type { SseWriter } from "../lib/sse"

function summarizeIntent(snapshot: StateSnapshot): string {
  return snapshot.intent.transcript?.slice(0, 80) ?? snapshot.intent.intentType ?? "no transcript"
}

function buildNextContext(
  snapshot: StateSnapshot,
  incomingContext?: ConversationContext
): ConversationContext {
  const threadUrl = incomingContext?.threadUrl || snapshot.page.url
  const base: ConversationContext = incomingContext ?? {
    turns: [],
    activeTopics: [],
    threadUrl
  }

  const next = appendTurn(base, {
    intent: {
      type: snapshot.intent.type,
      summary: summarizeIntent(snapshot)
    },
    action: "respond",
    result: "stub response delivered",
    timestamp: Date.now()
  })

  if (!snapshot.semantics?.topic) {
    return next
  }

  return setActiveTopics(next, [...next.activeTopics, snapshot.semantics.topic])
}

export async function runAgentLoop(args: {
  stateSnapshot: StateSnapshot
  conversationContext?: ConversationContext
  sseWriter: SseWriter
}): Promise<EvaluateDonePayload> {
  // 이 루프는 `/api/evaluate` legacy SSE 호환을 위한 스텁 경로다.
  // current-page answer generation, recall, enrich 같은 canonical 기능은 `/ws/session` 런타임에서만 확장한다.
  const { stateSnapshot, conversationContext, sseWriter } = args

  const firstResponse = createStubResponseProjection(
    "ThreadAtlas 스텁 응답입니다. 현재 에이전틱 루프는 스캐폴딩 상태입니다."
  )
  sseWriter.projection(firstResponse)

  const donePayload: EvaluateDonePayload = {
    conversationContext: buildNextContext(stateSnapshot, conversationContext),
    memoryDelta: null
  }

  sseWriter.done(donePayload)
  return donePayload
}
