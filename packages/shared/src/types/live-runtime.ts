import type { SemanticSnapshot } from "./semantic-snapshot"

export interface LiveAudioFormat {
  encoding: "pcm_s16le"
  sampleRateHz: 16000 | 24000
  channels: 1
  mimeType: "audio/pcm;rate=16000" | "audio/pcm;rate=24000"
}

export const LIVE_INPUT_AUDIO_FORMAT: LiveAudioFormat = {
  encoding: "pcm_s16le",
  sampleRateHz: 16000,
  channels: 1,
  mimeType: "audio/pcm;rate=16000"
}

export const LIVE_OUTPUT_AUDIO_FORMAT: LiveAudioFormat = {
  encoding: "pcm_s16le",
  sampleRateHz: 24000,
  channels: 1,
  mimeType: "audio/pcm;rate=24000"
}

export type LiveFrontendToolName = "request_context_enrich" | "focus_node" | "present_content"

export type LiveErrorCode =
  | "INVALID_EVENT"
  | "UNAUTHORIZED"
  | "MODEL_CONFIG_MISSING"
  | "LIVE_CONNECT_FAILED"
  | "LIVE_UPSTREAM_CLOSED"
  | "AUDIO_DECODE_FAILED"
  | "TOOL_CALL_FAILED"
  | "TOOL_RESPONSE_TIMEOUT"

export interface LiveRuntimeErrorPayload {
  code: LiveErrorCode
  message: string
  recoverable?: boolean
}

export interface LiveEnvelopeBase {
  type: string
  timestamp: string
  requestId: string
  liveSessionId?: string
  toolCallId?: string
  payload: unknown
}

export interface LiveOpenPayload {
  clientSessionId: string
  tabId: number
  snapshot: SemanticSnapshot
  language?: string
}

export interface LiveAudioAppendPayload {
  chunkBase64: string
  mimeType?: LiveAudioFormat["mimeType"]
}

export interface LiveAudioCommitPayload {
  endOfTurn?: boolean
}

export interface LiveInterruptPayload {
  reason?: string
}

export interface LiveClosePayload {
  reason?: string
}

export interface LiveToolCallPayload {
  name: LiveFrontendToolName
  args: Record<string, unknown>
}

export interface LiveToolResultPayload {
  name: LiveFrontendToolName
  ok: boolean
  result?: Record<string, unknown>
  error?: string
}

export interface LiveReadyPayload {
  liveSessionId: string
  clientSessionId: string
  inputAudioFormat: LiveAudioFormat
  outputAudioFormat: LiveAudioFormat
  model: string
}

export interface LiveTranscriptPayload {
  text: string
}

export interface LiveAudioChunkPayload {
  chunkBase64: string
  mimeType: LiveAudioFormat["mimeType"]
}

export interface LiveToolResultAckPayload {
  ok: boolean
}

export interface LiveTurnDonePayload {
  interrupted?: boolean
  reason?: string
}

export type LiveClientEnvelope =
  | (LiveEnvelopeBase & {
      type: "live.open"
      payload: LiveOpenPayload
    })
  | (LiveEnvelopeBase & {
      type: "live.audio.append"
      payload: LiveAudioAppendPayload
    })
  | (LiveEnvelopeBase & {
      type: "live.audio.commit"
      payload: LiveAudioCommitPayload
    })
  | (LiveEnvelopeBase & {
      type: "live.interrupt"
      payload: LiveInterruptPayload
    })
  | (LiveEnvelopeBase & {
      type: "live.close"
      payload: LiveClosePayload
    })
  | (LiveEnvelopeBase & {
      type: "live.tool.result"
      payload: LiveToolResultPayload
    })

export type LiveServerEnvelope =
  | {
      type: "live.ready"
      timestamp: string
      requestId?: string
      liveSessionId: string
      payload: LiveReadyPayload
    }
  | {
      type: "live.input.transcript.partial"
      timestamp: string
      requestId?: string
      liveSessionId: string
      payload: LiveTranscriptPayload
    }
  | {
      type: "live.input.transcript.final"
      timestamp: string
      requestId?: string
      liveSessionId: string
      payload: LiveTranscriptPayload
    }
  | {
      type: "live.output.audio.chunk"
      timestamp: string
      requestId?: string
      liveSessionId: string
      payload: LiveAudioChunkPayload
    }
  | {
      type: "live.output.transcript.partial"
      timestamp: string
      requestId?: string
      liveSessionId: string
      payload: LiveTranscriptPayload
    }
  | {
      type: "live.output.transcript.final"
      timestamp: string
      requestId?: string
      liveSessionId: string
      payload: LiveTranscriptPayload
    }
  | {
      type: "live.tool.call"
      timestamp: string
      requestId?: string
      liveSessionId: string
      toolCallId: string
      payload: LiveToolCallPayload
    }
  | {
      type: "live.tool.result.ack"
      timestamp: string
      requestId?: string
      liveSessionId: string
      toolCallId: string
      payload: LiveToolResultAckPayload
    }
  | {
      type: "live.error"
      timestamp: string
      requestId?: string
      liveSessionId?: string
      toolCallId?: string
      payload: LiveRuntimeErrorPayload
    }
  | {
      type: "live.turn.done"
      timestamp: string
      requestId?: string
      liveSessionId: string
      payload: LiveTurnDonePayload
    }
