import {
  buildContextPack,
  DEFAULT_API_BASE_URL,
  type Intent,
  type Projection,
  type SemanticNode,
  type SemanticSnapshot
} from "@threadatlas/shared"
import {
  renderCompactJson,
  renderContextPack,
  renderLinearText,
  type ContextProjectionFormat,
  type ContextTaskProfile
} from "@threadatlas/shared/projection-policy"
import type {
  AnyRuntimeMessage,
  ContextEnrichResultPayload,
  RuntimeErrorPayload,
  ServerEnvelope,
  SemanticSelectionTarget,
} from "@threadatlas/shared/runtime"
import type { RegionDump } from "../content/semantic/core/observability"
import { isSemanticCaptureSupportedUrl } from "../common/semantic-url"
import { routeProjection } from "./projection-router"
import { ContentGraphManager } from "./content-graph"
import { connectGeminiLive, type LiveSession } from "./gemini-live"
import { initializeAudio } from "./audio"
import { createAuthClient } from "./auth-client"
import { SessionWsTransport } from "./session-ws-transport"
import { TokenManager } from "./token-manager"
import {
  bindSemanticSnapshotActions,
  renderPresent,
  renderSemanticSnapshot,
  selectSnapshotById,
  setSemanticSnapshotBusy,
  showNotify,
  showSuggestChips,
  updatePhaseIndicator,
  type DisabledContextProfileReason,
  type SemanticDebugInfo,
  type Phase
} from "./ui"

interface SemanticSnapshotState {
  tabId: number | null
  snapshot: SemanticSnapshot | null
  error: string | null
}

interface SemanticSnapshotHistoryState {
  tabId: number | null
  snapshots: SemanticSnapshot[]
}

interface SemanticSelectionState {
  tabId: number | null
  enabled: boolean
  selectedTarget: SemanticSelectionTarget | null
}

interface SemanticRegionDumpState {
  tabId: number | null
  dump: RegionDump | null
  error: string | null
}

interface SidePanelState {
  phase: Phase
  geminiLiveSession: LiveSession | null
  sessionTransport: SessionWsTransport | null
  contentGraph: ContentGraphManager
  activeTabId: number | null
  latestSemanticSnapshot: SemanticSnapshotState | null
  latestRegionDump: SemanticRegionDumpState | null
  semanticSnapshotHistory: SemanticSnapshot[]
  selectedSemanticSnapshotId: string | null
  semanticRawVisible: boolean
  selectionEnabled: boolean
  selectedTarget: SemanticSelectionTarget | null
  sessionId: string | null
  clientSessionId: string | null
  activeTurnId: string | null
  pendingEnrichRequest: Extract<ServerEnvelope, { type: "context.enrich.request" }> | null
  lastRuntimeError: RuntimeErrorPayload | null
  runtimeSnapshot: SemanticSnapshot | null
  semanticContextProfile: ContextTaskProfile
  semanticContextFormat: ContextProjectionFormat
}

const API_BASE_URL = window.localStorage.getItem("THREADATLAS_API_BASE_URL") ?? DEFAULT_API_BASE_URL
const authClient = createAuthClient({ apiBaseUrl: API_BASE_URL })

const state: SidePanelState = {
  phase: "initializing",
  geminiLiveSession: null,
  sessionTransport: null,
  contentGraph: new ContentGraphManager(),
  activeTabId: null,
  latestSemanticSnapshot: null,
  latestRegionDump: null,
  semanticSnapshotHistory: [],
  selectedSemanticSnapshotId: null,
  semanticRawVisible: false,
  selectionEnabled: false,
  selectedTarget: null,
  sessionId: null,
  clientSessionId: null,
  activeTurnId: null,
  pendingEnrichRequest: null,
  lastRuntimeError: null,
  runtimeSnapshot: null,
  semanticContextProfile: "branch-summary",
  semanticContextFormat: "context-pack-json"
}

type RegionDumpEntry = RegionDump["regions"][number]
type RuntimeEnrichRequestEvent = Extract<ServerEnvelope, { type: "context.enrich.request" }>
const INTERACTIVE_CONTEXT_RESTRICTION = "Interactive semantic snapshots currently support only the branch-summary profile."

