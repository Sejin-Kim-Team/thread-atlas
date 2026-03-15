import { randomUUID } from "node:crypto"
import type {
  RuntimeV2AudioAppendPayload,
  RuntimeV2ErrorCode,
  RuntimeV2ServerEnvelope,
  RuntimeV2ToolResultPayload
} from "@threadatlas/shared/runtime"
import {
  RUNTIME_V2_INPUT_AUDIO_FORMAT,
  RUNTIME_V2_OUTPUT_AUDIO_FORMAT
} from "@threadatlas/shared/runtime"
import { createLogger } from "../../runtime/logger"
import {
  createGeminiLiveSession,
  isLiveModelConfigError,
  type GeminiLiveSession,
  type GeminiLiveToolDeclaration
} from "../../services/gemini-live"
import { decodeBase64AudioChunk, isSupportedInputAudioMimeType } from "../../live/live-audio-codec"
import type { FrontendToolRequest } from "../semantic-runtime-manager"
import { SemanticRuntimeError, SemanticRuntimeManager } from "../semantic-runtime-manager"

const GET_CURRENT_PAGE_ANSWER_TOOL: GeminiLiveToolDeclaration = {
  name: "get_current_page_answer",
  description:
    "Fetch a grounded answer about the current browser page using the latest semantic snapshot and FE enrich loop.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "The user's current spoken question about the active page."
      }
    },
    required: ["question"]
  }
}

