import type { Projection } from "./projection"
import type { SemanticSnapshot } from "./semantic-snapshot"
import {
  LIVE_INPUT_AUDIO_FORMAT,
  LIVE_OUTPUT_AUDIO_FORMAT,
  type LiveAudioFormat
} from "./live-runtime"

export type RuntimeV2Modality = "text" | "voice"

export type RuntimeV2ToolKind =
  | "context.enrich"
  | "focus.node"
  | "present.content"
  | "copy.text"
  | "navigate.url"

export type RuntimeV2ErrorCode =
  | "INVALID_EVENT"
  | "INVALID_SNAPSHOT"
  | "UNAUTHORIZED"
  | "MODEL_CONFIG_MISSING"
  | "GENERATION_FAILED"
  | "LIVE_CONNECT_FAILED"
  | "LIVE_UPSTREAM_CLOSED"
  | "AUDIO_DECODE_FAILED"
  | "TOOL_CALL_FAILED"
  | "TOOL_RESPONSE_TIMEOUT"

export interface RuntimeV2EnvelopeBase {
  type: string
  requestId: string
  timestamp: string
  sessionId?: string
  turnId?: string
  payload: unknown
}

export interface RuntimeV2SessionOpenPayload {
  clientSessionId: string
  language?: string
}

export interface RuntimeV2SessionContextSyncPayload {
  tabId: number
  isPrimary?: boolean
}

export interface RuntimeV2SessionSnapshotSyncPayload {
  tabId: number
  snapshot: SemanticSnapshot
}

export interface RuntimeV2TextInputPayload {
  text: string
}

export interface RuntimeV2AudioAppendPayload {
  chunkBase64: string
  mimeType?: LiveAudioFormat["mimeType"]
}

export interface RuntimeV2AudioCommitPayload {
  endOfTurn?: boolean
}

export interface RuntimeV2InterruptPayload {
  reason?: string
}

export interface RuntimeV2SessionClosePayload {
  reason?: string
}

export interface RuntimeV2ToolRequestPayload {
  toolRequestId: string
  kind: RuntimeV2ToolKind
  waitForResult: boolean
  args: Record<string, unknown>
}

export interface RuntimeV2ToolResultPayload {
  toolRequestId: string
  kind: RuntimeV2ToolKind
  ok: boolean
  result?: Record<string, unknown>
  error?: string
}

export interface RuntimeV2SessionReadyPayload {
  sessionId: string
  clientSessionId: string
  reused: boolean
  inputAudioFormat: LiveAudioFormat
  outputAudioFormat: LiveAudioFormat
}

export interface RuntimeV2TurnStartedPayload {
  modality: RuntimeV2Modality
}

export interface RuntimeV2TranscriptPayload {
  text: string
}

export interface RuntimeV2AudioChunkPayload {
  chunkBase64: string
  mimeType: LiveAudioFormat["mimeType"]
}

export interface RuntimeV2ProjectionPayload {
  projection: Projection
}

export interface RuntimeV2ErrorPayload {
  code: RuntimeV2ErrorCode
  message: string
  recoverable?: boolean
}

export interface RuntimeV2TurnDonePayload {
  modality: RuntimeV2Modality
  interrupted?: boolean
  reason?: string
  referencedTabIds?: number[]
  usedMemoryRecordIds?: string[]
  provenanceSummary?: string[]
}

export type RuntimeV2ClientEnvelope =
  | (RuntimeV2EnvelopeBase & {
      type: "session.open"
      payload: RuntimeV2SessionOpenPayload
    })
  | (RuntimeV2EnvelopeBase & {
      type: "session.context.sync"
      payload: RuntimeV2SessionContextSyncPayload
    })
  | (RuntimeV2EnvelopeBase & {
      type: "session.snapshot.sync"
      payload: RuntimeV2SessionSnapshotSyncPayload
    })
  | (RuntimeV2EnvelopeBase & {
      type: "turn.input.text"
      payload: RuntimeV2TextInputPayload
    })
  | (RuntimeV2EnvelopeBase & {
      type: "turn.input.audio.append"
      payload: RuntimeV2AudioAppendPayload
    })
  | (RuntimeV2EnvelopeBase & {
      type: "turn.input.audio.commit"
      payload: RuntimeV2AudioCommitPayload
    })
  | (RuntimeV2EnvelopeBase & {
      type: "turn.interrupt"
      payload: RuntimeV2InterruptPayload
    })
  | (RuntimeV2EnvelopeBase & {
      type: "tool.result"
      payload: RuntimeV2ToolResultPayload
    })
  | (RuntimeV2EnvelopeBase & {
      type: "session.close"
      payload: RuntimeV2SessionClosePayload
    })

export type RuntimeV2ServerEnvelope =
  | {
      type: "session.ready"
      requestId?: string
      timestamp: string
      sessionId: string
      payload: RuntimeV2SessionReadyPayload
    }
  | {
      type: "turn.started"
      requestId?: string
      timestamp: string
      sessionId: string
      turnId: string
      payload: RuntimeV2TurnStartedPayload
    }
  | {
      type: "turn.input.transcript.partial"
      requestId?: string
      timestamp: string
      sessionId: string
      turnId: string
      payload: RuntimeV2TranscriptPayload
    }
  | {
      type: "turn.input.transcript.final"
      requestId?: string
      timestamp: string
      sessionId: string
      turnId: string
      payload: RuntimeV2TranscriptPayload
    }
  | {
      type: "turn.output.transcript.partial"
      requestId?: string
      timestamp: string
      sessionId: string
      turnId: string
      payload: RuntimeV2TranscriptPayload
    }
  | {
      type: "turn.output.transcript.final"
      requestId?: string
      timestamp: string
      sessionId: string
      turnId: string
      payload: RuntimeV2TranscriptPayload
    }
  | {
      type: "turn.output.audio.chunk"
      requestId?: string
      timestamp: string
      sessionId: string
      turnId: string
      payload: RuntimeV2AudioChunkPayload
    }
  | {
      type: "turn.output.projection"
      requestId?: string
      timestamp: string
      sessionId: string
      turnId: string
      payload: RuntimeV2ProjectionPayload
    }
  | {
      type: "tool.request"
      requestId?: string
      timestamp: string
      sessionId: string
      turnId: string
      payload: RuntimeV2ToolRequestPayload
    }
  | {
      type: "turn.error"
      requestId?: string
      timestamp: string
      sessionId: string
      turnId?: string
      payload: RuntimeV2ErrorPayload
    }
  | {
      type: "turn.done"
      requestId?: string
      timestamp: string
      sessionId: string
      turnId: string
      payload: RuntimeV2TurnDonePayload
    }

export const RUNTIME_V2_INPUT_AUDIO_FORMAT = LIVE_INPUT_AUDIO_FORMAT
export const RUNTIME_V2_OUTPUT_AUDIO_FORMAT = LIVE_OUTPUT_AUDIO_FORMAT