function setPhase(phase: Phase): void {
  state.phase = phase
  updatePhaseIndicator(phase)
}

function hasActiveRuntimeTurn(): boolean {
  return (
    state.activeTurnId !== null ||
    state.pendingEnrichRequest !== null ||
    state.phase === "opening-session" ||
    state.phase === "sending-intent" ||
    state.phase === "waiting-enrich" ||
    state.phase === "resuming-turn"
  )
}

function setPhaseForUrl(url: string): void {
  if (hasActiveRuntimeTurn()) {
    return
  }
  setPhase(isSemanticCaptureSupportedUrl(url) ? "ready" : "dormant")
}

async function sendRuntimeMessage<TResponse>(message: AnyRuntimeMessage): Promise<TResponse> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
      reject(new Error("chrome.runtime.sendMessage unavailable"))
      return
    }

    chrome.runtime.sendMessage(message, (response: TResponse) => {
      const runtimeError = chrome.runtime.lastError
      if (runtimeError) {
        reject(new Error(runtimeError.message))
        return
      }
      resolve(response)
    })
  })
}

async function sendToContentScript<TResponse>(tabId: number, message: unknown): Promise<TResponse> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === "undefined" || !chrome.tabs?.sendMessage) {
      reject(new Error("chrome.tabs.sendMessage unavailable"))
      return
    }

    chrome.tabs.sendMessage(tabId, message, (response: TResponse) => {
      const runtimeError = chrome.runtime.lastError
      if (runtimeError) {
        reject(new Error(runtimeError.message))
        return
      }
      resolve(response)
    })
  })
}

async function requestViewportCapture(): Promise<string | null> {
  try {
    const response = await sendRuntimeMessage<{ viewport: string | null }>({ type: "CAPTURE_VIEWPORT" })
    return response.viewport
  } catch {
    return null
  }
}

function handleVoiceUnavailable(error: unknown): void {
  const message = error instanceof Error ? error.message : "Voice features unavailable."
  state.geminiLiveSession = null
  showNotify(`${message} Semantic snapshots still work.`, "info")
}

function getSelectedSemanticSnapshot(): SemanticSnapshot | null {
  return selectSnapshotById(
    state.semanticSnapshotHistory,
    state.selectedSemanticSnapshotId,
    state.latestSemanticSnapshot?.snapshot ?? null
  )
}

function getDisabledContextRestrictions(snapshot: SemanticSnapshot | null): DisabledContextProfileReason[] {
  if (!snapshot || "text" in snapshot.focus.node) {
    return []
  }

  return [
    {
      profile: "reply-assist",
      reason: INTERACTIVE_CONTEXT_RESTRICTION
    },
    {
      profile: "claim-extraction",
      reason: INTERACTIVE_CONTEXT_RESTRICTION
    }
  ]
}

function findRegionDumpEntry(dump: RegionDump | null, regionId: string | null | undefined): RegionDumpEntry | null {
  if (!dump || !regionId) {
    return null
  }

  return dump.regions.find((region) => region.id === regionId) ?? null
}

function isProfileRestricted(
  restrictions: DisabledContextProfileReason[],
  profile: ContextTaskProfile
): boolean {
  return restrictions.some((restriction) => restriction.profile === profile)
}

function getRestrictionReason(
  restrictions: DisabledContextProfileReason[],
  profile: ContextTaskProfile
): string | null {
  return restrictions.find((restriction) => restriction.profile === profile)?.reason ?? null
}

function describeSuppression(region: RegionDumpEntry): string {
  if (!region.autoSuppressed) {
    return "active"
  }

  return region.explicitSelectionAllowed ? "suppressed (explicit selection allowed)" : "suppressed"
}

