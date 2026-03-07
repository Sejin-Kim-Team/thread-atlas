import type {
  ContextUpdatePayload,
  RuntimeEnvelope,
  RuntimeErrorPayload,
  RuntimeSession,
  SessionOpenPayload,
  SnapshotLike,
  SnapshotPushPayload,
  UserIntentPayload
} from "./types"

type RuntimeResult =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400 | 401; body: { type: "error"; payload: RuntimeErrorPayload } }

interface RuntimeHandleContext {
  principalUserId: string
}

const MAX_RUNTIME_SESSIONS = 256
const RECALL_CARD_MIN_SIMILARITY = 0.8

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function invalidEvent(message: string): RuntimeResult {
  return {
    status: 400,
    body: {
      type: "error",
      payload: {
        code: "INVALID_EVENT",
        message
      }
    }
  }
}

function invalidSnapshot(message: string): RuntimeResult {
  return {
    status: 400,
    body: {
      type: "error",
      payload: {
        code: "INVALID_SNAPSHOT",
        message
      }
    }
  }
}

function unauthorized(message: string): RuntimeResult {
  return {
    status: 401,
    body: {
      type: "error",
      payload: {
        code: "UNAUTHORIZED",
        message
      }
    }
  }
}

function validateEnvelope(input: unknown): RuntimeEnvelope | null {
  if (!isObject(input)) {
    return null
  }

  const type = asString(input.type)
  const timestamp = asString(input.timestamp)
  const requestId = asString(input.requestId)

  if (!type || !timestamp || !requestId || !("payload" in input)) {
    return null
  }

  const envelope: RuntimeEnvelope = {
    type,
    timestamp,
    payload: input.payload,
    requestId,
  }

  const sessionId = asString(input.sessionId)
  if (sessionId) {
    envelope.sessionId = sessionId
  }

  const turnId = asString(input.turnId)
  if (turnId) {
    envelope.turnId = turnId
  }

  return envelope
}

function parseSessionOpenPayload(payload: unknown): SessionOpenPayload | null {
  if (!isObject(payload)) {
    return null
  }
  const clientSessionId = asString(payload.clientSessionId)
  if (!clientSessionId) {
    return null
  }
  return { clientSessionId }
}

function parseContextUpdatePayload(payload: unknown): ContextUpdatePayload | null {
  if (!isObject(payload)) {
    return null
  }
  const tabId = asNumber(payload.tabId)
  if (tabId === null) {
    return null
  }
  const parsed: ContextUpdatePayload = { tabId }
  if (typeof payload.isPrimary === "boolean") {
    parsed.isPrimary = payload.isPrimary
  }
  return parsed
}

function isSnapshotLike(snapshot: unknown): snapshot is SnapshotLike {
  if (!isObject(snapshot)) {
    return false
  }
  const focus = snapshot.focus
  const meta = snapshot.meta
  return isObject(focus) && isObject(meta)
}

function parseSnapshotPushPayload(payload: unknown): SnapshotPushPayload | null {
  if (!isObject(payload)) {
    return null
  }
  const tabId = asNumber(payload.tabId)
  const snapshot = payload.snapshot
  if (tabId === null || !isSnapshotLike(snapshot)) {
    return null
  }
  return { tabId, snapshot }
}

function parseUserIntentPayload(payload: unknown): UserIntentPayload | null {
  if (!isObject(payload)) {
    return null
  }
  const text = asString(payload.text)
  const primaryTabId = asNumber(payload.primaryTabId)
  const boundSnapshotCapturedAt = asString(payload.boundSnapshotCapturedAt)
  const mode = asString(payload.mode)

  if (!text || primaryTabId === null || !boundSnapshotCapturedAt) {
    return null
  }

  const parsed: UserIntentPayload = {
    text,
    primaryTabId,
    boundSnapshotCapturedAt
  }

  if (mode) {
    parsed.mode = mode
  }

  return parsed
}

