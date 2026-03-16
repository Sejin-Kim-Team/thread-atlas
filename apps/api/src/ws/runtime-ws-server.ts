import type { IncomingMessage } from "node:http"
import type { Socket } from "node:net"
import { WebSocketServer } from "ws"
import type { RawData, WebSocket } from "ws"
import type {
  RuntimeV2ClientEnvelope,
  RuntimeV2ErrorCode,
  RuntimeV2ServerEnvelope,
  RuntimeV2ToolResultPayload
} from "@threadatlas/shared/runtime"
import {
  RUNTIME_V2_INPUT_AUDIO_FORMAT,
  RUNTIME_V2_OUTPUT_AUDIO_FORMAT
} from "@threadatlas/shared/runtime"
import { createLogger } from "../runtime/logger"
import { SemanticRuntimeError, SemanticRuntimeManager } from "../session/semantic-runtime-manager"
import { TextTurnExecutor } from "../session/runtime/text-turn-executor"
import { VoiceTurnExecutor } from "../session/runtime/voice-turn-executor"
import {
  authenticateUpgradeRequest,
  type AuthenticatedUpgradeRequest,
  parseRequestUrl,
  rejectUpgrade
} from "./ws-upgrade-auth"

const logger = createLogger("ws/runtime")
const FRONTEND_TOOL_TIMEOUT_MS = 10_000

