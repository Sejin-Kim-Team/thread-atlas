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
import { createLogger } from "../../runtime/logger"

type RuntimeResult =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400 | 401; body: { type: "error"; payload: RuntimeErrorPayload } }

interface RuntimeHandleContext {
  principalUserId: string
}

const logger = createLogger("session/runtime")

const MAX_RUNTIME_SESSIONS = 256
const RECALL_CARD_MIN_SIMILARITY = 0.8
const ENRICH_DEFAULT_TIMEOUT_MS = 3000
const ENRICH_TRIGGER_MODES = ["rule", "hybrid-simple", "hybrid-complex"] as const
const ENRICH_REQUEST_KINDS = [
  "node-screenshot",
  "visible-region",
  "node-detail"
] as const

type EnrichRequestKind = (typeof ENRICH_REQUEST_KINDS)[number]
type EnrichTriggerMode = (typeof ENRICH_TRIGGER_MODES)[number]

interface BilingualKeywordSet {
  ko: readonly string[]
  en: readonly string[]
}

interface EnrichRuleSignals {
  hasVisual: boolean
  hasEntity: boolean
  hasDetail: boolean
  hardPositive: boolean
  hardNegative: boolean
  ambiguous: boolean
}

interface EnrichRuleDecision {
  shouldRequestEnrich: boolean
  requestKind: EnrichRequestKind
  reason: string
}

interface EnrichAssistDecision {
  decision: "enrich" | "no-enrich"
  requestKind: EnrichRequestKind
  reason: string
}

const ENRICH_RULE_DICTIONARY: Record<
  "visual" | "entity" | "detail" | "hardNegative" | "ambiguous",
  BilingualKeywordSet
> = {
  visual: {
    ko: [
      "차트",
      "그래프",
      "이미지",
      "스크린샷",
      "영역",
      "캡처",
      "화면",
      "시각",
      "ui",
      "인터페이스",
      "레이아웃",
      "버튼",
      "아이콘",
      "표",
      "도표",
      "다이어그램"
    ],
    en: [
      "chart",
      "graph",
      "image",
      "screenshot",
      "region",
      "visual",
      "screen",
      "ui",
      "interface",
      "layout",
      "button",
      "icon",
      "table",
      "diagram",
      "canvas"
    ]
  },
  entity: {
    ko: [
      "엔티티",
      "개체",
      "댓글",
      "노드",
      "항목",
      "요소",
      "문단",
      "작성자",
      "사용자",
      "카드",
      "링크",
      "행",
      "열",
      "셀"
    ],
    en: [
      "entity",
      "item",
      "comment",
      "node",
      "element",
      "paragraph",
      "author",
      "user",
      "card",
      "link",
      "row",
      "column",
      "cell"
    ]
  },
  detail: {
    ko: [
      "자세",
      "상세",
      "확인",
      "설명",
      "분석",
      "읽어",
      "검토",
      "근거",
      "정밀",
      "확대"
    ],
    en: [
      "detail",
      "detailed",
      "inspect",
      "explain",
      "analyze",
      "read",
      "review",
      "evidence",
      "closer",
      "zoom",
      "more context"
    ]
  },
  hardNegative: {
    ko: [
      "보지 말",
      "확인하지 말",
      "텍스트만",
      "추가 확인 없이",
      "캡처하지 말",
      "상세 필요없",
      "지금 내용만"
    ],
    en: [
      "do not inspect",
      "don't inspect",
      "text only",
      "without extra context",
      "no screenshot",
      "skip details",
      "answer as is"
    ]
  },
  ambiguous: {
    ko: ["애매", "판단해줘", "도와줘", "확실하지", "모르겠"],
    en: ["ambiguous", "not sure", "unclear", "help me decide", "cannot tell"]
  }
}

ensureBilingualRuleDictionary(ENRICH_RULE_DICTIONARY)

interface ContextEnrichResultPayload {
  requestKind: EnrichRequestKind
  targetRef: Record<string, unknown>
  status: "ok" | "failed" | "unsupported"
  capturedAt: string
  detail?: Record<string, unknown>
  failureReason?: string
}

interface RuntimeManagerOptions {
  enrichTriggerMode?: string
}

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

function modelConfigMissing(message: string): RuntimeResult {
  return {
    status: 400,
    body: {
      type: "error",
      payload: {
        code: "MODEL_CONFIG_MISSING",
        message
      }
    }
  }
}

function generationFailed(message: string): RuntimeResult {
  return {
    status: 400,
    body: {
      type: "error",
      payload: {
        code: "GENERATION_FAILED",
        message
      }
    }
  }
}