function hasFocusIdMismatch(snapshot: SnapshotLike): boolean {
  const focusNodeId = snapshot.focus?.nodeId
  const focusNodeObjectId = snapshot.focus?.node?.id
  if (!focusNodeId || !focusNodeObjectId) {
    return true
  }
  return focusNodeId !== focusNodeObjectId
}

function makeTimestamp(): string {
  return new Date().toISOString()
}

function extractSourceDomain(url: string | undefined): string | undefined {
  const normalized = asStringOrNull(url)
  if (!normalized) {
    return undefined
  }
  try {
    return new URL(normalized).hostname
  } catch {
    return undefined
  }
}

function resolveFocusText(snapshot: SnapshotLike): string {
  const focusText = asStringOrNull(snapshot.focus?.node?.text)
  return focusText ?? ""
}

function buildRecallQueryText(intentText: string, snapshot: SnapshotLike, answerText: string): string {
  // recall 질의는 intent + focus text + answer 요약을 합쳐 현재 맥락을 최대한 보존한다.
  return [intentText, resolveFocusText(snapshot), answerText].filter(Boolean).join(" ")
}

function selectRecallCandidate(
  candidates: RuntimeRecallCandidate[],
  ownerUserId: string
): RuntimeRecallCandidate | null {
  for (const candidate of candidates) {
    const similarityScore = asFiniteNumber(candidate.similarityScore)
    const isSameOwner = candidate.ownerUserId === ownerUserId
    if (!isSameOwner) {
      continue
    }
    if (similarityScore === null || similarityScore < RECALL_CARD_MIN_SIMILARITY) {
      continue
    }
    if (!asStringOrNull(candidate.canonicalUrl)) {
      continue
    }
    return candidate
  }
  return null
}

export class RuntimeManager {
  private sessionCounter = 0
  private turnCounter = 0
  private sessions = new Map<string, RuntimeSession>()
  private sessionByPrincipalClientId = new Map<string, string>()
  private ownerByClientSessionId = new Map<string, string>()

  async handle(raw: unknown, context: RuntimeHandleContext): Promise<RuntimeResult> {
    const envelope = validateEnvelope(raw)
    if (!envelope) {
      return invalidEvent("invalid envelope")
    }

    if (envelope.type === "session.open") {
      return this.handleSessionOpen(envelope, context.principalUserId)
    }

    const sessionId = envelope.sessionId
    if (!sessionId) {
      return invalidEvent("sessionId is required")
    }
    const session = this.sessions.get(sessionId)
    if (!session) {
      return invalidEvent("session not found")
    }
    if (session.ownerUserId !== context.principalUserId) {
      return unauthorized("session owner mismatch")
    }
    session.lastSeenAtMs = Date.now()

    if (envelope.type === "context.update") {
      return this.handleContextUpdate(envelope, session)
    }
    if (envelope.type === "snapshot.push") {
      return this.handleSnapshotPush(envelope, session)
    }
    if (envelope.type === "user.intent") {
      return this.handleUserIntent(envelope, session)
    }
    if (envelope.type === "interrupt") {
      session.activeTurnId = null
      return {
        status: 200,
        body: {
          type: "ack",
          sessionId,
          timestamp: makeTimestamp(),
          payload: { ok: true }
        }
      }
    }

    return invalidEvent("unsupported event type")
  }

