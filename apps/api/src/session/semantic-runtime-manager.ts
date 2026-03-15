import type {
  ContextEnrichRequestPayload,
  ContextEnrichResultPayload,
  RuntimeErrorPayload,
  ServerEnvelope
} from "@threadatlas/shared/runtime"
import type {
  RuntimeV2ErrorCode,
  RuntimeV2ToolKind,
  RuntimeV2ToolResultPayload
} from "@threadatlas/shared/runtime"
import type { Projection, SemanticSnapshot } from "@threadatlas/shared"
import { createLogger } from "../runtime/logger"
import { RuntimeManager } from "./runtime/manager"

interface RuntimeBatchBody {
  type: "event.batch"
  requestId?: string
  sessionId: string
  turnId: string
  timestamp: string
  events: unknown[]
}

interface SemanticSessionRecord {
  sessionId: string
  principalUserId: string
  clientSessionId: string
  language?: string
  primaryTabId: number | null
  snapshot: SemanticSnapshot | null
}

export interface FrontendToolRequest {
  sessionId: string
  turnId: string
  kind: RuntimeV2ToolKind
  waitForResult: boolean
  args: Record<string, unknown>
}

export interface SemanticTurnExecutionResult {
  turnId: string
  answerText: string | null
  projections: Projection[]
  referencedTabIds: number[]
  usedMemoryRecordIds: string[]
  provenanceSummary: string[]
}

export class SemanticRuntimeError extends Error {
  constructor(
    readonly payload: {
      code: RuntimeV2ErrorCode
      message: string
      recoverable?: boolean
    }
  ) {
    super(payload.message)
    this.name = "SemanticRuntimeError"
  }
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

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function isRuntimeBatchBody(value: unknown): value is RuntimeBatchBody {
  return (
    isRecord(value) &&
    value.type === "event.batch" &&
    typeof value.sessionId === "string" &&
    typeof value.turnId === "string" &&
    Array.isArray(value.events)
  )
}

function toRuntimeV2Error(payload: RuntimeErrorPayload): SemanticRuntimeError["payload"] {
  return {
    code: payload.code as RuntimeV2ErrorCode,
    message: payload.message,
    recoverable: payload.code !== "UNAUTHORIZED" && payload.code !== "MODEL_CONFIG_MISSING"
  }
}

function toSemanticRuntimeError(error: unknown, fallbackCode: RuntimeV2ErrorCode): SemanticRuntimeError {
  if (error instanceof SemanticRuntimeError) {
    return error
  }
  if (isRecord(error) && typeof error.code === "string" && typeof error.message === "string") {
    return new SemanticRuntimeError({
      code: error.code as RuntimeV2ErrorCode,
      message: error.message,
      recoverable: true
    })
  }
  return new SemanticRuntimeError({
    code: fallbackCode,
    message: error instanceof Error ? error.message : "semantic runtime failed",
    recoverable: true
  })
}

function normalizeRuntimeEvents(
  result: Awaited<ReturnType<RuntimeManager["handle"]>>
): Array<Record<string, unknown>> {
  if (result.status !== 200) {
    const payload = isRecord(result.body.payload)
      ? (result.body.payload as RuntimeErrorPayload)
      : ({
          code: "GENERATION_FAILED",
          message: "runtime request failed"
        } satisfies RuntimeErrorPayload)
    throw new SemanticRuntimeError(toRuntimeV2Error(payload))
  }

  if (isRuntimeBatchBody(result.body)) {
    return result.body.events.filter(isRecord)
  }

  return isRecord(result.body) ? [result.body] : []
}

function normalizeEnrichToolResult(
  requested: ContextEnrichRequestPayload,
  result: RuntimeV2ToolResultPayload | null
): ContextEnrichResultPayload & { imageBase64?: string; mimeType?: "image/png" | "image/jpeg" } {
  const payload = result?.result && isRecord(result.result.payload) ? result.result.payload : result?.result
  if (!result?.ok || !payload || !isRecord(payload)) {
    return {
      requestKind: requested.requestKind,
      targetRef: requested.targetRef,
      status: "failed",
      capturedAt: makeTimestamp(),
      failureReason: result?.error ?? "frontend did not return a valid enrich payload"
    }
  }

  const requestKind = asString(payload.requestKind)
  const status = asString(payload.status)
  const capturedAt = asString(payload.capturedAt)
  const targetRef = isRecord(payload.targetRef) ? payload.targetRef : null

  if (
    requestKind !== requested.requestKind ||
    !targetRef ||
    !status ||
    !capturedAt ||
    (status !== "ok" && status !== "failed" && status !== "unsupported")
  ) {
    return {
      requestKind: requested.requestKind,
      targetRef: requested.targetRef,
      status: "failed",
      capturedAt: makeTimestamp(),
      failureReason: "frontend returned an invalid enrich payload"
    }
  }

  return {
    requestKind,
    targetRef,
    status,
    capturedAt,
    ...(isRecord(payload.detail) ? { detail: payload.detail } : {}),
    ...(typeof payload.failureReason === "string" ? { failureReason: payload.failureReason } : {}),
    ...(typeof payload.imageBase64 === "string" ? { imageBase64: payload.imageBase64 } : {}),
    ...(payload.mimeType === "image/png" || payload.mimeType === "image/jpeg"
      ? { mimeType: payload.mimeType }
      : {})
  }
}

function extractSessionId(events: Array<Record<string, unknown>>): string | null {
  for (const event of events) {
    if (event.type === "session.ready" && isRecord(event.payload) && typeof event.payload.sessionId === "string") {
      return event.payload.sessionId
    }
  }
  return null
}

function extractTurnId(events: Array<Record<string, unknown>>): string | null {
  for (const event of events) {
    if (typeof event.turnId === "string" && event.turnId.length > 0) {
      return event.turnId
    }
  }
  return null
}

export class SemanticRuntimeManager {
  private readonly logger = createLogger("semantic/runtime")
  private readonly legacyRuntime: RuntimeManager
  private readonly sessions = new Map<string, SemanticSessionRecord>()