function interruptedTurnBatch(
  requestId: string | undefined,
  session: RuntimeSession,
  turnId: string
): RuntimeResult {
  return {
    status: 200,
    body: {
      type: "event.batch",
      requestId,
      sessionId: session.sessionId,
      turnId,
      timestamp: makeTimestamp(),
      events: []
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
  if (!isObject(focus) || !isObject(meta)) {
    return false
  }

  if (!("visualSignals" in snapshot)) {
    return true
  }

  const visualSignals = snapshot.visualSignals
  if (visualSignals === undefined) {
    return true
  }
  if (!isObject(visualSignals)) {
    return false
  }

  const uiSuspicious = visualSignals.uiSuspicious
  if (uiSuspicious !== undefined && typeof uiSuspicious !== "boolean") {
    return false
  }

  const anomalyScore = visualSignals.anomalyScore
  if (anomalyScore !== undefined && asFiniteNumber(anomalyScore) === null) {
    return false
  }

  return true
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

  if (!text || primaryTabId === null || !boundSnapshotCapturedAt) {
    return null
  }

  return {
    text,
    primaryTabId,
    boundSnapshotCapturedAt
  }
}

function parseContextEnrichResultPayload(payload: unknown): ContextEnrichResultPayload | null {
  if (!isObject(payload)) {
    return null
  }

  const requestKind = asString(payload.requestKind)
  const capturedAt = asString(payload.capturedAt)
  const status = asString(payload.status)
  const targetRef = payload.targetRef

  if (
    !requestKind ||
    !capturedAt ||
    !status ||
    !isObject(targetRef) ||
    !ENRICH_REQUEST_KINDS.includes(requestKind as EnrichRequestKind) ||
    !["ok", "failed", "unsupported"].includes(status)
  ) {
    return null
  }

  const parsed: ContextEnrichResultPayload = {
    requestKind: requestKind as ContextEnrichResultPayload["requestKind"],
    targetRef,
    status: status as ContextEnrichResultPayload["status"],
    capturedAt
  }

  if (isObject(payload.detail)) {
    parsed.detail = payload.detail
  }

  const failureReason = asString(payload.failureReason)
  if (failureReason) {
    parsed.failureReason = failureReason
  }

  return parsed
}

function normalizeUnknownForBinding(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeUnknownForBinding(item))
  }
  if (isObject(value)) {
    const normalized: Record<string, unknown> = {}
    const keys = Object.keys(value).sort((a, b) => a.localeCompare(b))
    for (const key of keys) {
      normalized[key] = normalizeUnknownForBinding(value[key])
    }
    return normalized
  }
  return value
}

function normalizeTargetRefForBinding(targetRef: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {}
  const keys = Object.keys(targetRef).sort((a, b) => a.localeCompare(b))

  for (const key of keys) {
    if (key === "type") {
      continue
    }
    normalized[key] = normalizeUnknownForBinding(targetRef[key])
  }

  const normalizedKind = asString(targetRef.kind) ?? asString(targetRef.type)
  if (normalizedKind) {
    normalized.kind = normalizedKind
  }

  return normalized
}

function areBindingValuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true
  }
  if (typeof left !== typeof right) {
    return false
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return false
    }
    for (let index = 0; index < left.length; index += 1) {
      if (!areBindingValuesEqual(left[index], right[index])) {
        return false
      }
    }
    return true
  }
  if (isObject(left) && isObject(right)) {
    const leftKeys = Object.keys(left).sort((a, b) => a.localeCompare(b))
    const rightKeys = Object.keys(right).sort((a, b) => a.localeCompare(b))
    if (leftKeys.length !== rightKeys.length) {
      return false
    }
    for (let index = 0; index < leftKeys.length; index += 1) {
      if (leftKeys[index] !== rightKeys[index]) {
        return false
      }
      const key = leftKeys[index]
      if (!key) {
        return false
      }
      if (!areBindingValuesEqual(left[key], right[key])) {
        return false
      }
    }
    return true
  }
  return false
}

function isExactTargetRefMatch(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>
): boolean {
  return areBindingValuesEqual(
    normalizeTargetRefForBinding(expected),
    normalizeTargetRefForBinding(actual)
  )
}

function isCrossTabTargetRef(targetRef: Record<string, unknown>): boolean {
  const normalizedKind = asString(targetRef.kind) ?? asString(targetRef.type)
  return normalizedKind === "cross-tab"
}

interface NormalizedEnrichDetailForPrompt {
  textPreview?: string
  htmlPreview?: string
  attributes?: Record<string, string>
  bounds?: {
    x: number
    y: number
    width: number
    height: number
  }
}

function sanitizePromptText(value: string, maxLength: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength)
}