interface PendingFrontendToolRequest {
  resolve: (result: RuntimeV2ToolResultPayload | null) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

function makeTimestamp(): string {
  return new Date().toISOString()
}

function makeRequestId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(16).slice(2)
  return `${prefix}-${random}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function rawDataToText(raw: RawData): string | null {
  if (typeof raw === "string") {
    return raw
  }
  if (Buffer.isBuffer(raw)) {
    return raw.toString("utf8")
  }
  if (raw instanceof ArrayBuffer) {
    return Buffer.from(raw).toString("utf8")
  }
  if (Array.isArray(raw)) {
    return Buffer.concat(raw).toString("utf8")
  }
  return null
}

function isRuntimeV2ClientEnvelope(value: unknown): value is RuntimeV2ClientEnvelope {
  return (
    isRecord(value) &&
    typeof value.type === "string" &&
    typeof value.requestId === "string" &&
    typeof value.timestamp === "string" &&
    "payload" in value
  )
}

function getRuntimeEnvelopeType(raw: RawData): string | null {
  const text = rawDataToText(raw)
  if (!text) {
    return null
  }
  try {
    const parsed = JSON.parse(text) as unknown
    if (!isRecord(parsed) || typeof parsed.type !== "string") {
      return null
    }
    return parsed.type
  } catch {
    return null
  }
}

function toRuntimeErrorEnvelope(args: {
  code: RuntimeV2ErrorCode
  message: string
  requestId?: string
  sessionId?: string
  turnId?: string
  recoverable?: boolean
}): RuntimeV2ServerEnvelope {
  return {
    type: "turn.error",
    timestamp: makeTimestamp(),
    ...(args.requestId ? { requestId: args.requestId } : {}),
    ...(args.sessionId ? { sessionId: args.sessionId } : { sessionId: "" }),
    ...(args.turnId ? { turnId: args.turnId } : {}),
    payload: {
      code: args.code,
      message: args.message,
      recoverable: args.recoverable ?? args.code !== "UNAUTHORIZED"
    }
  }
}

async function processIncomingChunk(args: {
  ws: WebSocket
  gateway: RuntimeGateway
  chunk: RawData
}): Promise<void> {
  const text = rawDataToText(args.chunk)
  if (!text) {
    args.ws.send(
      JSON.stringify(
        toRuntimeErrorEnvelope({
          code: "INVALID_EVENT",
          message: "invalid runtime envelope"
        })
      )
    )
    return
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    args.ws.send(
      JSON.stringify(
        toRuntimeErrorEnvelope({
          code: "INVALID_EVENT",
          message: "invalid runtime envelope"
        })
      )
    )
    return
  }

  if (!isRuntimeV2ClientEnvelope(parsed)) {
    args.ws.send(
      JSON.stringify(
        toRuntimeErrorEnvelope({
          code: "INVALID_EVENT",
          message: "invalid runtime envelope"
        })
      )
    )
    return
  }

  try {
    await args.gateway.handleEnvelope(parsed)
  } catch (error) {
    const payload =
      error instanceof SemanticRuntimeError
        ? error.payload
        : {
            code: "GENERATION_FAILED" as RuntimeV2ErrorCode,
            message: error instanceof Error ? error.message : "runtime websocket handling failed",
            recoverable: true
          }
    args.ws.send(
      JSON.stringify(
        toRuntimeErrorEnvelope({
          code: payload.code,
          message: payload.message,
          ...(parsed.requestId ? { requestId: parsed.requestId } : {}),
          ...(parsed.sessionId ? { sessionId: parsed.sessionId } : {}),
          ...(parsed.turnId ? { turnId: parsed.turnId } : {}),
          ...(payload.recoverable !== undefined ? { recoverable: payload.recoverable } : {})
        })
      )
    )
  }
}

class RuntimeGateway {
  private readonly textExecutor: TextTurnExecutor
  private sessionId: string | null = null
  private clientSessionId: string | null = null
  private voiceExecutor: VoiceTurnExecutor | null = null
  private readonly pendingToolRequests = new Map<string, PendingFrontendToolRequest>()

  constructor(
    private readonly args: {
      ws: WebSocket
      semanticRuntime: SemanticRuntimeManager
      principalUserId: string
    }
  ) {
    this.textExecutor = new TextTurnExecutor(args.semanticRuntime)
  }

  async handleEnvelope(envelope: RuntimeV2ClientEnvelope): Promise<void> {
    switch (envelope.type) {
      case "session.open":
        await this.handleSessionOpen(envelope)
        return
      case "session.context.sync":
        await this.handleContextSync(envelope)
        return
      case "session.snapshot.sync":
        await this.handleSnapshotSync(envelope)
        return
      case "turn.input.text":
        await this.handleTextTurn(envelope)
        return
      case "turn.input.audio.append":
        await this.handleVoiceAudioAppend(envelope)
        return
      case "turn.input.audio.commit":
        await this.handleVoiceAudioCommit(envelope)
        return
      case "turn.interrupt":
        await this.handleInterrupt(envelope)
        return
      case "tool.result":
        this.handleToolResult(envelope.payload)
        return
      case "session.close":
        await this.handleSessionClose(envelope)
        return
    }
  }

  close(): void {
    this.voiceExecutor?.close()
    this.voiceExecutor = null
    for (const [toolRequestId, pending] of this.pendingToolRequests) {
      clearTimeout(pending.timeout)
      pending.reject(new Error(`frontend tool request ${toolRequestId} cancelled`))
    }
    this.pendingToolRequests.clear()
  }

  private async handleSessionOpen(
    envelope: Extract<RuntimeV2ClientEnvelope, { type: "session.open" }>
  ): Promise<void> {
    const openArgs: Parameters<SemanticRuntimeManager["openSession"]>[0] = {
      principalUserId: this.args.principalUserId,
      clientSessionId: envelope.payload.clientSessionId
    }
    if (envelope.payload.language) {
      openArgs.language = envelope.payload.language
    }
    const ready = await this.args.semanticRuntime.openSession(openArgs)
    this.sessionId = ready.sessionId
    this.clientSessionId = ready.clientSessionId
    this.emit({
      type: "session.ready",
      requestId: envelope.requestId,
      timestamp: makeTimestamp(),
      sessionId: ready.sessionId,
      payload: {
        ...ready,
        inputAudioFormat: RUNTIME_V2_INPUT_AUDIO_FORMAT,
        outputAudioFormat: RUNTIME_V2_OUTPUT_AUDIO_FORMAT
      }
    })
  }

  private async handleContextSync(
    envelope: Extract<RuntimeV2ClientEnvelope, { type: "session.context.sync" }>
  ): Promise<void> {
    const sessionId = this.requireSessionId(envelope)
    const syncArgs: Parameters<SemanticRuntimeManager["syncContext"]>[0] = {
      principalUserId: this.args.principalUserId,
      sessionId,
      tabId: envelope.payload.tabId
    }
    if (typeof envelope.payload.isPrimary === "boolean") {
      syncArgs.isPrimary = envelope.payload.isPrimary
    }
    await this.args.semanticRuntime.syncContext(syncArgs)
  }

  private async handleSnapshotSync(
    envelope: Extract<RuntimeV2ClientEnvelope, { type: "session.snapshot.sync" }>
  ): Promise<void> {
    const sessionId = this.requireSessionId(envelope)
    await this.args.semanticRuntime.syncSnapshot({
      principalUserId: this.args.principalUserId,
      sessionId,
      tabId: envelope.payload.tabId,
      snapshot: envelope.payload.snapshot
    })
    if (this.voiceExecutor) {
      this.voiceExecutor.close()
      this.voiceExecutor = null
    }
  }

  private async handleTextTurn(
    envelope: Extract<RuntimeV2ClientEnvelope, { type: "turn.input.text" }>
  ): Promise<void> {
    const sessionId = this.requireSessionId(envelope)
    this.voiceExecutor?.interrupt("superseded-by-text-turn")
    this.voiceExecutor = null

    const result = await this.textExecutor.run({
      principalUserId: this.args.principalUserId,
      sessionId,
      text: envelope.payload.text,
      onTurnStarted: async (turnId) => {
        this.emit({
          type: "turn.started",
          requestId: envelope.requestId,
          timestamp: makeTimestamp(),
          sessionId,
          turnId,
          payload: {
            modality: "text"
          }
        })
        this.emit({
          type: "turn.input.transcript.final",
          timestamp: makeTimestamp(),
          sessionId,
          turnId,
          payload: {
            text: envelope.payload.text
          }
        })
      },
      requestFrontendTool: (request) => this.requestFrontendTool(request)
    })

    this.emitTurnResult(sessionId, "text", result)
  }

  private async handleVoiceAudioAppend(
    envelope: Extract<RuntimeV2ClientEnvelope, { type: "turn.input.audio.append" }>
  ): Promise<void> {
    const sessionId = this.requireSessionId(envelope)
    if (!this.voiceExecutor) {
    await this.args.semanticRuntime.interruptTurn({
      principalUserId: this.args.principalUserId,
      sessionId,
      reason: "superseded-by-voice-turn"
      })
      this.voiceExecutor = new VoiceTurnExecutor({
        sessionId,
        principalUserId: this.args.principalUserId,
        runtime: this.args.semanticRuntime,
        emit: (event) => this.emit(event),
        requestFrontendTool: (request) => this.requestFrontendTool(request)
      })
    }
    await this.voiceExecutor.appendAudio(envelope.payload)
  }

  private async handleVoiceAudioCommit(
    envelope: Extract<RuntimeV2ClientEnvelope, { type: "turn.input.audio.commit" }>
  ): Promise<void> {
    this.requireSessionId(envelope)
    await this.voiceExecutor?.commitAudio()
  }

  private async handleInterrupt(
    envelope: Extract<RuntimeV2ClientEnvelope, { type: "turn.interrupt" }>
  ): Promise<void> {
    const sessionId = this.requireSessionId(envelope)
    this.voiceExecutor?.interrupt(envelope.payload.reason ?? "interrupted")
    this.voiceExecutor = null
    const interruptArgs: Parameters<SemanticRuntimeManager["interruptTurn"]>[0] = {
      principalUserId: this.args.principalUserId,
      sessionId
    }
    if (envelope.turnId) {
      interruptArgs.turnId = envelope.turnId
    }
    if (envelope.payload.reason) {
      interruptArgs.reason = envelope.payload.reason
    }
    await this.args.semanticRuntime.interruptTurn(interruptArgs)
  }

  private async handleSessionClose(
    envelope: Extract<RuntimeV2ClientEnvelope, { type: "session.close" }>
  ): Promise<void> {
    const sessionId = this.requireSessionId(envelope)
    this.voiceExecutor?.interrupt(envelope.payload.reason ?? "session-closed")
    this.voiceExecutor = null
    await this.args.semanticRuntime.interruptTurn({
      principalUserId: this.args.principalUserId,
      sessionId,
      reason: envelope.payload.reason ?? "session-closed"
    })
    this.close()
    this.args.ws.close()
  }

  private handleToolResult(payload: unknown): void {
    if (!isRecord(payload) || typeof payload.toolRequestId !== "string") {
      throw new SemanticRuntimeError({
        code: "INVALID_EVENT",
        message: "tool.result payload is invalid",
        recoverable: true
      })
    }
    const pending = this.pendingToolRequests.get(payload.toolRequestId)
    if (!pending) {
      throw new SemanticRuntimeError({
        code: "INVALID_EVENT",
        message: "tool.result does not match a pending request",
        recoverable: true
      })
    }
    clearTimeout(pending.timeout)
    this.pendingToolRequests.delete(payload.toolRequestId)
    pending.resolve(payload as unknown as RuntimeV2ToolResultPayload)
  }

  private async requestFrontendTool(request: {
    sessionId: string
    turnId: string
    kind: "context.enrich" | "focus.node" | "present.content" | "copy.text" | "navigate.url"
    waitForResult: boolean
    args: Record<string, unknown>
  }): Promise<RuntimeV2ToolResultPayload | null> {
    const toolRequestId = makeRequestId("tool")
    if (!request.waitForResult) {
      this.emit({
        type: "tool.request",
        timestamp: makeTimestamp(),
        sessionId: request.sessionId,
        turnId: request.turnId,
        payload: {
          toolRequestId,
          kind: request.kind,
          waitForResult: request.waitForResult,
          args: request.args
        }
      })
      return null
    }

    return new Promise<RuntimeV2ToolResultPayload | null>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingToolRequests.delete(toolRequestId)
        reject(
          new SemanticRuntimeError({
            code: "TOOL_RESPONSE_TIMEOUT",
            message: "frontend tool request timed out",
            recoverable: true
          })
        )
      }, FRONTEND_TOOL_TIMEOUT_MS)

      this.pendingToolRequests.set(toolRequestId, {
        resolve,
        reject,
        timeout
      })

      try {
        this.emit({
          type: "tool.request",
          timestamp: makeTimestamp(),
          sessionId: request.sessionId,
          turnId: request.turnId,
          payload: {
            toolRequestId,
            kind: request.kind,
            waitForResult: request.waitForResult,
            args: request.args
          }
        })
      } catch (error) {
        clearTimeout(timeout)
        this.pendingToolRequests.delete(toolRequestId)
        reject(error instanceof Error ? error : new Error("failed to emit frontend tool request"))
      }
    })
  }

  private emitTurnResult(
    sessionId: string,
    modality: "text" | "voice",
    result: {
      turnId: string
      answerText: string | null
      projections: unknown[]
      referencedTabIds: number[]
      usedMemoryRecordIds: string[]
      provenanceSummary: string[]
    }
  ): void {
    if (result.answerText) {
      this.emit({
        type: "turn.output.transcript.final",
        timestamp: makeTimestamp(),
        sessionId,
        turnId: result.turnId,
        payload: {
          text: result.answerText
        }
      })
    }

    for (const projection of result.projections) {
      this.emit({
        type: "turn.output.projection",
        timestamp: makeTimestamp(),
        sessionId,
        turnId: result.turnId,
        payload: {
          projection: projection as never
        }
      })
    }

    this.emit({
      type: "turn.done",
      timestamp: makeTimestamp(),
      sessionId,
      turnId: result.turnId,
      payload: {
        modality,
        referencedTabIds: result.referencedTabIds,
        usedMemoryRecordIds: result.usedMemoryRecordIds,
        provenanceSummary: result.provenanceSummary
      }
    })
  }

  private emit(event: RuntimeV2ServerEnvelope): void {
    this.args.ws.send(JSON.stringify(event))
  }

  private requireSessionId(envelope: RuntimeV2ClientEnvelope): string {
    const sessionId = envelope.sessionId ?? this.sessionId
    if (!sessionId) {
      throw new SemanticRuntimeError({
        code: "INVALID_EVENT",
        message: "session.open must complete before runtime input",
        recoverable: true
      })
    }
    return sessionId
  }
}

export function attachRuntimeWebSocketServer(
  server: import("node:http").Server,
  semanticRuntime: SemanticRuntimeManager
): void {
  const wss = new WebSocketServer({ noServer: true })

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const principalUserId = (req as AuthenticatedUpgradeRequest).authContext?.principalUserId ?? null
    if (!principalUserId) {
      ws.send(
        JSON.stringify(
          toRuntimeErrorEnvelope({
            code: "UNAUTHORIZED",
            message: "missing authenticated websocket context",
            recoverable: false
          })
        )
      )
      ws.close()
      return
    }

    logger.info("runtime-ws-connection-opened", {
      principalUserId
    })

    const gateway = new RuntimeGateway({
      ws,
      semanticRuntime,
      principalUserId
    })
    let messageQueue = Promise.resolve()

    ws.on("message", (chunk) => {
      if (getRuntimeEnvelopeType(chunk) === "tool.result") {
        void processIncomingChunk({
          ws,
          gateway,
          chunk
        }).catch((error) => {
          logger.error("runtime-ws-tool-result-processing-error", {
            principalUserId,
            error
          })
        })
        return
      }

      messageQueue = messageQueue
        .then(() =>
          processIncomingChunk({
            ws,
            gateway,
            chunk
          })
        )
        .catch((error) => {
          logger.error("runtime-ws-message-queue-error", {
            principalUserId,
            error
          })
        })
    })

    ws.on("close", () => {
      logger.info("runtime-ws-connection-closed", {
        principalUserId
      })
      gateway.close()
    })
  })

  server.on("upgrade", async (req: IncomingMessage, socket: Socket, head: Buffer) => {
    try {
      const parsedUrl = parseRequestUrl(req)
      if (!parsedUrl) {
        rejectUpgrade(socket, 400, "invalid request url")
        return
      }

      if (parsedUrl.pathname !== "/ws/runtime") {
        return
      }

      const authResult = await authenticateUpgradeRequest(req, "/ws/runtime")
      if (!authResult.ok) {
        logger.warn("runtime-ws-upgrade-rejected", {
          code: authResult.code,
          reason: authResult.reason
        })
        rejectUpgrade(socket, authResult.code, authResult.reason)
        return
      }

      const upgradedRequest = req as AuthenticatedUpgradeRequest
      upgradedRequest.authContext = authResult.context
      wss.handleUpgrade(upgradedRequest, socket, head, (ws) => {
        wss.emit("connection", ws, upgradedRequest)
      })
    } catch (error) {
      logger.error("runtime-ws-upgrade-error", {
        error
      })
      rejectUpgrade(socket, 500, "internal auth error")
    }
  })
}