function buildSelectionResolutionNote(
  snapshot: SemanticSnapshot | null,
  selectedTarget: SemanticSelectionTarget | null,
  dumpState: SemanticRegionDumpState | null
): string | null {
  if (!snapshot || !selectedTarget || !dumpState?.dump) {
    return null
  }

  const selectedRegion = findRegionDumpEntry(dumpState.dump, selectedTarget.regionId)
  if (selectedTarget.regionId !== snapshot.focus.region) {
    if (selectedRegion?.autoSuppressed) {
      return `Selected region ${selectedTarget.regionId} is suppressed, so focus fell back to ${snapshot.focus.region}.`
    }

    return `Selected region ${selectedTarget.regionId} is no longer focusable, so focus resolved to ${snapshot.focus.region}.`
  }

  if (selectedRegion?.autoSuppressed) {
    return "Explicit selection kept a suppressed region because direct selection is allowed."
  }

  return null
}

function buildDebugState(
  snapshot: SemanticSnapshot | null,
  selectedTarget: SemanticSelectionTarget | null,
  dumpState: SemanticRegionDumpState | null
): { status: string; info: SemanticDebugInfo | null } {
  if (!snapshot) {
    return {
      status: dumpState?.error ?? "No semantic snapshot selected.",
      info: null
    }
  }

  if (!dumpState?.dump) {
    return {
      status: dumpState?.error ?? "No region dump loaded.",
      info: null
    }
  }

  const focusRegion = findRegionDumpEntry(dumpState.dump, snapshot.focus.region)
  if (!focusRegion) {
    return {
      status: "Focused region is not present in the current tab dump.",
      info: null
    }
  }

  const notes: string[] = []
  if (snapshot.page.url !== dumpState.dump.url) {
    notes.push("Selected snapshot URL does not match the current tab dump.")
  }

  const selectionNote = buildSelectionResolutionNote(snapshot, selectedTarget, dumpState)
  if (selectionNote) {
    notes.push(selectionNote)
  }

  return {
    status: `Current region dump · ${dumpState.dump.url}`,
    info: {
      regionId: focusRegion.id,
      primitive: focusRegion.primitive,
      subtype: focusRegion.subtype ?? "(none)",
      category: focusRegion.category,
      layoutRole: focusRegion.layoutRole,
      roleRank: focusRegion.roleRank,
      suppression: describeSuppression(focusRegion),
      normalizedKind: focusRegion.normalizedKind ?? "(none)",
      assembledItemCount: String(focusRegion.assembledItemCount),
      signals: focusRegion.signals.join(", ") || "(none)",
      ...(notes.length > 0 ? { note: notes.join(" ") } : {})
    }
  }
}

function renderSemanticSnapshotState(errorOverride?: string | null): void {
  const snapshot = getSelectedSemanticSnapshot()
  let contextPreview = "No semantic snapshot selected."
  let contextAvailable = false
  let contextStatus = "No semantic snapshot selected."
  const contextRestrictions = getDisabledContextRestrictions(snapshot)
  const interactiveRestricted =
    snapshot !== null &&
    isProfileRestricted(contextRestrictions, state.semanticContextProfile) &&
    !("text" in snapshot.focus.node)
  const selectionResolutionNote = buildSelectionResolutionNote(snapshot, state.selectedTarget, state.latestRegionDump)
  const debugState = buildDebugState(snapshot, state.selectedTarget, state.latestRegionDump)

  if (snapshot) {
    const pack = buildContextPack(snapshot)
    if (interactiveRestricted) {
      contextStatus = "Interactive snapshots support branch-summary only."
      contextPreview = getRestrictionReason(contextRestrictions, state.semanticContextProfile) ?? INTERACTIVE_CONTEXT_RESTRICTION
    } else {
      contextAvailable = true
      contextStatus = `${state.semanticContextProfile} · ${state.semanticContextFormat}`
      contextPreview =
        state.semanticContextFormat === "context-pack-json"
          ? renderContextPack(pack)
          : state.semanticContextFormat === "compact-json"
            ? renderCompactJson(pack, state.semanticContextProfile)
            : renderLinearText(pack, state.semanticContextProfile)
    }
  }

  renderSemanticSnapshot({
    snapshot,
    error: errorOverride ?? state.latestSemanticSnapshot?.error ?? null,
    history: state.semanticSnapshotHistory,
    selectedSnapshotId: state.selectedSemanticSnapshotId,
    rawVisible: state.semanticRawVisible,
    selectionEnabled: state.selectionEnabled,
    selectedTarget: state.selectedTarget,
    contextProfile: state.semanticContextProfile,
    contextFormat: state.semanticContextFormat,
    contextPreview,
    contextAvailable,
    contextStatus,
    contextRestrictions,
    selectionResolutionNote,
    debugStatus: debugState.status,
    debugInfo: debugState.info
  })
}