function normalizeEnrichDetailForPrompt(
  enrichDetail?: Record<string, unknown>
): NormalizedEnrichDetailForPrompt | null {
  if (!enrichDetail) {
    return null
  }

  const normalized: NormalizedEnrichDetailForPrompt = {}

  const detailText = asString(enrichDetail.text)
  if (detailText) {
    normalized.textPreview = sanitizePromptText(detailText, 300)
  }

  const htmlSnippet = asString(enrichDetail.htmlSnippet)
  if (htmlSnippet) {
    const strippedScript = htmlSnippet.replace(/<script[\s\S]*?<\/script>/gi, " ")
    normalized.htmlPreview = sanitizePromptText(strippedScript, 240)
  }

  if (isObject(enrichDetail.attributes)) {
    const safeAttributes: Record<string, string> = {}
    const keys = Object.keys(enrichDetail.attributes)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 12)
    for (const key of keys) {
      const lowered = key.toLowerCase()
      if (lowered.startsWith("on")) {
        continue
      }
      const isSafeKey =
        lowered === "id" ||
        lowered === "class" ||
        lowered === "role" ||
        lowered === "title" ||
        lowered.startsWith("aria-") ||
        lowered.startsWith("data-")
      if (!isSafeKey) {
        continue
      }
      const rawValue = asString(enrichDetail.attributes[key])
      if (!rawValue) {
        continue
      }
      safeAttributes[key] = sanitizePromptText(rawValue, 80)
    }
    if (Object.keys(safeAttributes).length > 0) {
      normalized.attributes = safeAttributes
    }
  }

  if (isObject(enrichDetail.bounds)) {
    const x = asFiniteNumber(enrichDetail.bounds.x)
    const y = asFiniteNumber(enrichDetail.bounds.y)
    const width = asFiniteNumber(enrichDetail.bounds.width)
    const height = asFiniteNumber(enrichDetail.bounds.height)
    if (x !== null && y !== null && width !== null && height !== null) {
      normalized.bounds = { x, y, width, height }
    }
  }

  if (Object.keys(normalized).length === 0) {
    return null
  }
  return normalized
}

function ensureBilingualRuleDictionary(dictionary: Record<string, BilingualKeywordSet>): void {
  for (const [category, keywords] of Object.entries(dictionary)) {
    const hasKorean = Array.isArray(keywords.ko) && keywords.ko.length > 0
    const hasEnglish = Array.isArray(keywords.en) && keywords.en.length > 0
    if (!hasKorean || !hasEnglish) {
      throw new Error(
        `invalid enrich rule dictionary: ${category} must include both korean and english keywords`
      )
    }
  }
}

function resolveEnrichTriggerMode(rawMode: string | undefined): EnrichTriggerMode {
  const normalized = rawMode?.trim()
  if (!normalized) {
    // 운영 기본값은 hybrid-complex로 두고, 명시 설정이 있을 때만 override한다.
    return "hybrid-complex"
  }
  if (ENRICH_TRIGGER_MODES.includes(normalized as EnrichTriggerMode)) {
    return normalized as EnrichTriggerMode
  }
  throw new Error(
    `invalid ENRICH_TRIGGER_MODE: ${normalized} (allowed: ${ENRICH_TRIGGER_MODES.join(" | ")})`
  )
}

function containsAnyKeyword(normalizedIntent: string, keywords: BilingualKeywordSet): boolean {
  const merged = [...keywords.ko, ...keywords.en]
  return merged.some((keyword) => normalizedIntent.includes(keyword.toLowerCase()))
}

function analyzeEnrichRuleSignals(intentText: string): EnrichRuleSignals {
  const normalizedIntent = intentText.toLowerCase()
  const hasVisual = containsAnyKeyword(normalizedIntent, ENRICH_RULE_DICTIONARY.visual)
  const hasEntity = containsAnyKeyword(normalizedIntent, ENRICH_RULE_DICTIONARY.entity)
  const hasDetail = containsAnyKeyword(normalizedIntent, ENRICH_RULE_DICTIONARY.detail)
  const hasHardNegative = containsAnyKeyword(normalizedIntent, ENRICH_RULE_DICTIONARY.hardNegative)
  const hasAmbiguousKeyword = containsAnyKeyword(normalizedIntent, ENRICH_RULE_DICTIONARY.ambiguous)

  const hardPositive =
    !hasHardNegative &&
    !hasAmbiguousKeyword &&
    ((hasVisual && hasDetail) || (hasEntity && hasDetail))
  const hardNegative = hasHardNegative
  // 규칙 사전으로 명확히 긍/부정을 못 낸 경우는 ambiguous로 간주해 LLM assist 후보로 넘긴다.
  const ambiguous = hasAmbiguousKeyword || (!hardPositive && !hardNegative)

  return {
    hasVisual,
    hasEntity,
    hasDetail,
    hardPositive,
    hardNegative,
    ambiguous
  }
}

function resolveRequestKindFromSignals(signals: EnrichRuleSignals): EnrichRequestKind {
  if (signals.hasEntity && signals.hasDetail) {
    return "node-detail"
  }
  if (signals.hasEntity) {
    return "node-screenshot"
  }
  return "visible-region"
}