  constructor(args?: { legacyRuntime?: RuntimeManager; enrichTriggerMode?: string }) {
    this.legacyRuntime =
      args?.legacyRuntime ??
      new RuntimeManager(
        args?.enrichTriggerMode ? { enrichTriggerMode: args.enrichTriggerMode } : undefined
      )
  }

  async openSession(args: {
    principalUserId: string
    clientSessionId: string
    language?: string
  }): Promise<{
    sessionId: string
    clientSessionId: string
    reused: boolean
  }> {
    const events = normalizeRuntimeEvents(
      await this.legacyRuntime.handle(
        {
          type: "session.open",
          requestId: makeRequestId("session-open"),
          timestamp: makeTimestamp(),
          payload: {
            clientSessionId: args.clientSessionId
          }
        },
        {
          principalUserId: args.principalUserId
        }
      )
    )

    const sessionId = extractSessionId(events)
    if (!sessionId) {
      throw new SemanticRuntimeError({
        code: "GENERATION_FAILED",
        message: "semantic session did not return session.ready",
        recoverable: false
      })
    }

    const payload = events.find((event) => event.type === "session.ready")?.payload
    const reused = isRecord(payload) && payload.reused === true

    this.sessions.set(sessionId, {
      sessionId,
      principalUserId: args.principalUserId,
      clientSessionId: args.clientSessionId,
      ...(args.language ? { language: args.language } : {}),
      primaryTabId: null,
      snapshot: null
    })

    return {
      sessionId,
      clientSessionId: args.clientSessionId,
      reused
    }
  }

  async syncContext(args: {
    principalUserId: string
    sessionId: string
    tabId: number
    isPrimary?: boolean
  }): Promise<void> {
    const record = this.requireSession(args.sessionId, args.principalUserId)
    await this.runEnvelope(args.principalUserId, {
      type: "context.update",
      sessionId: args.sessionId,
      payload: {
        tabId: args.tabId,
        isPrimary: args.isPrimary ?? true
      }
    })
    if (args.isPrimary ?? true) {
      record.primaryTabId = args.tabId
    }
  }