function updateSemanticSnapshot(payload: SemanticSnapshotState): void {
  state.latestSemanticSnapshot = payload
  if (payload.snapshot) {
    state.selectedSemanticSnapshotId = payload.snapshot.meta.capturedAt
  }
  renderSemanticSnapshotState()
}

function updateSemanticRegionDump(payload: SemanticRegionDumpState): void {
  state.latestRegionDump = payload
  renderSemanticSnapshotState()
}

function updateSemanticSnapshotHistory(payload: SemanticSnapshotHistoryState): void {
  state.semanticSnapshotHistory = payload.snapshots
  if (!state.selectedSemanticSnapshotId && payload.snapshots[0]) {
    state.selectedSemanticSnapshotId = payload.snapshots[0].meta.capturedAt
  }
  renderSemanticSnapshotState()
}

function updateSelectionState(payload: SemanticSelectionState): void {
  state.selectionEnabled = payload.enabled
  state.selectedTarget = payload.selectedTarget
  renderSemanticSnapshotState()
}

async function hydrateSemanticSnapshot(tabId?: number): Promise<void> {
  try {
    const payload = await sendRuntimeMessage<SemanticSnapshotState>(
      typeof tabId === "number"
        ? {
            type: "GET_LATEST_SEMANTIC_SNAPSHOT",
            payload: { tabId }
          }
        : {
            type: "GET_LATEST_SEMANTIC_SNAPSHOT"
          }
    )
    updateSemanticSnapshot(payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to load semantic snapshot"
    renderSemanticSnapshotState(message)
  }
}

async function hydrateSemanticSnapshotHistory(tabId?: number): Promise<void> {
  try {
    const payload = await sendRuntimeMessage<SemanticSnapshotHistoryState>(
      typeof tabId === "number"
        ? {
            type: "GET_SEMANTIC_SNAPSHOT_HISTORY",
            payload: { tabId }
          }
        : {
            type: "GET_SEMANTIC_SNAPSHOT_HISTORY"
          }
    )
    updateSemanticSnapshotHistory(payload)
  } catch {
    updateSemanticSnapshotHistory({ tabId: tabId ?? null, snapshots: [] })
  }
}

async function hydrateSelectionState(tabId?: number): Promise<void> {
  try {
    const payload = await sendRuntimeMessage<SemanticSelectionState>(
      typeof tabId === "number"
        ? {
            type: "GET_SEMANTIC_SELECTION_STATE",
            payload: { tabId }
          }
        : {
            type: "GET_SEMANTIC_SELECTION_STATE"
          }
    )
    updateSelectionState(payload)
  } catch {
    updateSelectionState({ tabId: tabId ?? null, enabled: false, selectedTarget: null })
  }
}

async function hydrateSemanticRegionDump(tabId?: number): Promise<void> {
  try {
    const payload = await sendRuntimeMessage<SemanticRegionDumpState>(
      typeof tabId === "number"
        ? {
            type: "GET_SEMANTIC_REGION_DUMP",
            payload: { tabId }
          }
        : {
            type: "GET_SEMANTIC_REGION_DUMP"
          }
    )
    updateSemanticRegionDump(payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to load semantic region dump"
    updateSemanticRegionDump({ tabId: tabId ?? null, dump: null, error: message })
  }
}

async function requestSemanticSnapshot(options: {
  suppressErrors?: boolean
  source?: "command" | "context-menu" | "popup" | "sidepanel"
} = {}): Promise<void> {
  const { suppressErrors = false, source = "sidepanel" } = options
  setSemanticSnapshotBusy(true)

  try {
    const payload = await sendRuntimeMessage<SemanticSnapshotState>(
      typeof state.activeTabId === "number"
        ? {
            type: "REQUEST_SEMANTIC_SNAPSHOT",
            payload: { tabId: state.activeTabId, source }
          }
        : {
            type: "REQUEST_SEMANTIC_SNAPSHOT",
            payload: { source }
          }
    )
    updateSemanticSnapshot(payload)
    if (payload.error && !suppressErrors) {
      showNotify(payload.error, "error")
    }
    await hydrateSemanticSnapshotHistory(state.activeTabId ?? undefined)
    await hydrateSemanticRegionDump(state.activeTabId ?? undefined)
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to capture semantic snapshot"
    renderSemanticSnapshotState(message)
    if (!suppressErrors) {
      showNotify(message, "error")
    }
  } finally {
    setSemanticSnapshotBusy(false)
  }
}

async function copySemanticSnapshot(): Promise<void> {
  const snapshot = getSelectedSemanticSnapshot()
  if (!snapshot) {
    showNotify("No semantic snapshot to copy.", "error")
    return
  }

  await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2))
  showNotify("Semantic snapshot copied.", "success")
}