function decideByRule(signals: EnrichRuleSignals): EnrichRuleDecision {
  const requestKind = resolveRequestKindFromSignals(signals)
  if (signals.hardPositive) {
    return {
      shouldRequestEnrich: true,
      requestKind,
      reason: "규칙 사전 하드 긍정 매칭"
    }
  }
  return {
    shouldRequestEnrich: false,
    requestKind,
    reason: signals.hardNegative ? "규칙 사전 하드 부정 매칭" : "규칙 사전 미매칭"
  }
}

function isSnapshotSuspicious(snapshot: SnapshotLike): boolean {
  const focusText = resolveFocusText(snapshot).trim()
  if (focusText.length < 8) {
    return true
  }
  if (/(깨지|흐려|노이즈|누락|신뢰하기 어렵|garbled|blur|unreadable|corrupt|missing)/i.test(focusText)) {
    return true
  }

  const rawSnapshot = snapshot as Record<string, unknown>
  if (!isObject(rawSnapshot.visualSignals)) {
    return false
  }
  const visualSignals = rawSnapshot.visualSignals
  const isUiSuspicious = visualSignals.uiSuspicious === true
  const anomalyScore = asFiniteNumber(visualSignals.anomalyScore)

  if (isUiSuspicious) {
    return true
  }
  return anomalyScore !== null && anomalyScore >= 0.8
}

function buildEnrichTargetRef(
  snapshot: SnapshotLike,
  requestKind: EnrichRequestKind
): Record<string, unknown> {
  const pageUrl = asStringOrNull(snapshot.page?.url) ?? "about:blank"
  const nodeId = asStringOrNull(snapshot.focus?.nodeId)

  if (requestKind === "node-screenshot" && nodeId) {
    return {
      kind: "page-entity",
      pageUrl,
      entityId: nodeId
    }
  }

  if (requestKind === "node-detail" && nodeId) {
    return {
      kind: "semantic-node",
      pageUrl,
      nodeId
    }
  }

  return {
    kind: "region",
    pageUrl,
    region: "focus-node-region"
  }
}

function buildEnrichRequestPayload(
  snapshot: SnapshotLike,
  requestKind: EnrichRequestKind,
  reason: string,
  targetRef?: Record<string, unknown>
): Record<string, unknown> {
  return {
    requestKind,
    targetRef: targetRef ?? buildEnrichTargetRef(snapshot, requestKind),
    reason,
    visibility: "status-only",
    timeoutMs: ENRICH_DEFAULT_TIMEOUT_MS
  }
}

function hasFocusIdMismatch(snapshot: SnapshotLike): boolean {
  const focusNodeId = asStringOrNull(snapshot.focus?.nodeId)
  const focusNodeObjectId = isObject(snapshot.focus?.node)
    ? asStringOrNull(snapshot.focus.node.id)
    : null
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
  const focusNodeRaw = snapshot.focus?.node
  if (!isObject(focusNodeRaw)) {
    return ""
  }
  const focusNode = focusNodeRaw as Record<string, unknown>

  // union node의 텍스트 표현 차이를 흡수해 suspicious 판정/프롬프트 입력을 안정화한다.
  const focusText =
    asStringOrNull(focusNode.text) ??
    asStringOrNull(focusNode.label) ??
    asStringOrNull(focusNode.valuePreview)

  return focusText ?? ""
}

function buildRecallQueryText(intentText: string, snapshot: SnapshotLike, answerText: string): string {
  // recall 질의는 intent + focus text + answer 요약을 합쳐 현재 맥락을 최대한 보존한다.
  return [intentText, resolveFocusText(snapshot), answerText].filter(Boolean).join(" ")
}

function buildGenerationPrompt(
  intentText: string,
  snapshot: SnapshotLike,
  enrichDetail?: Record<string, unknown>
): string {
  const focusText = resolveFocusText(snapshot)
  const normalizedEnrichDetail = normalizeEnrichDetailForPrompt(enrichDetail)
  const enrichText = normalizedEnrichDetail ? JSON.stringify(normalizedEnrichDetail) : null
  // 현재 페이지 근거를 유지하기 위해 intent와 focus 텍스트를 함께 프롬프트에 포함한다.
  const promptLines = [
    "You are a current-page semantic assistant.",
    `User intent: ${intentText}`,
    `Focus text: ${focusText}`,
    "Return a concise answer grounded in the current page context."
  ]

  if (enrichText) {
    // 보안 경계: 자유형 원문 전체 대신 허용 필드 정규화 결과만 프롬프트에 포함한다.
    promptLines.splice(promptLines.length - 1, 0, `Enriched detail: ${enrichText}`)
  }

  return promptLines.join("\n")
}

