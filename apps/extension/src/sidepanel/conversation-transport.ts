import type { Intent, Projection, SemanticSnapshot } from "@threadatlas/shared"
import type {
  ContextEnrichRequestPayload,
  ContextEnrichResultPayload,
  RuntimeErrorPayload,
  ServerEnvelope
} from "@threadatlas/shared/runtime"

export type ConversationPhase =
  | "ready"
  | "opening-session"
  | "sending-intent"
  | "waiting-enrich"
  | "resuming-turn"
  | "error"

export interface ConversationIntentInput {
  intent: Intent
  activeTabId: number
  snapshot: SemanticSnapshot
}

export interface ConversationTransportHandlers {
  onPhaseChange?: (phase: ConversationPhase) => void
  onSessionReady?: (event: Extract<ServerEnvelope, { type: "session.ready" }>) => void
  onProgress?: (event: Extract<ServerEnvelope, { type: "progress" }>) => void
  onProjection?: (projection: Projection, event: Extract<ServerEnvelope, { type: "projection" }>) => void
  onTurnDone?: (event: Extract<ServerEnvelope, { type: "turn.done" }>) => void
  onError?: (error: RuntimeErrorPayload, event: Extract<ServerEnvelope, { type: "error" }>) => void
  onEnrichRequest?: (
    event: Extract<ServerEnvelope, { type: "context.enrich.request" }>
  ) => Promise<ContextEnrichResultPayload>
}

export interface ConversationTransport {
  sendIntent(input: ConversationIntentInput): Promise<void>
  interrupt(reason?: string): Promise<void>
  close(): Promise<void>
}