async function copySemanticContext(): Promise<void> {
  const snapshot = getSelectedSemanticSnapshot()
  if (!snapshot) {
    showNotify("No semantic snapshot to derive LLM context from.", "error")
    return
  }

  const restrictions = getDisabledContextRestrictions(snapshot)
  if (isProfileRestricted(restrictions, state.semanticContextProfile)) {
    showNotify(getRestrictionReason(restrictions, state.semanticContextProfile) ?? INTERACTIVE_CONTEXT_RESTRICTION, "info")
    return
  }

  const pack = buildContextPack(snapshot)
  const output =
    state.semanticContextFormat === "context-pack-json"
      ? renderContextPack(pack)
      : state.semanticContextFormat === "compact-json"
        ? renderCompactJson(pack, state.semanticContextProfile)
        : renderLinearText(pack, state.semanticContextProfile)

  await navigator.clipboard.writeText(output)
  showNotify("LLM context copied.", "success")
}

async function toggleSemanticSelection(): Promise<void> {
  const payload = await sendRuntimeMessage<SemanticSelectionState>(
    typeof state.activeTabId === "number"
      ? {
          type: "TOGGLE_SEMANTIC_SELECTION",
          payload: { tabId: state.activeTabId }
        }
      : {
          type: "TOGGLE_SEMANTIC_SELECTION"
        }
  )
  updateSelectionState(payload)
  showNotify(payload.enabled ? "Selection mode enabled." : "Selection mode disabled.", "info")
}

async function clearSemanticSelection(): Promise<void> {
  const payload = await sendRuntimeMessage<SemanticSelectionState>(
    typeof state.activeTabId === "number"
      ? {
          type: "CLEAR_SEMANTIC_SELECTION",
          payload: { tabId: state.activeTabId }
        }
      : {
          type: "CLEAR_SEMANTIC_SELECTION"
        }
  )
  updateSelectionState(payload)
  showNotify("Semantic selection cleared.", "info")
}

function toggleSemanticRawView(): void {
  state.semanticRawVisible = !state.semanticRawVisible
  renderSemanticSnapshotState()
}

function selectSemanticSnapshot(snapshotId: string): void {
  state.selectedSemanticSnapshotId = snapshotId
  renderSemanticSnapshotState()
  void hydrateSemanticRegionDump(state.activeTabId ?? undefined)
}

function selectSemanticContextProfile(profile: ContextTaskProfile): void {
  const snapshot = getSelectedSemanticSnapshot()
  const restrictions = getDisabledContextRestrictions(snapshot)
  if (isProfileRestricted(restrictions, profile)) {
    showNotify(getRestrictionReason(restrictions, profile) ?? INTERACTIVE_CONTEXT_RESTRICTION, "info")
    return
  }

  state.semanticContextProfile = profile
  renderSemanticSnapshotState()
}

function selectSemanticContextFormat(format: ContextProjectionFormat): void {
  state.semanticContextFormat = format
  renderSemanticSnapshotState()
}

function splitSuggestOptions(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4)
}