  private handleSessionOpen(envelope: RuntimeEnvelope, principalUserId: string): RuntimeResult {
    const parsed = parseSessionOpenPayload(envelope.payload)
    if (!parsed) {
      return invalidEvent("invalid session.open payload")
    }

    const existingOwner = this.ownerByClientSessionId.get(parsed.clientSessionId)
    if (existingOwner && existingOwner !== principalUserId) {
      // 보안 경계: 다른 주체가 같은 세션 식별자를 재사용하지 못하게 막는다.
      return unauthorized("clientSessionId is owned by another principal")
    }

    const ownerSessionKey = `${principalUserId}:${parsed.clientSessionId}`
    const existing = this.sessionByPrincipalClientId.get(ownerSessionKey)
    const sessionId = existing ?? this.newSessionId()

    if (!existing) {
      this.pruneSessionsIfNeeded()
      this.ownerByClientSessionId.set(parsed.clientSessionId, principalUserId)
      this.sessionByPrincipalClientId.set(ownerSessionKey, sessionId)
      this.sessions.set(sessionId, {
        sessionId,
        ownerUserId: principalUserId,
        clientSessionId: parsed.clientSessionId,
        createdAtMs: Date.now(),
        lastSeenAtMs: Date.now(),
        primaryTabId: null,
        latestSnapshotByTab: new Map<number, SnapshotLike>(),
        activeTurnId: null
      })
    }

    return {
      status: 200,
      body: {
        type: "session.ready",
        requestId: envelope.requestId,
        sessionId,
        timestamp: makeTimestamp(),
        payload: {
          protocolVersion: 1,
          sessionId
        }
      }
    }
  }

  private handleContextUpdate(envelope: RuntimeEnvelope, session: RuntimeSession): RuntimeResult {
    const parsed = parseContextUpdatePayload(envelope.payload)
    if (!parsed) {
      return invalidEvent("invalid context.update payload")
    }

    const shouldSetPrimary = parsed.isPrimary ?? true
    if (shouldSetPrimary) {
      session.primaryTabId = parsed.tabId
    }

    return {
      status: 200,
      body: {
        type: "ack",
        requestId: envelope.requestId,
        sessionId: session.sessionId,
        timestamp: makeTimestamp(),
        payload: {
          ok: true
        }
      }
    }
  }

  private handleSnapshotPush(envelope: RuntimeEnvelope, session: RuntimeSession): RuntimeResult {
    const parsed = parseSnapshotPushPayload(envelope.payload)
    if (!parsed) {
      return invalidSnapshot("invalid snapshot.push payload")
    }

    if (session.primaryTabId === null) {
      return invalidSnapshot("primary tab is not set")
    }

    if (parsed.tabId !== session.primaryTabId) {
      // 현재 페이지 계약: 기준 탭과 다른 스냅샷은 수용하지 않는다.
      return invalidSnapshot("snapshot.push tabId must match primary tab")
    }

    if (hasFocusIdMismatch(parsed.snapshot)) {
      return invalidSnapshot("focus node mismatch")
    }

    if (!asString(parsed.snapshot.meta?.capturedAt)) {
      return invalidSnapshot("snapshot.meta.capturedAt is required")
    }

    session.latestSnapshotByTab.set(parsed.tabId, parsed.snapshot)

    return {
      status: 200,
      body: {
        type: "ack",
        requestId: envelope.requestId,
        sessionId: session.sessionId,
        timestamp: makeTimestamp(),
        payload: {
          ok: true
        }
      }
    }
  }