  async syncSnapshot(args: {
    principalUserId: string
    sessionId: string
    tabId: number
    snapshot: SemanticSnapshot
  }): Promise<void> {
    const record = this.requireSession(args.sessionId, args.principalUserId)
    await this.runEnvelope(args.principalUserId, {
      type: "snapshot.push",
      sessionId: args.sessionId,
      payload: {
        tabId: args.tabId,
        snapshot: args.snapshot
      }
    })
    record.snapshot = args.snapshot
    record.primaryTabId = args.tabId
  }

  async interruptTurn(args: {
    principalUserId: string
    sessionId: string
    turnId?: string
    reason?: string
  }): Promise<void> {
    this.requireSession(args.sessionId, args.principalUserId)
    await this.runEnvelope(args.principalUserId, {
      type: "interrupt",
      sessionId: args.sessionId,
      ...(args.turnId ? { turnId: args.turnId } : {}),
      payload: args.reason ? { reason: args.reason } : {}
    })
  }

  async runTextTurn(args: {
    principalUserId: string
    sessionId: string
    text: string
    onTurnStarted: ((turnId: string) => Promise<void> | void) | undefined
    requestFrontendTool: (
      request: FrontendToolRequest
    ) => Promise<RuntimeV2ToolResultPayload | null>
  }): Promise<SemanticTurnExecutionResult> {
    return this.runCurrentPageTurn({
      principalUserId: args.principalUserId,
      sessionId: args.sessionId,
      text: args.text,
      onTurnStarted: args.onTurnStarted,
      requestFrontendTool: args.requestFrontendTool
    })
  }

  async answerCurrentPage(args: {
    principalUserId: string
    sessionId: string
    question: string
    onTurnStarted: ((turnId: string) => Promise<void> | void) | undefined
    requestFrontendTool: (
      request: FrontendToolRequest
    ) => Promise<RuntimeV2ToolResultPayload | null>
  }): Promise<SemanticTurnExecutionResult> {
    return this.runCurrentPageTurn({
      principalUserId: args.principalUserId,
      sessionId: args.sessionId,
      text: args.question,
      onTurnStarted: args.onTurnStarted,
      requestFrontendTool: args.requestFrontendTool
    })
  }

  getSessionSnapshot(sessionId: string): SemanticSnapshot | null {
    return this.sessions.get(sessionId)?.snapshot ?? null
  }

  getSessionLanguage(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.language
  }

  private requireSession(sessionId: string, principalUserId: string): SemanticSessionRecord {
    const record = this.sessions.get(sessionId)
    if (!record || record.principalUserId !== principalUserId) {
      throw new SemanticRuntimeError({
        code: "UNAUTHORIZED",
        message: "semantic session not found or owned by another principal",
        recoverable: false
      })
    }
    return record
  }

  private async runCurrentPageTurn(args: {
    principalUserId: string
    sessionId: string
    text: string
    onTurnStarted: ((turnId: string) => Promise<void> | void) | undefined
    requestFrontendTool: (
      request: FrontendToolRequest
    ) => Promise<RuntimeV2ToolResultPayload | null>
  }): Promise<SemanticTurnExecutionResult> {
    const record = this.requireSession(args.sessionId, args.principalUserId)
    if (record.primaryTabId === null || !record.snapshot) {
      throw new SemanticRuntimeError({
        code: "INVALID_SNAPSHOT",
        message: "semantic session is missing the current snapshot binding",
        recoverable: true
      })
    }

    const initialEvents = await this.runEnvelope(args.principalUserId, {
      type: "user.intent",
      sessionId: args.sessionId,
      payload: {
        text: args.text,
        primaryTabId: record.primaryTabId,
        boundSnapshotCapturedAt: record.snapshot.meta.capturedAt
      }
    })

    return this.processRuntimeEvents({
      principalUserId: args.principalUserId,
      sessionId: args.sessionId,
      events: initialEvents,
      onTurnStarted: args.onTurnStarted,
      requestFrontendTool: args.requestFrontendTool
    })
  }