async function executeProjection(projection: Projection): Promise<void> {
  routeProjection(projection, {
    respond(payload) {
      state.geminiLiveSession?.sendFunctionResult({
        name: "agentResponse",
        response: { text: payload.text }
      })

      if (payload.mode === "suggest") {
        const options = splitSuggestOptions(payload.text)
        showSuggestChips(options, (choice) => {
          state.geminiLiveSession?.sendText(choice)
        })
      }
    },
    focus(payload) {
      if (state.activeTabId === null) {
        return
      }
      void sendToContentScript(state.activeTabId, {
        type: "EXECUTE_PROJECTION",
        projection: payload
      })
    },
    navigate(payload) {
      if (typeof chrome !== "undefined" && chrome.tabs?.create) {
        chrome.tabs.create({ url: payload.url, active: payload.options?.activate ?? true })
      }
    },
    present(payload) {
      renderPresent(payload.content)
    },
    notify(payload) {
      showNotify(payload.message, payload.level)
    },
    copy(payload) {
      void navigator.clipboard.writeText(payload.text)
    }
  })
}

function getSemanticNodeText(node: SemanticNode): string {
  if (node.kind === "interactive") {
    return node.label ?? node.valuePreview ?? ""
  }

  return node.text
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function buildEnrichBounds(region: RegionDumpEntry | null): { x: number; y: number; width: number; height: number } | undefined {
  if (!region) {
    return undefined
  }

  return {
    x: region.boundingRect.x,
    y: region.boundingRect.y,
    width: region.boundingRect.width,
    height: region.boundingRect.height
  }
}

function buildEnrichAttributes(
  snapshot: SemanticSnapshot,
  node: SemanticNode,
  region: RegionDumpEntry | null
): Record<string, string> | undefined {
  const attributes: Record<string, string> = {
    "data-page-kind": snapshot.page.kind,
    "data-node-kind": node.kind,
    "data-region-id": snapshot.focus.region
  }

  if (region) {
    attributes["data-category"] = region.category
    attributes["data-primitive"] = region.primitive
    attributes["data-layout-role"] = region.layoutRole
    attributes["data-role-rank"] = region.roleRank
    if (region.subtype) {
      attributes["data-subtype"] = region.subtype
    }
  }

  const selectedTarget = state.selectedTarget?.regionId === snapshot.focus.region ? state.selectedTarget : null
  if (selectedTarget) {
    attributes["data-selection-category"] = selectedTarget.category
    attributes["data-selection-primitive"] = selectedTarget.primitive
    attributes["data-selection-label"] = selectedTarget.label
  }

  if (node.kind === "content") {
    attributes["data-content-type"] = node.type
    if (typeof node.level === "number") {
      attributes["data-heading-level"] = String(node.level)
    }
    for (const [key, value] of Object.entries(node.attributes ?? {})) {
      if (!value) {
        continue
      }
      if (key === "role") {
        attributes.role = value
        continue
      }
      if (key === "title") {
        attributes.title = value
        continue
      }
      if (key.startsWith("data-") || key.startsWith("aria-")) {
        attributes[key] = value
      }
    }
  }

  if (node.kind === "comment") {
    if (node.author) {
      attributes["data-author"] = node.author
    }
    if (node.timestamp) {
      attributes["data-timestamp"] = node.timestamp
    }
    attributes["data-depth"] = String(node.depth)
  }

  if (node.kind === "interactive") {
    attributes["data-control-type"] = node.controlType
    if (node.role) {
      attributes.role = node.role
    }
    if (node.label) {
      attributes.title = node.label
    }
    if (node.action) {
      attributes["data-action"] = node.action
    }
    if (node.state) {
      attributes["data-state"] = node.state
    }
    if (node.options && node.options.length > 0) {
      attributes["data-options"] = node.options.join(" | ")
    }
  }

  return Object.keys(attributes).length > 0 ? attributes : undefined
}

function getExpectedNodeId(targetRef: Record<string, unknown>): string | null {
  return asNonEmptyString(targetRef.nodeId) ?? asNonEmptyString(targetRef.entityId)
}

async function buildContextEnrichResult(event: RuntimeEnrichRequestEvent): Promise<ContextEnrichResultPayload> {
  const capturedAt = new Date().toISOString()
  const baseResult = {
    requestKind: event.payload.requestKind,
    targetRef: event.payload.targetRef,
    capturedAt
  } satisfies Pick<ContextEnrichResultPayload, "requestKind" | "targetRef" | "capturedAt">

  const snapshot = state.runtimeSnapshot ?? getSelectedSemanticSnapshot()
  if (!snapshot) {
    return {
      ...baseResult,
      status: "unsupported",
      failureReason: "no semantic snapshot is bound to the active turn"
    }
  }

  const expectedNodeId = getExpectedNodeId(event.payload.targetRef)
  if (expectedNodeId && snapshot.focus.nodeId !== expectedNodeId) {
    return {
      ...baseResult,
      status: "unsupported",
      failureReason: "active semantic snapshot no longer matches the enrich target"
    }
  }

  const region = findRegionDumpEntry(state.latestRegionDump?.dump ?? null, snapshot.focus.region)
  const nodeText = getSemanticNodeText(snapshot.focus.node)
  const selectedTargetText =
    state.selectedTarget?.regionId === snapshot.focus.region ? state.selectedTarget.text.trim() : ""
  const text = selectedTargetText || nodeText
  const detail: Record<string, unknown> = {
    captureScope: event.payload.requestKind,
    pageUrl: snapshot.page.url,
    pageTitle: snapshot.page.title ?? null,
    nodeId: snapshot.focus.nodeId,
    regionId: snapshot.focus.region,
    text
  }
  const bounds = buildEnrichBounds(region)
  if (bounds) {
    detail.bounds = bounds
  }
  const attributes = buildEnrichAttributes(snapshot, snapshot.focus.node, region)
  if (attributes) {
    detail.attributes = attributes
  }

  if (event.payload.requestKind === "node-detail") {
    return {
      ...baseResult,
      status: "ok",
      detail
    }
  }

  const viewport = await requestViewportCapture()
  if (!viewport) {
    return {
      ...baseResult,
      status: "failed",
      failureReason: "viewport capture unavailable for visual enrich request"
    }
  }

  detail.imageBase64 = viewport
  return {
    ...baseResult,
    status: "ok",
    detail
  }
}

function createSessionTransport(): SessionWsTransport {
  return new SessionWsTransport({
    apiBaseUrl: API_BASE_URL,
    authClient,
    handlers: {
      onPhaseChange(phase) {
        setPhase(phase)
      },
      onSessionReady(event) {
        state.sessionId = event.payload.sessionId
        state.clientSessionId = event.payload.clientSessionId
        state.lastRuntimeError = null
      },
      onProgress(event) {
        state.activeTurnId = event.turnId
        state.lastRuntimeError = null
      },
      onProjection(projection) {
        void executeProjection(projection)
      },
      onTurnDone() {
        state.activeTurnId = null
        state.pendingEnrichRequest = null
        state.lastRuntimeError = null
        state.runtimeSnapshot = null
      },
      onError(error) {
        state.activeTurnId = null
        state.pendingEnrichRequest = null
        state.lastRuntimeError = error
        state.runtimeSnapshot = null
        showNotify(error.message, "error")
      },
      async onEnrichRequest(event) {
        state.pendingEnrichRequest = event
        try {
          return await buildContextEnrichResult(event)
        } finally {
          state.pendingEnrichRequest = null
        }
      }
    }
  })
}

async function handleUserIntent(intent: Intent): Promise<void> {
  if (!state.geminiLiveSession) {
    showNotify("Voice mode is unavailable. Semantic snapshots still work.", "error")
    return
  }

  if (state.activeTabId === null) {
    showNotify("No active tab context.", "error")
    return
  }

  const snapshot = getSelectedSemanticSnapshot()
  if (!snapshot) {
    showNotify("No semantic snapshot selected for the current tab.", "error")
    return
  }

  state.sessionTransport ??= createSessionTransport()
  state.runtimeSnapshot = snapshot
  state.activeTurnId = null
  state.pendingEnrichRequest = null
  state.lastRuntimeError = null

  try {
    await state.sessionTransport.sendIntent({
      intent,
      activeTabId: state.activeTabId,
      snapshot
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to send intent to the session runtime"
    state.activeTurnId = null
    state.pendingEnrichRequest = null
    state.runtimeSnapshot = null
    state.lastRuntimeError = {
      code: "GENERATION_FAILED",
      message
    }
    setPhase("error")
    showNotify(message, "error")
  }
}

async function connectVoiceSession(token: string): Promise<void> {
  const liveSession = await connectGeminiLive(token)
  liveSession.onFunctionCall = handleUserIntent
  state.geminiLiveSession?.close()
  state.geminiLiveSession = liveSession
}

async function initializeVoiceSession(): Promise<void> {
  const tokenManager = new TokenManager(
    () => authClient.issueToken(),
    async (token) => {
      await connectVoiceSession(token)
    },
    (error) => {
      handleVoiceUnavailable(error)
    }
  )

  const token = await tokenManager.initialize()
  await connectVoiceSession(token)
}

function registerRuntimeListeners(): void {
  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message: AnyRuntimeMessage) => {
      if (message.type === "ACTIVE_TAB_CHANGED") {
        state.activeTabId = message.payload.tabId
        setPhaseForUrl(message.payload.url)
        void hydrateSemanticSnapshot(message.payload.tabId)
        void hydrateSemanticSnapshotHistory(message.payload.tabId)
        void hydrateSelectionState(message.payload.tabId)
        void hydrateSemanticRegionDump(message.payload.tabId)
      }

      if (message.type === "ARTICLE_CONTENT") {
        state.contentGraph.addArticle(
          message.payload.url,
          message.payload.title,
          message.payload.text,
          message.payload.structure,
          message.payload.extractedAt
        )
      }

      if (message.type === "SEMANTIC_SNAPSHOT_READY") {
        updateSemanticSnapshot(message.payload)
        void hydrateSemanticRegionDump(message.payload.tabId ?? undefined)
        if (message.payload.error) {
          showNotify(message.payload.error, "error")
        }
      }

      if (message.type === "SEMANTIC_SNAPSHOT_HISTORY_UPDATED") {
        updateSemanticSnapshotHistory(message.payload)
        void hydrateSemanticRegionDump(message.payload.tabId ?? undefined)
      }

      if (message.type === "SEMANTIC_SELECTION_STATE_CHANGED") {
        updateSelectionState(message.payload)
        void hydrateSemanticRegionDump(message.payload.tabId ?? undefined)
      }
    })
  }
}