function buildEnrichAssistPrompt(
  intentText: string,
  snapshot: SnapshotLike,
  signals: EnrichRuleSignals,
  suspicious: boolean,
  mode: EnrichTriggerMode
): string {
  const snapshotSummary = JSON.stringify({
    pageUrl: snapshot.page?.url ?? null,
    focusNodeId: snapshot.focus?.nodeId ?? null,
    focusText: resolveFocusText(snapshot),
    suspicious
  })

  // 모델 응답 파싱 안정성을 위해 assist 프롬프트는 JSON 단일 객체만 요구한다.
  return [
    "ENRICH_TRIGGER_ASSIST",
    `Mode: ${mode}`,
    `Intent: ${intentText}`,
    `Rule signals: ${JSON.stringify(signals)}`,
    `Snapshot summary: ${snapshotSummary}`,
    'Decide if FE enrichment is needed for current-page reasoning. Respond ONLY valid JSON with schema: {"decision":"enrich|no-enrich","requestKind":"node-screenshot|visible-region|node-detail","reason":"string"}'
  ].join("\n")
}

function extractJsonObject(rawText: string): string | null {
  const normalized = rawText.trim()
  if (normalized.startsWith("{") && normalized.endsWith("}")) {
    return normalized
  }
  const match = normalized.match(/\{[\s\S]*\}/)
  return match ? match[0] : null
}