function makeTimestamp(): string {
  return new Date().toISOString()
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function makeErrorPayload(
  code: RuntimeV2ErrorCode,
  message: string,
  recoverable = true
): RuntimeV2ServerEnvelope {
  return {
    type: "turn.error",
    timestamp: makeTimestamp(),
    sessionId: "",
    payload: {
      code,
      message,
      recoverable
    }
  }
}

function withSessionErrorContext(
  base: RuntimeV2ServerEnvelope,
  sessionId: string,
  turnId?: string | null
): RuntimeV2ServerEnvelope {
  return {
    ...base,
    sessionId,
    ...(turnId ? { turnId } : {})
  }
}

function buildSystemInstruction(snapshot: ReturnType<SemanticRuntimeManager["getSessionSnapshot"]>): string {
  if (!snapshot) {
    return "You are ThreadAtlas Live."
  }

  const title = snapshot.page.title?.trim() || "(untitled)"
  const url = snapshot.page.url
  const focusText =
    snapshot.focus.node.kind === "interactive"
      ? snapshot.focus.node.label ?? snapshot.focus.node.valuePreview ?? ""
      : snapshot.focus.node.text

  return [
    "You are ThreadAtlas Live, a voice assistant grounded in the current browser page.",
    "For questions about the current page, always call get_current_page_answer before answering.",
    "Do not invent page details. Treat the tool result as the source of truth.",
    "Keep spoken answers concise and useful.",
    `Current page title: ${title}`,
    `Current page URL: ${url}`,
    `Current page kind: ${snapshot.page.kind}`,
    `Current focus text: ${focusText || "(empty)"}`
  ].join("\n")
}

export class VoiceTurnExecutor {
  private readonly logger = createLogger("runtime/voice-turn")
  private geminiSession: GeminiLiveSession | null = null
  private openPromise: Promise<void> | null = null
  private currentTurnId: string | null = null
  private interrupted = false
  private closed = false
  private lastProvenanceSummary: string[] = []
  private setupError: SemanticRuntimeError["payload"] | null = null
  private toolRoundTripInProgress = false
  private awaitingAssistantAfterTool = false
  private sawAssistantOutputAfterTool = false
  private pendingTurnCompletion: { interrupted: boolean; reason?: string } | null = null
  private eventQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly args: {
      sessionId: string
      principalUserId: string
      runtime: SemanticRuntimeManager
      emit: (event: RuntimeV2ServerEnvelope) => void
      requestFrontendTool: (
        request: FrontendToolRequest
      ) => Promise<RuntimeV2ToolResultPayload | null>
    }
  ) {}

  async appendAudio(payload: RuntimeV2AudioAppendPayload): Promise<void> {
    await this.ensureTurn()
    if (!this.geminiSession || !this.currentTurnId) {
      throw new SemanticRuntimeError(
        this.setupError ?? {
          code: "LIVE_CONNECT_FAILED",
          message: "voice turn is not ready",
          recoverable: true
        }
      )
    }

    const mimeType = payload.mimeType ?? RUNTIME_V2_INPUT_AUDIO_FORMAT.mimeType
    if (!isSupportedInputAudioMimeType(mimeType)) {
      this.failTurn("INVALID_EVENT", "unsupported live audio mime type")
      return
    }

    const decoded = decodeBase64AudioChunk(payload.chunkBase64)
    if (!decoded.ok) {
      this.failTurn("AUDIO_DECODE_FAILED", decoded.message)
      return
    }

    this.geminiSession.sendAudioChunk(payload.chunkBase64, mimeType)
  }

  async commitAudio(): Promise<void> {
    await this.ensureTurn()
    this.geminiSession?.commitAudio()
  }

  interrupt(reason = "interrupted"): void {
    if (this.currentTurnId) {
      this.args.emit({
        type: "turn.done",
        timestamp: makeTimestamp(),
        sessionId: this.args.sessionId,
        turnId: this.currentTurnId,
        payload: {
          modality: "voice",
          interrupted: true,
          reason
        }
      })
    }
    this.interrupted = true
    this.close()
  }

  close(): void {
    this.closed = true
    this.setupError = null
    this.resetActiveTurnState()
  }

  private async ensureTurn(): Promise<void> {
    if (this.setupError) {
      throw new SemanticRuntimeError(this.setupError)
    }

    if (this.currentTurnId && this.geminiSession) {
      return
    }

    if (this.openPromise) {
      await this.openPromise
      return
    }

    const snapshot = this.args.runtime.getSessionSnapshot(this.args.sessionId)
    if (!snapshot) {
      throw new SemanticRuntimeError({
        code: "INVALID_SNAPSHOT",
        message: "Capture and sync a semantic snapshot before starting a voice turn.",
        recoverable: true
      })
    }

    this.closed = false
    this.setupError = null
    this.toolRoundTripInProgress = false
    this.awaitingAssistantAfterTool = false
    this.sawAssistantOutputAfterTool = false
    this.pendingTurnCompletion = null
    this.currentTurnId = `voice-turn-${randomUUID()}`
    this.interrupted = false
    this.args.emit({
      type: "turn.started",
      timestamp: makeTimestamp(),
      sessionId: this.args.sessionId,
      turnId: this.currentTurnId,
      payload: {
        modality: "voice"
      }
    })

    this.openPromise = this.openGeminiSession(snapshot).finally(() => {
      this.openPromise = null
    })
    await this.openPromise
  }

  private async openGeminiSession(
    snapshot: NonNullable<ReturnType<SemanticRuntimeManager["getSessionSnapshot"]>>
  ): Promise<void> {
    try {
      const language = this.args.runtime.getSessionLanguage(this.args.sessionId)
      const liveArgs: Parameters<typeof createGeminiLiveSession>[0] = {
        systemInstruction: buildSystemInstruction(snapshot),
        tools: [GET_CURRENT_PAGE_ANSWER_TOOL],
        onEvent: (event) => {
          this.eventQueue = this.eventQueue
            .then(async () => {
              await this.handleGeminiEvent(event)
            })
            .catch((error) => {
              this.logger.error("voice-turn-event-handler-failed", {
                sessionId: this.args.sessionId,
                turnId: this.currentTurnId,
                error
              })
              const message =
                error instanceof Error ? error.message : "voice turn event handling failed"
              this.failTurn("LIVE_CONNECT_FAILED", message)
            })
        },
        onError: (error) => {
          this.logger.error("voice-turn-upstream-error", {
            sessionId: this.args.sessionId,
            turnId: this.currentTurnId,
            error
          })
          if (isLiveModelConfigError(error)) {
            this.failTurn("MODEL_CONFIG_MISSING", error.message, false)
            return
          }
          this.failTurn("LIVE_CONNECT_FAILED", error.message)
        },
        onClose: () => {
          if (!this.closed && !this.interrupted && this.currentTurnId) {
            this.failTurn("LIVE_UPSTREAM_CLOSED", "Gemini Live session closed unexpectedly")
          }
        }
      }
      if (language) {
        liveArgs.language = language
      }
      this.geminiSession = await createGeminiLiveSession(liveArgs)
    } catch (error) {
      if (isLiveModelConfigError(error)) {
        this.failTurn("MODEL_CONFIG_MISSING", error.message, false)
        return
      }
      throw error
    }
  }

  private async handleGeminiEvent(
    event: Parameters<NonNullable<Parameters<typeof createGeminiLiveSession>[0]["onEvent"]>>[0]
  ): Promise<void> {
    if (!this.currentTurnId) {
      return
    }

    switch (event.type) {
      case "ready":
        return
      case "input-transcript":
        this.args.emit({
          type: event.final ? "turn.input.transcript.final" : "turn.input.transcript.partial",
          timestamp: makeTimestamp(),
          sessionId: this.args.sessionId,
          turnId: this.currentTurnId,
          payload: {
            text: event.text
          }
        })
        return
      case "output-transcript":
        if (this.awaitingAssistantAfterTool) {
          this.sawAssistantOutputAfterTool = true
        }
        this.args.emit({
          type: event.final ? "turn.output.transcript.final" : "turn.output.transcript.partial",
          timestamp: makeTimestamp(),
          sessionId: this.args.sessionId,
          turnId: this.currentTurnId,
          payload: {
            text: event.text
          }
        })
        return
      case "output-audio":
        if (this.awaitingAssistantAfterTool) {
          this.sawAssistantOutputAfterTool = true
        }
        this.args.emit({
          type: "turn.output.audio.chunk",
          timestamp: makeTimestamp(),
          sessionId: this.args.sessionId,
          turnId: this.currentTurnId,
          payload: {
            chunkBase64: event.chunkBase64,
            mimeType: RUNTIME_V2_OUTPUT_AUDIO_FORMAT.mimeType
          }
        })
        return
      case "tool-call":
        this.toolRoundTripInProgress = true
        this.awaitingAssistantAfterTool = false
        this.sawAssistantOutputAfterTool = false
        try {
          for (const call of event.calls) {
            if (call.name !== "get_current_page_answer") {
              continue
            }
            const question = asString(call.args.question) ?? "What matters here?"
            try {
              const result = await this.args.runtime.answerCurrentPage({
                principalUserId: this.args.principalUserId,
                sessionId: this.args.sessionId,
                question,
                onTurnStarted: undefined,
                requestFrontendTool: this.args.requestFrontendTool
              })
              this.lastProvenanceSummary = result.provenanceSummary
              for (const projection of result.projections) {
                this.args.emit({
                  type: "turn.output.projection",
                  timestamp: makeTimestamp(),
                  sessionId: this.args.sessionId,
                  turnId: this.currentTurnId,
                  payload: {
                    projection
                  }
                })
              }
              this.geminiSession?.sendToolResponses([
                {
                  id: call.id,
                  name: call.name,
                  response: {
                    answerText: result.answerText ?? "",
                    provenanceSummary: result.provenanceSummary
                  }
                }
              ])
            } catch (error) {
              const runtimeError =
                error instanceof SemanticRuntimeError
                  ? error.payload
                  : {
                      code: "TOOL_CALL_FAILED" as RuntimeV2ErrorCode,
                      message:
                        error instanceof Error ? error.message : "current-page answer tool failed",
                      recoverable: true
                    }
              this.geminiSession?.sendToolResponses([
                {
                  id: call.id,
                  name: call.name,
                  response: {
                    answerText: "",
                    error: runtimeError.message
                  }
                }
              ])
              this.emitTurnError(
                runtimeError.code,
                runtimeError.message,
                runtimeError.recoverable
              )
            }
          }
        } finally {
          this.toolRoundTripInProgress = false
          this.awaitingAssistantAfterTool = true
          if (this.pendingTurnCompletion && this.sawAssistantOutputAfterTool) {
            const completion = this.pendingTurnCompletion
            this.pendingTurnCompletion = null
            this.finalizeTurn(completion)
          }
        }
        return
      case "turn-complete":
        if (this.toolRoundTripInProgress) {
          this.pendingTurnCompletion = {
            interrupted: event.interrupted,
            ...(event.reason ? { reason: event.reason } : {})
          }
          return
        }
        if (this.awaitingAssistantAfterTool && !this.sawAssistantOutputAfterTool) {
          this.pendingTurnCompletion = {
            interrupted: event.interrupted,
            ...(event.reason ? { reason: event.reason } : {})
          }
          return
        }
        this.pendingTurnCompletion = null
        this.finalizeTurn({
          interrupted: event.interrupted,
          ...(event.reason ? { reason: event.reason } : {})
        })
        return
    }
  }

  private failTurn(
    code: RuntimeV2ErrorCode,
    message: string,
    recoverable = true
  ): void {
    this.setupError = {
      code,
      message,
      recoverable
    }
    this.args.emit(
      withSessionErrorContext(
        makeErrorPayload(code, message, recoverable),
        this.args.sessionId,
        this.currentTurnId
      )
    )
    this.resetActiveTurnState()
  }

  private emitTurnError(
    code: RuntimeV2ErrorCode,
    message: string,
    recoverable = true
  ): void {
    this.args.emit(
      withSessionErrorContext(
        makeErrorPayload(code, message, recoverable),
        this.args.sessionId,
        this.currentTurnId
      )
    )
  }

  private resetActiveTurnState(): void {
    const session = this.geminiSession
    this.geminiSession = null
    this.openPromise = null
    this.currentTurnId = null
    this.lastProvenanceSummary = []
    this.toolRoundTripInProgress = false
    this.awaitingAssistantAfterTool = false
    this.sawAssistantOutputAfterTool = false
    this.pendingTurnCompletion = null
    this.interrupted = false
    session?.close()
  }

  private finalizeTurn(payload: { interrupted: boolean; reason?: string }): void {
    if (!this.currentTurnId) {
      return
    }
    this.awaitingAssistantAfterTool = false
    this.sawAssistantOutputAfterTool = false
    this.args.emit({
      type: "turn.done",
      timestamp: makeTimestamp(),
      sessionId: this.args.sessionId,
      turnId: this.currentTurnId,
      payload: {
        modality: "voice",
        interrupted: payload.interrupted,
        ...(payload.reason ? { reason: payload.reason } : {}),
        ...(this.lastProvenanceSummary.length > 0
          ? { provenanceSummary: this.lastProvenanceSummary }
          : {})
      }
    })
    this.close()
  }
}