  private async processRuntimeEvents(args: {
    principalUserId: string
    sessionId: string
    events: Array<Record<string, unknown>>
    onTurnStarted: ((turnId: string) => Promise<void> | void) | undefined
    requestFrontendTool: (
      request: FrontendToolRequest
    ) => Promise<RuntimeV2ToolResultPayload | null>
  }): Promise<SemanticTurnExecutionResult> {
    const turnId = extractTurnId(args.events)
    if (!turnId) {
      throw new SemanticRuntimeError({
        code: "GENERATION_FAILED",
        message: "runtime turn id was not produced",
        recoverable: true
      })
    }
    if (args.onTurnStarted) {
      await args.onTurnStarted(turnId)
    }

    let answerText: string | null = null
    let referencedTabIds: number[] = []
    let usedMemoryRecordIds: string[] = []
    let provenanceSummary: string[] = []
    const projections: Projection[] = []

    for (const event of args.events) {
      const type = typeof event.type === "string" ? event.type : ""

      if (type === "context.enrich.request") {
        const runtimeEvent = event as Extract<ServerEnvelope, { type: "context.enrich.request" }>
        const frontendResult = await args.requestFrontendTool({
          sessionId: args.sessionId,
          turnId,
          kind: "context.enrich",
          waitForResult: true,
          args: {
            ...runtimeEvent.payload
          }
        })

        const enrichPayload = normalizeEnrichToolResult(runtimeEvent.payload, frontendResult)
        const followUpEvents = await this.runEnvelope(args.principalUserId, {
          type: "context.enrich.result",
          sessionId: args.sessionId,
          turnId,
          payload: enrichPayload as unknown as Record<string, unknown>
        })
        const followUpResult = await this.processRuntimeEvents({
          principalUserId: args.principalUserId,
          sessionId: args.sessionId,
          events: followUpEvents,
          onTurnStarted: undefined,
          requestFrontendTool: args.requestFrontendTool
        })
        if (followUpResult.answerText) {
          answerText = followUpResult.answerText
        }
        projections.push(...followUpResult.projections)
        referencedTabIds = followUpResult.referencedTabIds
        usedMemoryRecordIds = followUpResult.usedMemoryRecordIds
        provenanceSummary = followUpResult.provenanceSummary
        continue
      }

      if (type === "projection" && isRecord(event.payload)) {
        const projection = event.payload as Projection
        projections.push(projection)
        if (projection.type === "respond") {
          answerText = projection.payload.text
        }
        continue
      }

      if (type === "turn.done" && isRecord(event.payload)) {
        if (Array.isArray(event.payload.referencedTabIds)) {
          referencedTabIds = event.payload.referencedTabIds.filter(
            (value): value is number => typeof value === "number"
          )
        }
        if (Array.isArray(event.payload.usedMemoryRecordIds)) {
          usedMemoryRecordIds = event.payload.usedMemoryRecordIds.filter(
            (value): value is string => typeof value === "string"
          )
        }
        if (Array.isArray(event.payload.provenanceSummary)) {
          provenanceSummary = event.payload.provenanceSummary.filter(
            (value): value is string => typeof value === "string"
          )
        }
      }
    }

    this.logger.debug("semantic-turn-completed", {
      sessionId: args.sessionId,
      turnId,
      projectionCount: projections.length,
      answerPresent: Boolean(answerText)
    })

    return {
      turnId,
      answerText,
      projections,
      referencedTabIds,
      usedMemoryRecordIds,
      provenanceSummary
    }
  }

  private async runEnvelope(
    principalUserId: string,
    envelope: {
      type:
        | "context.update"
        | "snapshot.push"
        | "user.intent"
        | "context.enrich.result"
        | "interrupt"
      sessionId: string
      turnId?: string
      payload: Record<string, unknown>
    }
  ): Promise<Array<Record<string, unknown>>> {
    try {
      return normalizeRuntimeEvents(
        await this.legacyRuntime.handle(
          {
            type: envelope.type,
            requestId: makeRequestId(envelope.type),
            timestamp: makeTimestamp(),
            sessionId: envelope.sessionId,
            ...(envelope.turnId ? { turnId: envelope.turnId } : {}),
            payload: envelope.payload
          },
          {
            principalUserId
          }
        )
      )
    } catch (error) {
      throw toSemanticRuntimeError(error, "GENERATION_FAILED")
    }
  }
}