function parseEnrichAssistDecision(rawText: string): EnrichAssistDecision | null {
  const jsonText = extractJsonObject(rawText)
  if (!jsonText) {
    return null
  }

  try {
    const parsed = JSON.parse(jsonText) as unknown
    if (!isObject(parsed)) {
      return null
    }

    const decision = asString(parsed.decision)
    const requestKind = asString(parsed.requestKind)
    const reason = asString(parsed.reason) ?? "llm assist decision"
    if (!decision || !requestKind) {
      return null
    }
    if (!["enrich", "no-enrich"].includes(decision)) {
      return null
    }
    if (!ENRICH_REQUEST_KINDS.includes(requestKind as EnrichRequestKind)) {
      return null
    }
    return {
      decision: decision as EnrichAssistDecision["decision"],
      requestKind: requestKind as EnrichRequestKind,
      reason
    }
  } catch {
    return null
  }
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
  private readonly enrichTriggerMode: EnrichTriggerMode

  constructor(options?: RuntimeManagerOptions) {
    // 부팅 시점에 trigger mode를 고정해 런타임 중 모호한 기본값 전환을 막는다.
    this.enrichTriggerMode = resolveEnrichTriggerMode(
      options?.enrichTriggerMode ?? process.env.ENRICH_TRIGGER_MODE
    )
  }

  async handle(raw: unknown, context: RuntimeHandleContext): Promise<RuntimeResult> {
    const envelope = validateEnvelope(raw)
    if (!envelope) {
      logger.warn("runtime-invalid-envelope", {
        principalUserId: context.principalUserId
      })
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
    if (envelope.type === "context.enrich.result") {
      return this.handleContextEnrichResult(envelope, session)
    }
    if (envelope.type === "interrupt") {
      session.activeTurnId = null
      delete session.activeTurn
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
      logger.warn("runtime-session-open-owner-mismatch", {
        principalUserId,
        clientSessionId: parsed.clientSessionId
      })
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

    logger.info("runtime-session-opened", {
      principalUserId,
      sessionId,
      clientSessionId: parsed.clientSessionId,
      reused: Boolean(existing)
    })

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
    logger.debug("runtime-context-updated", {
      userId: session.ownerUserId,
      sessionId: session.sessionId,
      primaryTabId: session.primaryTabId,
      requestId: envelope.requestId
    })

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
    logger.debug("runtime-snapshot-pushed", {
      userId: session.ownerUserId,
      sessionId: session.sessionId,
      tabId: parsed.tabId,
      focusNodeId: parsed.snapshot.focus?.nodeId ?? null,
      capturedAt: parsed.snapshot.meta?.capturedAt ?? null
    })

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
      delete session.activeTurn
    }

    const turnId = this.newTurnId()
    session.activeTurnId = turnId
    session.activeTurn = {
      turnId,
      intentText: parsed.text,
      primaryTabId: parsed.primaryTabId,
      boundSnapshotCapturedAt: parsed.boundSnapshotCapturedAt,
      status: "running",
      enrichApplied: false,
      enrichRequestedAtMs: 0,
      enrichTimeoutAtMs: 0,
      latestSnapshot: latest
    }
    logger.info("runtime-turn-started", {
      userId: session.ownerUserId,
      sessionId: session.sessionId,
      turnId,
      primaryTabId: parsed.primaryTabId,
      intentLength: parsed.text.length,
      enrichTriggerMode: this.enrichTriggerMode
    })

    const enrichDecision = await this.decideEnrichTrigger(parsed.text, latest)

    const activeTurn = session.activeTurn
    if (!activeTurn || session.activeTurnId !== turnId || activeTurn.turnId !== turnId) {
      return invalidEvent("active turn mismatch after enrich decision")
    }

    if (!enrichDecision.ok) {
      this.clearActiveTurn(session)
      return enrichDecision.error
    }

    if (enrichDecision.decision.shouldRequestEnrich) {
      activeTurn.pendingEnrichRequest = {
        requestKind: enrichDecision.decision.requestKind,
        targetRef: buildEnrichTargetRef(latest, enrichDecision.decision.requestKind)
      }

      const nowMs = Date.now()
      activeTurn.status = "waiting-enrich"
      activeTurn.enrichRequestedAtMs = nowMs
      activeTurn.enrichTimeoutAtMs = nowMs + ENRICH_DEFAULT_TIMEOUT_MS
      logger.info("runtime-enrich-requested", {
        userId: session.ownerUserId,
        sessionId: session.sessionId,
        turnId,
        requestKind: enrichDecision.decision.requestKind,
        reason: enrichDecision.decision.reason
      })

      const events: Array<Record<string, unknown>> = [
        this.makeProgressEvent(session.sessionId, turnId, "intent-routed"),
        this.makeProgressEvent(session.sessionId, turnId, "enrich-requested"),
        {
          type: "context.enrich.request",
          turnId,
          sessionId: session.sessionId,
          timestamp: makeTimestamp(),
          payload: buildEnrichRequestPayload(
            latest,
            enrichDecision.decision.requestKind,
            enrichDecision.decision.reason,
            activeTurn.pendingEnrichRequest.targetRef
          )
        }
      ]

      return this.toEventBatch(envelope.requestId, session.sessionId, turnId, events)
    }

    return this.finalizeTurn(
      session,
      turnId,
      envelope.requestId,
      parsed.text,
      parsed.primaryTabId,
      latest,
      undefined,
      ["intent-routed"],
      ["current-page"]
    )
  }

  private async handleContextEnrichResult(
    envelope: RuntimeEnvelope,
    session: RuntimeSession
  ): Promise<RuntimeResult> {
    const parsed = parseContextEnrichResultPayload(envelope.payload)
    if (!parsed) {
      return invalidEvent("invalid context.enrich.result payload")
    }
    if (isCrossTabTargetRef(parsed.targetRef)) {
      return invalidEvent("cross-tab enrich result is not allowed in current-page scope")
    }

    const turnId = asString(envelope.turnId)
    if (!turnId) {
      return invalidEvent("turnId is required for context.enrich.result")
    }

    const activeTurn = session.activeTurn
    if (!activeTurn || session.activeTurnId !== turnId || activeTurn.turnId !== turnId) {
      return invalidEvent("active turn mismatch for context.enrich.result")
    }

    if (activeTurn.enrichApplied) {
      return invalidEvent("enrich already applied for this turn")
    }

    if (activeTurn.status !== "waiting-enrich") {
      return invalidEvent("turn is not waiting-enrich")
    }

    const pendingRequest = activeTurn.pendingEnrichRequest
    if (!pendingRequest) {
      return invalidEvent("pending enrich request is missing")
    }
    if (pendingRequest.requestKind !== parsed.requestKind) {
      return invalidEvent("requestKind mismatch for context.enrich.result")
    }
    // current-page 격리 경계: pending targetRef와 완전 일치하는 결과만 수용한다.
    if (!isExactTargetRefMatch(pendingRequest.targetRef, parsed.targetRef)) {
      return invalidEvent("targetRef mismatch for context.enrich.result")
    }

    const nowMs = Date.now()
    const isTimeout = nowMs >= activeTurn.enrichTimeoutAtMs

    // 상태 전이 경계: enrich 결과를 한 번 수용한 뒤에는 반드시 resumed로 전환하고 종료 경로로 보낸다.
    activeTurn.status = "resumed"
    activeTurn.enrichApplied = true
    delete activeTurn.pendingEnrichRequest
    logger.info("runtime-enrich-result-received", {
      userId: session.ownerUserId,
      sessionId: session.sessionId,
      turnId,
      status: parsed.status,
      requestKind: parsed.requestKind,
      timedOut: isTimeout
    })

    if (isTimeout) {
      return this.finalizeTurn(
        session,
        turnId,
        envelope.requestId,
        activeTurn.intentText,
        activeTurn.primaryTabId,
        activeTurn.latestSnapshot,
        undefined,
        ["enrich-received"],
        ["current-page"]
      )
    }

    if (parsed.status === "ok") {
      return this.finalizeTurn(
        session,
        turnId,
        envelope.requestId,
        activeTurn.intentText,
        activeTurn.primaryTabId,
        activeTurn.latestSnapshot,
        parsed.detail,
        ["enrich-received"],
        ["current-page", "enrich"]
      )
    }

    // fallback 경계: failed/unsupported는 enrich 병합 없이 current-page answer로 안전하게 후퇴한다.
    return this.finalizeTurn(
      session,
      turnId,
      envelope.requestId,
      activeTurn.intentText,
      activeTurn.primaryTabId,
      activeTurn.latestSnapshot,
      undefined,
      ["enrich-received"],
      ["current-page"]
    )
  }

  private async decideEnrichTrigger(
    intentText: string,
    snapshot: SnapshotLike
  ): Promise<{ ok: true; decision: EnrichRuleDecision } | { ok: false; error: RuntimeResult }> {
    const ruleSignals = analyzeEnrichRuleSignals(intentText)
    const ruleDecision = decideByRule(ruleSignals)
    const suspicious = isSnapshotSuspicious(snapshot)

    if (this.enrichTriggerMode === "rule") {
      logger.debug("runtime-enrich-rule-decision", {
        mode: this.enrichTriggerMode,
        shouldRequestEnrich: ruleDecision.shouldRequestEnrich,
        requestKind: ruleDecision.requestKind,
        reason: ruleDecision.reason
      })
      return {
        ok: true,
        decision: ruleDecision
      }
    }

    if (this.enrichTriggerMode === "hybrid-simple") {
      if (ruleSignals.hardPositive || ruleSignals.hardNegative) {
        logger.debug("runtime-enrich-hybrid-simple-rule-shortcut", {
          mode: this.enrichTriggerMode,
          shouldRequestEnrich: ruleDecision.shouldRequestEnrich,
          requestKind: ruleDecision.requestKind,
          reason: ruleDecision.reason
        })
        return {
          ok: true,
          decision: ruleDecision
        }
      }
      // hybrid-simple은 rule miss 시점에 즉시 LLM assist를 호출한다.
      return this.decideEnrichWithLlmAssist(intentText, snapshot, ruleSignals, suspicious)
    }

    if (ruleSignals.hardPositive) {
      logger.debug("runtime-enrich-hybrid-complex-rule-positive", {
        mode: this.enrichTriggerMode,
        requestKind: ruleDecision.requestKind
      })
      return {
        ok: true,
        decision: ruleDecision
      }
    }
    if (ruleSignals.hardNegative && !suspicious) {
      logger.debug("runtime-enrich-hybrid-complex-rule-negative", {
        mode: this.enrichTriggerMode
      })
      return {
        ok: true,
        decision: ruleDecision
      }
    }
    if (ruleSignals.ambiguous || suspicious) {
      logger.debug("runtime-enrich-hybrid-complex-llm-assist", {
        mode: this.enrichTriggerMode,
        suspicious
      })
      return this.decideEnrichWithLlmAssist(intentText, snapshot, ruleSignals, suspicious)
    }
    logger.debug("runtime-enrich-hybrid-complex-fallback-rule", {
      mode: this.enrichTriggerMode,
      shouldRequestEnrich: ruleDecision.shouldRequestEnrich
    })
    return {
      ok: true,
      decision: ruleDecision
    }
  }

  private async decideEnrichWithLlmAssist(
    intentText: string,
    snapshot: SnapshotLike,
    ruleSignals: EnrichRuleSignals,
    suspicious: boolean
  ): Promise<{ ok: true; decision: EnrichRuleDecision } | { ok: false; error: RuntimeResult }> {
    const assistPrompt = buildEnrichAssistPrompt(
      intentText,
      snapshot,
      ruleSignals,
      suspicious,
      this.enrichTriggerMode
    )
    const assistResult = await this.generateTextWithGemini(assistPrompt, "llm assist failed")
    if (!assistResult.ok) {
      return assistResult
    }

    const parsedAssist = parseEnrichAssistDecision(assistResult.text)
    if (!parsedAssist) {
      logger.warn("runtime-enrich-llm-assist-unparseable")
      return {
        ok: true,
        decision: {
          // 보수적 처리: 비정형 응답은 강제 enrich로 승격하지 않고 no-enrich로 후퇴한다.
          shouldRequestEnrich: false,
          requestKind: resolveRequestKindFromSignals(ruleSignals),
          reason: "LLM assist 비정형 응답 보수 처리"
        }
      }
    }

    return {
      ok: true,
      decision: {
        shouldRequestEnrich: parsedAssist.decision === "enrich",
        requestKind: parsedAssist.requestKind,
        reason: `LLM assist: ${parsedAssist.reason}`
      }
    }
  }

  private async generateTextWithGemini(
    prompt: string,
    fallbackErrorMessage: string
  ): Promise<{ ok: true; text: string } | { ok: false; error: RuntimeResult }> {
    if (!process.env.GOOGLE_CLOUD_PROJECT || !process.env.GOOGLE_CLOUD_LOCATION) {
      logger.warn("runtime-generation-config-missing")
      return {
        ok: false,
        error: modelConfigMissing("GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION are required")
      }
    }

    const geminiModule = await import("../../services/gemini")

    try {
      const geminiClient = geminiModule.createGeminiClient()
      const text = await geminiClient.generateText(prompt)
      return {
        ok: true,
        text
      }
    } catch (error) {
      if (geminiModule.isModelConfigError(error)) {
        const message =
          error instanceof Error ? error.message : "model configuration is missing"
        return {
          ok: false,
          error: modelConfigMissing(message)
        }
      }
      logger.error("runtime-generation-failed", {
        fallbackErrorMessage,
        error
      })

      return {
        ok: false,
        error: generationFailed(fallbackErrorMessage)
      }
    }
  }

  private makeProgressEvent(
    sessionId: string,
    turnId: string,
    stage:
      | "intent-routed"
      | "retrieval-started"
      | "retrieval-completed"
      | "enrich-requested"
      | "enrich-received"
      | "response-planning"
  ): Record<string, unknown> {
    return {
      type: "progress",
      turnId,
      sessionId,
      timestamp: makeTimestamp(),
      payload: {
        stage
      }
    }
  }

  private toEventBatch(
    requestId: string | undefined,
    sessionId: string,
    turnId: string,
    events: Array<Record<string, unknown>>
  ): RuntimeResult {
    return {
      status: 200,
      body: {
        type: "event.batch",
        requestId,
        sessionId,
        turnId,
        timestamp: makeTimestamp(),
        events
      }
    }
  }

  private clearActiveTurn(session: RuntimeSession): void {
    session.activeTurnId = null
    delete session.activeTurn
  }

  private async generateCurrentPageAnswer(
    intentText: string,
    snapshot: SnapshotLike,
    enrichDetail?: Record<string, unknown>
  ): Promise<{ ok: true; answerText: string } | { ok: false; error: RuntimeResult }> {
    const generation = await this.generateTextWithGemini(
      buildGenerationPrompt(intentText, snapshot, enrichDetail),
      "generation failed"
    )
    if (!generation.ok) {
      return generation
    }
    return {
      ok: true,
      answerText: generation.text
    }
  }

  private async finalizeTurn(
    session: RuntimeSession,
    turnId: string,
    requestId: string | undefined,
    intentText: string,
    primaryTabId: number,
    snapshot: SnapshotLike,
    enrichDetail: Record<string, unknown> | undefined,
    progressStages: Array<"intent-routed" | "enrich-received">,
    provenanceSummary: string[]
  ): Promise<RuntimeResult> {
    const generation = await this.generateCurrentPageAnswer(intentText, snapshot, enrichDetail)
    if (!generation.ok) {
      logger.warn("runtime-turn-generation-rejected", {
        userId: session.ownerUserId,
        sessionId: session.sessionId,
        turnId
      })
      this.clearActiveTurn(session)
      return generation.error
    }
    if (session.activeTurnId !== turnId) {
      return interruptedTurnBatch(requestId, session, turnId)
    }

    const events: Array<Record<string, unknown>> = []
    for (const stage of progressStages) {
      events.push(this.makeProgressEvent(session.sessionId, turnId, stage))
    }
    events.push(this.makeProgressEvent(session.sessionId, turnId, "response-planning"))

    events.push({
      type: "projection",
      turnId,
      sessionId: session.sessionId,
      timestamp: makeTimestamp(),
      payload: {
        kind: "present",
        body: {
          type: "answer",
          text: generation.answerText,
          responseMode: "answer",
          provenanceSummary
        }
      }
    })

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
        queryText: buildRecallQueryText(intentText, snapshot, generation.answerText),
        limit: 2
      }
      if (snapshot.page?.kind) {
        retrievalInput.pageKind = snapshot.page.kind
      }
      const sourceDomain = extractSourceDomain(snapshot.page?.url)
      if (sourceDomain) {
        retrievalInput.sourceDomain = sourceDomain
      }

      const recallCandidates = await retrieveMemoryCandidates(retrievalInput)
      if (session.activeTurnId !== turnId) {
        return interruptedTurnBatch(requestId, session, turnId)
      }
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
        logger.info("runtime-recall-attached", {
          userId: session.ownerUserId,
          sessionId: session.sessionId,
          turnId,
          recordId: selectedRecall.recordId,
          similarityScore: selectedRecall.similarityScore
        })
      }
    } catch (error) {
      // retrieval 오류는 전체 턴 실패로 전파하지 않고 answer 우선 정책을 유지한다.
      logger.warn("runtime-recall-skipped-after-error", {
        userId: session.ownerUserId,
        sessionId: session.sessionId,
        turnId,
        error
      })
    }

    const turnDonePayload: Record<string, unknown> = {
      referencedTabIds: [primaryTabId]
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

    this.clearActiveTurn(session)
    logger.info("runtime-turn-completed", {
      userId: session.ownerUserId,
      sessionId: session.sessionId,
      turnId,
      usedMemoryRecordCount: usedMemoryRecordIds.length,
      provenanceSummary
    })
    return this.toEventBatch(requestId, session.sessionId, turnId, events)
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
