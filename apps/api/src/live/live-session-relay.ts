import { randomUUID } from "node:crypto"
import type { WebSocket } from "ws"
import type {
  LiveClientEnvelope,
  LiveFrontendToolName,
  LiveOpenPayload,
  LiveRuntimeErrorPayload,
  LiveServerEnvelope,
  LiveToolResultPayload
} from "@threadatlas/shared/runtime"
import {
  LIVE_INPUT_AUDIO_FORMAT,
  LIVE_OUTPUT_AUDIO_FORMAT
} from "@threadatlas/shared/runtime"
import type { Projection, SemanticSnapshot } from "@threadatlas/shared"
import { createLogger } from "../runtime/logger"
import {
  createGeminiLiveSession,
  isLiveModelConfigError,
  type GeminiLiveSession,
  type GeminiLiveToolDeclaration
} from "../services/gemini-live"
import { decodeBase64AudioChunk, isSupportedInputAudioMimeType, isSupportedOutputAudioMimeType } from "./live-audio-codec"
import { LiveToolBridge } from "./live-tool-bridge"
import { RuntimeManager } from "../session/runtime/manager"

const FRONTEND_TOOL_TIMEOUT_MS = 10_000
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

interface PendingFrontendToolCall {
  name: LiveFrontendToolName
  resolve: (result: Record<string, unknown> | null) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

function makeTimestamp(): string {
  return new Date().toISOString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function makeLiveErrorPayload(
  code: LiveRuntimeErrorPayload["code"],
  message: string,
  recoverable = true
): LiveRuntimeErrorPayload {
  return {
    code,
    message,
    recoverable
  }
}

function makeSystemInstruction(snapshot: SemanticSnapshot): string {
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

export class LiveSessionRelay {
  private readonly logger = createLogger("live/session-relay")
  private readonly liveSessionId = `live-${randomUUID()}`
  private geminiSession: GeminiLiveSession | null = null
  private toolBridge: LiveToolBridge | null = null
  private clientSessionId: string | null = null
  private activeSnapshot: SemanticSnapshot | null = null
  private activeTabId: number | null = null
  private closed = false
  private openRequestId: string | null = null
  private readonly pendingFrontendToolCalls = new Map<string, PendingFrontendToolCall>()

  constructor(
    private readonly args: {
      ws: WebSocket
      runtime: RuntimeManager
      principalUserId: string
      onCloseSocket: () => void
    }
  ) {}

  async handleClientEnvelope(envelope: LiveClientEnvelope): Promise<void> {
    switch (envelope.type) {
      case "live.open":
        await this.handleLiveOpen(envelope.requestId, envelope.payload)
        return
      case "live.audio.append":
        this.ensureLiveSession()
        if (!isSupportedInputAudioMimeType(envelope.payload.mimeType)) {
          this.emitError(
            makeLiveErrorPayload("INVALID_EVENT", "unsupported live audio mime type")
          )
          return
        }
        try {
          decodeBase64AudioChunk(envelope.payload.chunkBase64)
        } catch (error) {
          this.emitError(
            makeLiveErrorPayload(
              "AUDIO_DECODE_FAILED",
              error instanceof Error ? error.message : "audio chunk could not be decoded"
            )
          )
          return
        }
        this.geminiSession?.sendAudioChunk(
          envelope.payload.chunkBase64,
          envelope.payload.mimeType ?? LIVE_INPUT_AUDIO_FORMAT.mimeType
        )
        return
      case "live.audio.commit":
        this.ensureLiveSession()
        this.geminiSession?.commitAudio()
        return
      case "live.interrupt":
        this.emitTurnDone({ interrupted: true, reason: envelope.payload.reason ?? "interrupted" })
        this.closeUpstream()
        return
      case "live.close":
        this.emitTurnDone({ interrupted: true, reason: envelope.payload.reason ?? "closed" })
        this.closeUpstream()
        this.args.onCloseSocket()
        return
      case "live.tool.result":
        this.handleFrontendToolResult(envelope)
        return
    }
  }

  close(): void {
    this.closed = true
    this.closeUpstream()
    for (const [toolCallId, pending] of this.pendingFrontendToolCalls) {
      clearTimeout(pending.timeout)
      pending.reject(new Error(`frontend tool call ${toolCallId} cancelled`))
    }
    this.pendingFrontendToolCalls.clear()
  }

  private async handleLiveOpen(requestId: string, payload: LiveOpenPayload): Promise<void> {
    if (this.geminiSession) {
      this.emitError(makeLiveErrorPayload("INVALID_EVENT", "live session is already open"))
      return
    }

    this.openRequestId = requestId
    this.clientSessionId = payload.clientSessionId
    this.activeSnapshot = payload.snapshot
    this.activeTabId = payload.tabId

    try {
      this.toolBridge = new LiveToolBridge({
        runtime: this.args.runtime,
        principalUserId: this.args.principalUserId,
        liveSessionId: this.liveSessionId,
        clientSessionId: payload.clientSessionId,
        tabId: payload.tabId,
        snapshot: payload.snapshot,
        frontendTools: {
          invoke: ({ name, payload: toolPayload, waitForResult }) =>
            this.invokeFrontendTool(name, toolPayload, waitForResult)
        }
      })
      await this.toolBridge.initialize()

      const liveSessionArgs: Parameters<typeof createGeminiLiveSession>[0] = {
        systemInstruction: makeSystemInstruction(payload.snapshot),
        tools: [GET_CURRENT_PAGE_ANSWER_TOOL],
        onEvent: (event) => {
          void this.handleGeminiEvent(event)
        },
        onError: (error) => {
          this.logger.error("live-upstream-error", {
            liveSessionId: this.liveSessionId,
            error
          })
          const payload = isLiveModelConfigError(error)
            ? makeLiveErrorPayload("MODEL_CONFIG_MISSING", error.message, false)
            : makeLiveErrorPayload("LIVE_CONNECT_FAILED", error.message)
          this.emitError(payload)
        },
        onClose: () => {
          if (!this.closed) {
            this.emitError(makeLiveErrorPayload("LIVE_UPSTREAM_CLOSED", "Gemini Live session closed"))
          }
        }
      }
      if (payload.language) {
        liveSessionArgs.language = payload.language
      }

      this.geminiSession = await createGeminiLiveSession(liveSessionArgs)
    } catch (error) {
      const payload = isLiveModelConfigError(error)
        ? makeLiveErrorPayload("MODEL_CONFIG_MISSING", error.message, false)
        : makeLiveErrorPayload(
            "LIVE_CONNECT_FAILED",
            error instanceof Error ? error.message : "Gemini Live session could not be opened"
          )
      this.emitError(payload)
    }
  }

  private async handleGeminiEvent(
    event: Parameters<NonNullable<Parameters<typeof createGeminiLiveSession>[0]["onEvent"]>>[0]
  ): Promise<void> {
    switch (event.type) {
      case "ready":
        {
          const readyEvent: LiveServerEnvelope = {
          type: "live.ready",
          timestamp: makeTimestamp(),
          liveSessionId: event.sessionId,
          payload: {
            liveSessionId: event.sessionId,
            clientSessionId: this.clientSessionId ?? "unknown-client-session",
            inputAudioFormat: LIVE_INPUT_AUDIO_FORMAT,
            outputAudioFormat: LIVE_OUTPUT_AUDIO_FORMAT,
            model: process.env.GOOGLE_LIVE_MODEL ?? "gemini-live-2.5-flash-native-audio"
          }
          }
          if (this.openRequestId) {
            readyEvent.requestId = this.openRequestId
          }
          this.emit(readyEvent)
        }
        return
      case "input-transcript":
        this.emit({
          type: event.final ? "live.input.transcript.final" : "live.input.transcript.partial",
          timestamp: makeTimestamp(),
          liveSessionId: this.liveSessionId,
          payload: {
            text: event.text
          }
        })
        return
      case "output-transcript":
        this.emit({
          type: event.final ? "live.output.transcript.final" : "live.output.transcript.partial",
          timestamp: makeTimestamp(),
          liveSessionId: this.liveSessionId,
          payload: {
            text: event.text
          }
        })
        return
      case "output-audio":
        if (!isSupportedOutputAudioMimeType(event.mimeType)) {
          this.emitError(
            makeLiveErrorPayload("INVALID_EVENT", `unsupported output audio mime type: ${event.mimeType}`)
          )
          return
        }
        this.emit({
          type: "live.output.audio.chunk",
          timestamp: makeTimestamp(),
          liveSessionId: this.liveSessionId,
          payload: {
            chunkBase64: event.chunkBase64,
            mimeType: LIVE_OUTPUT_AUDIO_FORMAT.mimeType
          }
        })
        return
      case "tool-call":
        await this.handleGeminiToolCalls(event.calls)
        return
      case "turn-complete":
        this.emitTurnDone(
          event.reason
            ? {
                interrupted: event.interrupted,
                reason: event.reason
              }
            : {
                interrupted: event.interrupted
              }
        )
        return
    }
  }

  private async handleGeminiToolCalls(
    calls: Array<{
      id: string
      name: string
      args: Record<string, unknown>
    }>
  ): Promise<void> {
    if (!this.toolBridge) {
      this.emitError(makeLiveErrorPayload("TOOL_CALL_FAILED", "live tool bridge is unavailable"))
      return
    }

    const responses = []
    for (const call of calls) {
      if (call.name !== "get_current_page_answer") {
        responses.push({
          id: call.id,
          name: call.name,
          response: {
            error: "unsupported tool"
          }
        })
        continue
      }

      try {
        const question = asString(call.args.question)
        if (!question) {
          responses.push({
            id: call.id,
            name: call.name,
            response: {
              error: "question is required"
            }
          })
          continue
        }

        const answer = await this.toolBridge.getCurrentPageAnswer(question)
        responses.push({
          id: call.id,
          name: call.name,
          response: {
            answerText: answer.answerText,
            provenanceSummary: answer.provenanceSummary
          }
        })
      } catch (error) {
        this.logger.error("live-tool-call-failed", {
          liveSessionId: this.liveSessionId,
          error
        })
        responses.push({
          id: call.id,
          name: call.name,
          response: {
            error: error instanceof Error ? error.message : "tool call failed"
          }
        })
      }
    }

    this.geminiSession?.sendToolResponses(responses)
  }

  private async invokeFrontendTool(
    name: LiveFrontendToolName,
    payload: Record<string, unknown>,
    waitForResult: boolean
  ): Promise<Record<string, unknown> | null> {
    const toolCallId = `tool-${randomUUID()}`

    if (!waitForResult) {
      this.emit({
        type: "live.tool.call",
        timestamp: makeTimestamp(),
        liveSessionId: this.liveSessionId,
        toolCallId,
        payload: {
          name,
          args: payload
        }
      })
      return null
    }

    return await new Promise<Record<string, unknown> | null>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingFrontendToolCalls.delete(toolCallId)
        reject(new Error("frontend tool call timed out"))
      }, FRONTEND_TOOL_TIMEOUT_MS)

      this.pendingFrontendToolCalls.set(toolCallId, {
        name,
        resolve,
        reject,
        timeout
      })

      this.emit({
        type: "live.tool.call",
        timestamp: makeTimestamp(),
        liveSessionId: this.liveSessionId,
        toolCallId,
        payload: {
          name,
          args: payload
        }
      })
    })
  }

  private handleFrontendToolResult(envelope: Extract<LiveClientEnvelope, { type: "live.tool.result" }>): void {
    const toolCallId = envelope.toolCallId
    if (!toolCallId) {
      this.emitError(makeLiveErrorPayload("INVALID_EVENT", "toolCallId is required for live.tool.result"))
      return
    }

    const pending = this.pendingFrontendToolCalls.get(toolCallId)
    if (!pending) {
      this.emitError(makeLiveErrorPayload("INVALID_EVENT", "unknown frontend tool call"))
      return
    }

    clearTimeout(pending.timeout)
    this.pendingFrontendToolCalls.delete(toolCallId)

    if (!envelope.payload.ok) {
      pending.reject(new Error(envelope.payload.error ?? `${pending.name} failed on the frontend`))
    } else {
      pending.resolve(isRecord(envelope.payload.result) ? envelope.payload.result : null)
    }

    this.emit({
      type: "live.tool.result.ack",
      timestamp: makeTimestamp(),
      liveSessionId: this.liveSessionId,
      toolCallId,
      payload: {
        ok: envelope.payload.ok
      }
    })
  }

  private emitTurnDone(payload: { interrupted?: boolean; reason?: string }): void {
    this.emit({
      type: "live.turn.done",
      timestamp: makeTimestamp(),
      liveSessionId: this.liveSessionId,
      payload
    })
  }

  private emitError(payload: LiveRuntimeErrorPayload): void {
    const errorEvent: LiveServerEnvelope = {
      type: "live.error",
      timestamp: makeTimestamp(),
      payload
    }
    if (this.clientSessionId) {
      errorEvent.liveSessionId = this.liveSessionId
    }
    this.emit(errorEvent)
  }

  private emit(envelope: LiveServerEnvelope): void {
    if (this.closed || this.args.ws.readyState !== this.args.ws.OPEN) {
      return
    }
    this.args.ws.send(JSON.stringify(envelope))
  }

  private ensureLiveSession(): void {
    if (!this.geminiSession) {
      throw new Error("live session has not been opened")
    }
  }

  private closeUpstream(): void {
    this.geminiSession?.close()
    this.geminiSession = null
  }
}

export function isLiveClientEnvelope(value: unknown): value is LiveClientEnvelope {
  return (
    isRecord(value) &&
    typeof value.type === "string" &&
    typeof value.requestId === "string" &&
    typeof value.timestamp === "string" &&
    "payload" in value
  )
}

export function normalizeLiveToolResultPayload(value: unknown): LiveToolResultPayload | null {
  if (!isRecord(value)) {
    return null
  }

  const name = asString(value.name)
  const ok = typeof value.ok === "boolean" ? value.ok : null
  if (!name || ok === null) {
    return null
  }

  return {
    name: name as LiveFrontendToolName,
    ok,
    ...(isRecord(value.result) ? { result: value.result } : {}),
    ...(typeof value.error === "string" ? { error: value.error } : {})
  }
}