async function hydrateActiveTabState(): Promise<void> {
  if (typeof chrome !== "undefined" && chrome.tabs?.query) {
    await new Promise<void>((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        state.activeTabId = tabs[0]?.id ?? null
        setPhaseForUrl(tabs[0]?.url ?? "")
        void hydrateSemanticSnapshot(state.activeTabId ?? undefined)
        void hydrateSemanticSnapshotHistory(state.activeTabId ?? undefined)
        void hydrateSelectionState(state.activeTabId ?? undefined)
        void hydrateSemanticRegionDump(state.activeTabId ?? undefined)
        resolve()
      })
    })
  }
}

async function initialize(): Promise<void> {
  setPhase("initializing")
  state.sessionTransport = createSessionTransport()
  bindSemanticSnapshotActions({
    onCapture: () => {
      void requestSemanticSnapshot()
    },
    onCopy: () => {
      void copySemanticSnapshot()
    },
    onCopyContext: () => {
      void copySemanticContext()
    },
    onToggleSelection: () => {
      void toggleSemanticSelection()
    },
    onClearSelection: () => {
      void clearSemanticSelection()
    },
    onToggleRaw: () => {
      toggleSemanticRawView()
    },
    onSelectHistory: (snapshotId) => {
      selectSemanticSnapshot(snapshotId)
    },
    onSelectContextProfile: (profile) => {
      selectSemanticContextProfile(profile)
    },
    onSelectContextFormat: (format) => {
      selectSemanticContextFormat(format)
    }
  })
  renderSemanticSnapshotState()
  registerRuntimeListeners()
  await hydrateActiveTabState()
  await initializeAudio()
  window.addEventListener("beforeunload", () => {
    void state.sessionTransport?.close()
    state.geminiLiveSession?.close()
  })

  try {
    await initializeVoiceSession()
  } catch (error) {
    handleVoiceUnavailable(error)
  }
}

void initialize().catch((error) => {
  setPhase("error")
  showNotify(error instanceof Error ? error.message : "failed to initialize", "error")
})
