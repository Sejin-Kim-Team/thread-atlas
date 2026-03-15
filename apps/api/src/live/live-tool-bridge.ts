import type {
  ClientEnvelope,
  ContextEnrichRequestPayload,
  ContextEnrichResultPayload,
  RuntimeErrorPayload,
  ServerEnvelope
} from "@threadatlas/shared/runtime"
import type {
  LiveFrontendToolName,
  LiveToolResultPayload
} from "@threadatlas/shared/runtime"
import type { Projection, SemanticSnapshot } from "@threadatlas/shared"
import { createLogger } from "../runtime/logger"
import { RuntimeManager } from "../session/runtime/manager"

interface RuntimeBatchBody {
  type: "event.batch"
  requestId?: string
  sessionId: string
  turnId: string
  timestamp: string
  events: unknown[]
}

type RuntimeHandleResult = Awaited<ReturnType<RuntimeManager["handle"]>>

interface FrontendToolInvoker {
  invoke(args: {
    name: LiveFrontendToolName
    payload: Record<string, unknown>
    waitForResult: boolean
  }): Promise<Record<string, unknown> | null>
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

function isRuntimeBatchBody(value: unknown): value is RuntimeBatchBody {
  return (
    isRecord(value) &&
    value.type === "event.batch" &&
    typeof value.sessionId === "string" &&
    typeof value.turnId === "string" &&
    Array.isArray(value.events)
  )
}

function normalizeRuntimeEvents(result: RuntimeHandleResult): Array<Record<string, unknown>> {
  if (result.status !== 200) {
    const payload = isRecord(result.body.payload) ? (result.body.payload as RuntimeErrorPayload) : null
    throw new Error(payload?.message ?? "runtime request failed")
  }

  if (isRuntimeBatchBody(result.body)) {
    return result.body.events.filter(isRecord)
  }

  return isRecord(result.body) ? [result.body] : []
}

function toRuntimeError(error: unknown, fallbackCode: RuntimeErrorPayload["code"]): RuntimeErrorPayload {
  if (isRecord(error) && typeof error.code === "string" && typeof error.message === "string") {
    return {
      code: error.code as RuntimeErrorPayload["code"],
      message: error.message
    }
  }

  return {
    code: fallbackCode,
    message: error instanceof Error ? error.message : "runtime bridge failed"
  }
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function buildRuntimeEnvelope(args: {
  type: ClientEnvelope["type"]
  payload: ClientEnvelope["payload"]
  sessionId?: string
  turnId?: string
}): ClientEnvelope {
  return {
    type: args.type,
    requestId: makeRequestId(args.type),
    timestamp: makeTimestamp(),
    ...(args.sessionId ? { sessionId: args.sessionId } : {}),
    ...(args.turnId ? { turnId: args.turnId } : {}),
    payload: args.payload
  } as ClientEnvelope
}

function normalizeEnrichToolResult(
  requested: ContextEnrichRequestPayload,
  result: Record<string, unknown> | null
): ContextEnrichResultPayload {
  const payload = result && isRecord(result.payload) ? result.payload : result
  if (!payload || !isRecord(payload)) {
    return {
      requestKind: requested.requestKind,
      targetRef: requested.targetRef,
      status: "failed",
      capturedAt: makeTimestamp(),
      failureReason: "frontend did not return a valid enrich payload"
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
    ...(typeof payload.failureReason === "string" ? { failureReason: payload.failureReason } : {})
  }
}

function extractRuntimeSessionId(events: Array<Record<string, unknown>>): string | null {
  for (const event of events) {
    if (event.type === "session.ready" && isRecord(event.payload) && typeof event.payload.sessionId === "string") {
      return event.payload.sessionId
    }
  }
  return null
}

export class LiveToolBridge {
  private readonly logger = createLogger("live/tool-bridge")
  private runtimeSessionId: string | null = null
  private readonly runtimeClientSessionId: string

  constructor(
    private readonly args: {
      runtime: RuntimeManager
      principalUserId: string
      liveSessionId: string
      clientSessionId: string
      tabId: number
      snapshot: SemanticSnapshot
      frontendTools: FrontendToolInvoker
    }
  ) {
    this.runtimeClientSessionId = `live:${args.clientSessionId}:${args.liveSessionId}`
  }

  async initialize(): Promise<void> {
    const sessionReadyEvents = normalizeRuntimeEvents(
      await this.args.runtime.handle(
        buildRuntimeEnvelope({
          type: "session.open",
          payload: {
            clientSessionId: this.runtimeClientSessionId
          }
        }),
        {
          principalUserId: this.args.principalUserId
        }
      )
    )

    this.runtimeSessionId = extractRuntimeSessionId(sessionReadyEvents)
    if (!this.runtimeSessionId) {
      throw new Error("runtime session did not return session.ready")
    }

    await this.runRuntimeEnvelope({
      type: "context.update",
      sessionId: this.runtimeSessionId,
      payload: {
        tabId: this.args.tabId,
        isPrimary: true
      }
    })

    await this.runRuntimeEnvelope({
      type: "snapshot.push",
      sessionId: this.runtimeSessionId,
      payload: {
        tabId: this.args.tabId,
        snapshot: this.args.snapshot
      }
    })
  }

  async getCurrentPageAnswer(question: string): Promise<{
    answerText: string
    provenanceSummary: string[]
  }> {
    if (!this.runtimeSessionId) {
      throw new Error("runtime session is not initialized")
    }

    const events = await this.runRuntimeEnvelope({
      type: "user.intent",
      sessionId: this.runtimeSessionId,
      payload: {
        text: question,
        primaryTabId: this.args.tabId,
        boundSnapshotCapturedAt: this.args.snapshot.meta.capturedAt
      }
    })

    return this.processRuntimeEvents(events)
  }

  private async runRuntimeEnvelope(
    envelope: Omit<ClientEnvelope, "requestId" | "timestamp"> & {
      payload: ClientEnvelope["payload"]
    }
  ): Promise<Array<Record<string, unknown>>> {
    const result = await this.args.runtime.handle(
      {
        ...envelope,
        requestId: makeRequestId(envelope.type),
        timestamp: makeTimestamp()
      } as ClientEnvelope,
      {
        principalUserId: this.args.principalUserId
      }
    )

    return normalizeRuntimeEvents(result)
  }

  private async processRuntimeEvents(
    events: Array<Record<string, unknown>>
  ): Promise<{ answerText: string; provenanceSummary: string[] }> {
    let answerText = ""
    let provenanceSummary: string[] = []

    for (const event of events) {
      const type = typeof event.type === "string" ? event.type : ""

      if (type === "context.enrich.request") {
        const runtimeEvent = event as Extract<ServerEnvelope, { type: "context.enrich.request" }>
        const frontendResult = await this.args.frontendTools.invoke({
          name: "request_context_enrich",
          payload: { ...runtimeEvent.payload },
          waitForResult: true
        })
        const enrichPayload = normalizeEnrichToolResult(runtimeEvent.payload, frontendResult)
        const followUpEnvelope: Omit<ClientEnvelope, "requestId" | "timestamp"> & {
          payload: ClientEnvelope["payload"]
        } = {
          type: "context.enrich.result",
          payload: enrichPayload
        }
        if (this.runtimeSessionId) {
          followUpEnvelope.sessionId = this.runtimeSessionId
        }
        if (typeof runtimeEvent.turnId === "string") {
          followUpEnvelope.turnId = runtimeEvent.turnId
        }
        const followUpEvents = await this.runRuntimeEnvelope({
          ...followUpEnvelope
        })
        const followUp = await this.processRuntimeEvents(followUpEvents)
        if (followUp.answerText) {
          answerText = followUp.answerText
        }
        if (followUp.provenanceSummary.length > 0) {
          provenanceSummary = followUp.provenanceSummary
        }
        continue
      }

      if (type === "projection" && isRecord(event.payload)) {
        const projection = event.payload as Projection
        if (projection.type === "respond" && projection.payload.mode === "answer") {
          answerText = projection.payload.text
          continue
        }

        if (
          projection.type === "focus" ||
          projection.type === "focusMultiple" ||
          projection.type === "navigate"
        ) {
          await this.args.frontendTools.invoke({
            name: "focus_node",
            payload: { projection },
            waitForResult: false
          })
          continue
        }

        if (projection.type === "present") {
          await this.args.frontendTools.invoke({
            name: "present_content",
            payload: { projection },
            waitForResult: false
          })
        }
        continue
      }

      if (type === "turn.done" && isRecord(event.payload)) {
        const rawProvenance = Array.isArray(event.payload.provenanceSummary)
          ? event.payload.provenanceSummary
          : []
        provenanceSummary = rawProvenance.filter((item): item is string => typeof item === "string")
      }
    }

    if (!answerText) {
      this.logger.warn("live-tool-bridge-empty-answer", {
        liveSessionId: this.args.liveSessionId,
        runtimeSessionId: this.runtimeSessionId
      })
    }

    return {
      answerText,
      provenanceSummary
    }
  }
}

export function toFrontendToolErrorPayload(error: unknown): LiveToolResultPayload {
  const runtimeError = toRuntimeError(error, "GENERATION_FAILED")
  return {
    name: "request_context_enrich",
    ok: false,
    error: runtimeError.message
  }
}