  private async handleUserIntent(
    envelope: RuntimeEnvelope,
    session: RuntimeSession
  ): Promise<RuntimeResult> {
    const parsed = parseUserIntentPayload(envelope.payload)
    if (!parsed) {
      return invalidEvent("invalid user.intent payload")
    }

    if (session.primaryTabId === null || session.primaryTabId !== parsed.primaryTabId) {
      return invalidSnapshot("primary tab mismatch")
    }

    const latest = session.latestSnapshotByTab.get(parsed.primaryTabId)
    if (!latest) {
      return invalidSnapshot("latest snapshot not found")
    }

    const capturedAt = asString(latest.meta?.capturedAt)
    if (!capturedAt || capturedAt !== parsed.boundSnapshotCapturedAt) {
      return invalidSnapshot("bound snapshot mismatch")
    }

    // 선점 중단 정책: 새 요청이 오면 기존 턴을 중단하고 교체한다.
    if (session.activeTurnId) {
      session.activeTurnId = null
    }

    const turnId = this.newTurnId()
    session.activeTurnId = turnId
    const answerText = "current-page answer placeholder"

    const events: Array<Record<string, unknown>> = [
      {
        type: "progress",
        turnId,
        sessionId: session.sessionId,
        timestamp: makeTimestamp(),
        payload: {
          stage: "intent-routed"
        }
      },
      {
        type: "projection",
        turnId,
        sessionId: session.sessionId,
        timestamp: makeTimestamp(),
        payload: {
          kind: "present",
          body: {
            type: "answer",
            text: answerText,
            responseMode: "answer",
            provenanceSummary: ["current-page"]
          }
        }
      }
    ]

    const usedMemoryRecordIds: string[] = []

    try {
      const { retrieveMemoryCandidates } = await import("../../rag/retrieval-service")
      const retrievalInput: {
        ownerUserId: string
        queryText: string
        limit: number
        pageKind?: "article" | "thread" | "post" | "generic"
        sourceDomain?: string
      } = {
        ownerUserId: session.ownerUserId,
        queryText: buildRecallQueryText(parsed.text, latest, answerText),
        limit: 2
      }
      if (latest.page?.kind) {
        retrievalInput.pageKind = latest.page.kind
      }
      const sourceDomain = extractSourceDomain(latest.page?.url)
      if (sourceDomain) {
        retrievalInput.sourceDomain = sourceDomain
      }

      const recallCandidates = await retrieveMemoryCandidates(retrievalInput)
      const selectedRecall = selectRecallCandidate(recallCandidates, session.ownerUserId)
      if (selectedRecall) {
        const navigation: Record<string, unknown> = {
          canonicalUrl: selectedRecall.canonicalUrl
        }
        if (selectedRecall.nodeAnchor) {
          navigation.nodeAnchor = selectedRecall.nodeAnchor
        }
        if (selectedRecall.openMode) {
          navigation.openMode = selectedRecall.openMode
        }

        events.push({
          type: "projection",
          turnId,
          sessionId: session.sessionId,
          timestamp: makeTimestamp(),
          payload: {
            kind: "present",
            body: {
              type: "recall-card",
              summary: selectedRecall.summary,
              kind: selectedRecall.kind,
              similarityScore: selectedRecall.similarityScore,
              navigation
            }
          }
        })
        usedMemoryRecordIds.push(selectedRecall.recordId)
      }
    } catch {
      // retrieval 오류는 전체 턴 실패로 전파하지 않고 answer 우선 정책을 유지한다.
    }

    const turnDonePayload: Record<string, unknown> = {
      referencedTabIds: [parsed.primaryTabId]
    }
    if (usedMemoryRecordIds.length > 0) {
      turnDonePayload.usedMemoryRecordIds = usedMemoryRecordIds
    }

    events.push({
      type: "turn.done",
      turnId,
      sessionId: session.sessionId,
      timestamp: makeTimestamp(),
      payload: turnDonePayload
    })

    return {
      status: 200,
      body: {
        type: "event.batch",
        requestId: envelope.requestId,
        sessionId: session.sessionId,
        turnId,
        timestamp: makeTimestamp(),
        events
      }
    }
  }

  private newSessionId(): string {
    this.sessionCounter += 1
    return `sess-${this.sessionCounter.toString().padStart(4, "0")}`
  }

  private newTurnId(): string {
    this.turnCounter += 1
    return `turn-${this.turnCounter.toString().padStart(4, "0")}`
  }

  private pruneSessionsIfNeeded(): void {
    if (this.sessions.size < MAX_RUNTIME_SESSIONS) {
      return
    }

    const oldest = this.sessions.values().next().value as RuntimeSession | undefined
    if (!oldest) {
      return
    }

    this.sessions.delete(oldest.sessionId)
    this.sessionByPrincipalClientId.delete(`${oldest.ownerUserId}:${oldest.clientSessionId}`)
    this.ownerByClientSessionId.delete(oldest.clientSessionId)
  }
}
interface RuntimeRecallCandidate {
  recordId: string
  ownerUserId: string
  summary: string
  kind: "branch-summary" | "section-summary" | "claim-evidence-summary"
  canonicalUrl: string
  nodeAnchor?: Record<string, unknown>
  openMode?: "same-tab" | "new-tab" | "sidepanel-preview"
  similarityScore: number
}
