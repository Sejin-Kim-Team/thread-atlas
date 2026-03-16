import type {
  ExtensionAuthState,
  Projection,
  SemanticNode,
  SemanticSnapshot,
  PresentContent
} from "@threadatlas/shared"
import type {
  AnyRuntimeMessage,
  ContextEnrichResultPayload,
  PageTextSelectionChangedPayload,
  SemanticCropTargetResponse,
  SemanticSnapshotCaptureResponse,
  RuntimeV2ErrorPayload,
  RuntimeV2ServerEnvelope,
  RuntimeV2ToolResultPayload
} from "@threadatlas/shared/runtime"
import type { RegionDump } from "../content/semantic/core/observability"
import { isSemanticCaptureSupportedUrl } from "../common/semantic-url"
import { createAuthClient } from "../sidepanel/auth-client"
import { createChromeLocalStorage, loadExtensionConfig } from "../common/extension-config"
import { ConversationController } from "../sidepanel/conversation-controller"
import { routeProjection } from "../sidepanel/projection-router"
import type { TurnOrigin } from "../sidepanel/speech-types"
import { mergeStreamingTranscript } from "../sidepanel/transcript-merge"
import { showNotify } from "../sidepanel/ui"
import { cropViewportBase64ToPng } from "./image-crop"
import {
  bindConsumerShellActions,
  renderConsumerShell,
  type ConsumerConversationMessage
} from "./ui"
import {
  deriveConsumerShellViewState,
  type ConsumerVoiceActivityState
} from "./view-state"

interface SemanticSnapshotState {
  tabId: number | null
  snapshot: SemanticSnapshot | null
  error: string | null
}

interface SemanticRegionDumpState {
  tabId: number | null
  dump: RegionDump | null
  error: string | null
}

interface ShellMessage extends ConsumerConversationMessage {
  contextContent?: PresentContent
  highlightProjection?: Extract<Projection, { type: "focus" | "focusMultiple" }>
}

interface TurnDecoration {
  provenanceSummary?: string[]
  contextContent?: PresentContent
  highlightProjection?: Extract<Projection, { type: "focus" | "focusMultiple" }>
  copyText?: string
}

interface SidePanelUserState {
  apiBaseUrl: string
  conversationController: ConversationController | null
  activeTabId: number | null
  activeTabUrl: string
  activeTabTitle: string
  currentPageKey: string | null
  latestSemanticSnapshot: SemanticSnapshotState | null
  latestRegionDump: SemanticRegionDumpState | null
  pageSnapshot: SemanticSnapshot | null
  selectionSnapshot: SemanticSnapshot | null
  activeScope: "page" | "selection"
  selectionPreview: string | null
  selectionScopeMeta: string | null
  runtimeSnapshot: SemanticSnapshot | null
  phase: "initializing" | "ready" | "opening-session" | "sending-intent" | "waiting-enrich" | "resuming-turn" | "dormant" | "error"
  authState: ExtensionAuthState
  authBusy: boolean
  conversationMessages: ShellMessage[]
  composerText: string
  currentTurnOrigin: TurnOrigin | null
  activeTurnId: string | null
  lastRuntimeError: RuntimeV2ErrorPayload | null
  speechInputState: "idle" | "listening" | "processing" | "unsupported" | "error"
  speechInputDetail: string | null
  pendingEnrichRequest: Extract<RuntimeV2ServerEnvelope, { type: "tool.request" }> | null
  voiceAssistantMessageId: string | null
  voiceAssistantTranscriptBuffer: string
  voiceUserMessageId: string | null
  voiceUserTranscriptBuffer: string
  menuOpen: boolean
  ttsEnabled: boolean
  contextSheetOpen: boolean
  contextSheetContent: PresentContent | null
  turnDecorations: Map<string, TurnDecoration>
  preparingSnapshot: boolean
  voiceActivityState: ConsumerVoiceActivityState
  signalLevels: number[]
  showInternalConsoleLauncher: boolean
}

const TTS_ENABLED_STORAGE_KEY = "THREADATLAS_TTS_ENABLED"
const authClient = createAuthClient()

function readPersistedTtsEnabled(): boolean {
  const stored = window.localStorage.getItem(TTS_ENABLED_STORAGE_KEY)
  return stored === null ? true : stored === "true"
}

const state: SidePanelUserState = {
  apiBaseUrl: "",
  conversationController: null,
  activeTabId: null,
  activeTabUrl: "",
  activeTabTitle: "ThreadAtlas",
  currentPageKey: null,
  latestSemanticSnapshot: null,
  latestRegionDump: null,
  pageSnapshot: null,
  selectionSnapshot: null,
  activeScope: "page",
  selectionPreview: null,
  selectionScopeMeta: null,
  runtimeSnapshot: null,
  phase: "initializing",
  authState: {
    status: "signed-out",
    provider: null,
    user: null,
    session: null
  },
  authBusy: false,
  conversationMessages: [],
  composerText: "",
  currentTurnOrigin: null,
  activeTurnId: null,
  lastRuntimeError: null,
  speechInputState: "unsupported",
  speechInputDetail: null,
  pendingEnrichRequest: null,
  voiceAssistantMessageId: null,
  voiceAssistantTranscriptBuffer: "",
  voiceUserMessageId: null,
  voiceUserTranscriptBuffer: "",
  menuOpen: false,
  ttsEnabled: readPersistedTtsEnabled(),
  contextSheetOpen: false,
  contextSheetContent: null,
  turnDecorations: new Map(),
  preparingSnapshot: false,
  voiceActivityState: "idle",
  signalLevels: Array.from({ length: 24 }, () => 0),
  showInternalConsoleLauncher: false
}

let voiceVisualDecayTimer: number | null = null
let selectionCaptureVersion = 0

function isPageTextSelectionChangedMessage(
  message: unknown
): message is { type: "PAGE_TEXT_SELECTION_CHANGED"; payload: PageTextSelectionChangedPayload } {
  if (typeof message !== "object" || message === null) {
    return false
  }
  const candidate = message as { type?: unknown; payload?: Partial<PageTextSelectionChangedPayload> }
  return (
    candidate.type === "PAGE_TEXT_SELECTION_CHANGED" &&
    typeof candidate.payload?.hasSelection === "boolean" &&
    typeof candidate.payload?.textPreview === "string" &&
    typeof candidate.payload?.timestamp === "number"
  )
}

function resetVoiceTranscriptState(): void {
  state.voiceAssistantMessageId = null
  state.voiceAssistantTranscriptBuffer = ""
  state.voiceUserMessageId = null
  state.voiceUserTranscriptBuffer = ""
}

function resetSignalLevels(): void {
  state.signalLevels = Array.from({ length: 24 }, () => 0)
}

function setVoiceActivityState(next: ConsumerVoiceActivityState): void {
  state.voiceActivityState = next
  if (next === "idle" || next === "thinking") {
    resetSignalLevels()
  }
}

function pushSignalLevel(level: number): void {
  const normalized = Math.max(0, Math.min(1, level))
  state.signalLevels = [...state.signalLevels.slice(-23), normalized]
}

function persistTtsEnabled(): void {
  window.localStorage.setItem(TTS_ENABLED_STORAGE_KEY, state.ttsEnabled ? "true" : "false")
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

function getPageTitle(): string {
  if (state.activeTabTitle.trim()) {
    return state.activeTabTitle
  }
  if (state.activeTabUrl) {
    try {
      return new URL(state.activeTabUrl).hostname
    } catch {
      return "ThreadAtlas"
    }
  }
  return "ThreadAtlas"
}

function getPageDomain(): string {
  if (!state.activeTabUrl) {
    return "Current page"
  }
  try {
    return new URL(state.activeTabUrl).hostname
  } catch {
    return "Current page"
  }
}

function isSignedIn(): boolean {
  return state.authState.status === "signed-in"
}

function isSupportedPage(): boolean {
  return Boolean(state.activeTabUrl) && isSemanticCaptureSupportedUrl(state.activeTabUrl)
}

function getConversationSnapshot(): SemanticSnapshot | null {
  return state.runtimeSnapshot ?? getActiveScopeSnapshot()
}

function getActiveScopeSnapshot(): SemanticSnapshot | null {
  if (state.activeScope === "selection" && state.selectionSnapshot) {
    return state.selectionSnapshot
  }
  return state.pageSnapshot ?? state.latestSemanticSnapshot?.snapshot ?? null
}

function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

function describeSelectionScope(snapshot: SemanticSnapshot): string {
  const node = snapshot.focus.node
  const coverage = snapshot.meta.coverage
  const relatedCount = snapshot.context.length

  let label = "Section"
  if (coverage?.kind === "focus-branch" || node.kind === "comment") {
    label = "Comment branch"
  } else if (node.kind === "interactive") {
    label = "Control group"
  }

  if (!coverage) {
    return `${label} · ${formatCount(relatedCount, "related node")}`
  }

  return `${label} · ${formatCount(coverage.capturedNodeCount, "captured node")} · ${formatCount(
    relatedCount,
    "related node"
  )}`
}

async function applySelectionScopeHighlight(snapshot: SemanticSnapshot): Promise<void> {
  if (state.activeTabId === null) {
    return
  }

  try {
    await sendToContentScript<{ ok: boolean }>(state.activeTabId, {
      type: "APPLY_PAGE_SELECTION_SCOPE_HIGHLIGHT",
      payload: {
        regionId: snapshot.focus.region,
        focusNodeId: snapshot.focus.nodeId,
        rootNodeId: snapshot.meta.coverage?.rootNodeId ?? snapshot.focus.nodeId
      }
    })
  } catch {
    // Highlight is decorative; keep selection UX usable if it fails.
  }
}

async function clearSelectionScopeHighlight(tabId: number | null): Promise<void> {
  if (tabId === null) {
    return
  }

  try {
    await sendToContentScript<{ ok: boolean }>(tabId, {
      type: "CLEAR_PAGE_SELECTION_SCOPE_HIGHLIGHT"
    })
  } catch {
    // Ignore highlight clearing failures.
  }
}

function refreshVoiceVisualState(): void {
  if (state.speechInputState === "listening") {
    state.voiceActivityState = "listening"
    return
  }
  if (hasActiveRuntimeTurn() || state.speechInputState === "processing") {
    state.voiceActivityState = "thinking"
    return
  }
  state.voiceActivityState = "idle"
}

function scheduleVoiceVisualDecay(): void {
  if (voiceVisualDecayTimer !== null) {
    window.clearTimeout(voiceVisualDecayTimer)
  }
  voiceVisualDecayTimer = window.setTimeout(() => {
    refreshVoiceVisualState()
    renderShell()
  }, 180)
}

function applyTurnDecoration(message: ShellMessage, turnId: string | null | undefined): ShellMessage {
  if (!turnId) {
    return message
  }
  const decoration = state.turnDecorations.get(turnId)
  if (!decoration) {
    if (message.role !== "assistant") {
      return message
    }
    return {
      ...message,
      actions: {
        ...message.actions,
        copyText: message.actions?.copyText ?? message.text
      }
    }
  }

  const nextMessage: ShellMessage = { ...message }
  if (message.role === "assistant") {
    nextMessage.actions = {
      copyText: decoration.copyText ?? message.actions?.copyText ?? message.text,
      showContext: Boolean(decoration.contextContent ?? message.contextContent),
      highlight: Boolean(decoration.highlightProjection ?? message.highlightProjection)
    }
  }
  const provenanceSummary = decoration.provenanceSummary ?? message.provenanceSummary
  if (provenanceSummary) {
    nextMessage.provenanceSummary = provenanceSummary
  }
  const contextContent = decoration.contextContent ?? message.contextContent
  if (contextContent) {
    nextMessage.contextContent = contextContent
  }
  const highlightProjection = decoration.highlightProjection ?? message.highlightProjection
  if (highlightProjection) {
    nextMessage.highlightProjection = highlightProjection
  }
  return nextMessage
}

function updateTurnDecoration(turnId: string | null | undefined, patch: TurnDecoration): void {
  if (!turnId) {
    return
  }
  const current = state.turnDecorations.get(turnId) ?? {}
  const next: TurnDecoration = {
    ...current,
    ...patch
  }
  state.turnDecorations.set(turnId, next)
  state.conversationMessages = state.conversationMessages.map((message) =>
    message.turnId === turnId && message.role === "assistant" ? applyTurnDecoration(message, turnId) : message
  )
}

function appendConversationMessage(message: ShellMessage): void {
  state.conversationMessages = [
    ...state.conversationMessages,
    applyTurnDecoration(
      {
        ...message,
        id: message.id ?? globalThis.crypto?.randomUUID?.() ?? `msg-${Date.now()}`
      },
      message.turnId
    )
  ]
}

function upsertConversationMessage(message: ShellMessage): void {
  const existingIndex = state.conversationMessages.findIndex((item) => item.id === message.id)
  const nextMessage = applyTurnDecoration(message, message.turnId)
  if (existingIndex === -1) {
    state.conversationMessages = [...state.conversationMessages, nextMessage]
  } else {
    const next = [...state.conversationMessages]
    next[existingIndex] = {
      ...next[existingIndex],
      ...nextMessage
    }
    state.conversationMessages = next
  }
}

function removeConversationMessage(id: string | null): void {
  if (!id) {
    return
  }
  state.conversationMessages = state.conversationMessages.filter((item) => item.id !== id)
}

function resetConversationSurface(): void {
  state.conversationMessages = []
  state.composerText = ""
  state.contextSheetOpen = false
  state.contextSheetContent = null
  resetVoiceTranscriptState()
  state.turnDecorations.clear()
}

function getAssistantMessageById(messageId: string): ShellMessage | null {
  return state.conversationMessages.find((message) => message.id === messageId) ?? null
}

function upsertVoiceUserTranscript(turnId: string, text: string, final: boolean): void {
  if (!text && !final) {
    return
  }
  const messageId =
    state.voiceUserMessageId ??
    `voice-user-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(16)}`
  state.voiceUserMessageId = messageId
  const merged = mergeStreamingTranscript(state.voiceUserTranscriptBuffer, text)
  state.voiceUserTranscriptBuffer = merged
  if (merged.trim().length === 0 && final) {
    removeConversationMessage(messageId)
    state.voiceUserTranscriptBuffer = ""
    state.voiceUserMessageId = null
    return
  }
  upsertConversationMessage({
    id: messageId,
    role: "user",
    text: merged,
    pending: !final,
    turnId
  })
  if (final) {
    state.voiceUserTranscriptBuffer = ""
    state.voiceUserMessageId = null
  }
}

function upsertVoiceAssistantTranscript(turnId: string, text: string, final: boolean): void {
  if (!text && !final) {
    return
  }
  const messageId =
    state.voiceAssistantMessageId ??
    `voice-assistant-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(16)}`
  state.voiceAssistantMessageId = messageId
  const merged = mergeStreamingTranscript(state.voiceAssistantTranscriptBuffer, text)
  state.voiceAssistantTranscriptBuffer = merged
  if (merged.trim().length === 0 && final) {
    removeConversationMessage(messageId)
    state.voiceAssistantTranscriptBuffer = ""
    state.voiceAssistantMessageId = null
    return
  }
  upsertConversationMessage({
    id: messageId,
    role: "assistant",
    text: merged,
    pending: !final,
    turnId,
    actions: {
      copyText: merged
    }
  })
  if (final) {
    state.voiceAssistantTranscriptBuffer = ""
    state.voiceAssistantMessageId = null
  }
}

function renderShell(): void {
  const signedInUser = state.authState.user
  const view = deriveConsumerShellViewState({
    pageSupported: isSupportedPage(),
    snapshotReady: Boolean(state.pageSnapshot ?? state.selectionSnapshot),
    snapshotPreparing: state.preparingSnapshot,
    snapshotError: state.latestSemanticSnapshot?.error ?? null,
    authStatus: state.authState.status,
    inputSupported: state.conversationController?.inputSupported ?? false,
    voiceActivityState: state.voiceActivityState,
    runtimePhase: state.phase,
    speechInputState: state.speechInputState,
    speechInputDetail: state.speechInputDetail,
    lastRuntimeError: state.lastRuntimeError
  })

  renderConsumerShell({
    pageTitle: getPageTitle(),
    pageDomain: getPageDomain(),
    view,
    messages: state.conversationMessages,
    activeScope: state.activeScope,
    selectionPreview: state.selectionPreview,
    selectionScopeMeta: state.selectionScopeMeta,
    composerValue: state.composerText,
    sendDisabled: view.composerDisabled || state.composerText.trim().length === 0,
    voiceActivityState: state.voiceActivityState,
    signalLevels: state.signalLevels,
    signedInUser,
    authStatusLabel:
      state.authState.status === "signing-in"
        ? "Signing in with Google"
        : state.authState.status === "refreshing"
          ? "Refreshing your session"
          : "Talk with the page you are reading",
    authStatusDescription:
      state.authState.status === "error"
        ? state.authState.errorMessage ?? "Google sign-in failed. Try again."
        : "Sign in once and ask questions about the current page with voice or text.",
    menuOpen: state.menuOpen,
    voiceOutputEnabled: state.ttsEnabled,
    showInternalConsoleLauncher: state.showInternalConsoleLauncher,
    contextContent: state.contextSheetContent,
    contextSheetOpen: state.contextSheetOpen
  })
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
  const trySend = () =>
    new Promise<TResponse>((resolve, reject) => {
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

  try {
    return await trySend()
  } catch (error) {
    const messageText = error instanceof Error ? error.message : ""
    if (
      !messageText.includes("Receiving end does not exist") ||
      typeof chrome === "undefined" ||
      !chrome.scripting?.executeScript
    ) {
      throw error
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content-semantic.js"]
    })

    return trySend()
  }
}

async function requestViewportCapture(): Promise<string | null> {
  try {
    const response = await sendRuntimeMessage<{ viewport: string | null }>({ type: "CAPTURE_VIEWPORT" })
    return response.viewport
  } catch {
    return null
  }
}

async function requestSemanticCropTarget(
  snapshot: SemanticSnapshot
): Promise<SemanticCropTargetResponse | null> {
  if (state.activeTabId === null) {
    return null
  }

  const focusTargetHint = snapshot.meta.focusTargetHint ?? {
    regionId: snapshot.focus.region,
    focusNodeId: snapshot.focus.nodeId,
    rootNodeId: snapshot.meta.coverage?.rootNodeId
  }

  try {
    return await sendToContentScript<SemanticCropTargetResponse>(state.activeTabId, {
      type: "GET_SEMANTIC_CROP_TARGET",
      payload: {
        regionId: focusTargetHint.regionId,
        focusNodeId: focusTargetHint.focusNodeId,
        ...(focusTargetHint.rootNodeId ? { rootNodeId: focusTargetHint.rootNodeId } : {}),
        ...(snapshot.meta.scopeKind ? { scopeKind: snapshot.meta.scopeKind } : {})
      }
    })
  } catch {
    return null
  }
}

function updateSemanticSnapshot(payload: SemanticSnapshotState): void {
  state.latestSemanticSnapshot = payload
  state.pageSnapshot = payload.snapshot
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
    state.latestRegionDump = payload
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to load semantic region dump"
    state.latestRegionDump = { tabId: tabId ?? null, dump: null, error: message }
  }
}

async function requestSemanticSnapshot(options: { silent?: boolean } = {}): Promise<SemanticSnapshot | null> {
  if (!isSupportedPage()) {
    state.latestSemanticSnapshot = {
      tabId: state.activeTabId,
      snapshot: null,
      error: "This page is not available for ThreadAtlas."
    }
    renderShell()
    return null
  }

  state.preparingSnapshot = true
  renderShell()

  try {
    const payload = await sendRuntimeMessage<SemanticSnapshotState>(
      typeof state.activeTabId === "number"
        ? {
            type: "REQUEST_SEMANTIC_SNAPSHOT",
            payload: { tabId: state.activeTabId, source: "sidepanel" }
          }
        : {
            type: "REQUEST_SEMANTIC_SNAPSHOT",
            payload: { source: "sidepanel" }
          }
    )
    updateSemanticSnapshot(payload)
    await hydrateSemanticRegionDump(state.activeTabId ?? undefined)
    if (payload.error && !options.silent) {
      showNotify(payload.error, "error")
    }
    return payload.snapshot
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to prepare the page context"
    state.latestSemanticSnapshot = {
      tabId: state.activeTabId,
      snapshot: null,
      error: message
    }
    if (!options.silent) {
      showNotify(message, "error")
    }
    return null
  } finally {
    state.preparingSnapshot = false
    renderShell()
  }
}

async function captureSelectionSnapshot(): Promise<SemanticSnapshotCaptureResponse> {
  if (state.activeTabId === null) {
    return {
      snapshot: null,
      error: "There is no active page to select from."
    }
  }

  return sendToContentScript<SemanticSnapshotCaptureResponse>(state.activeTabId, {
    type: "CAPTURE_PAGE_TEXT_SELECTION_SNAPSHOT"
  })
}

async function captureSelectionScope(textPreview: string): Promise<void> {
  if (!isSupportedPage()) {
    return
  }

  const captureVersion = ++selectionCaptureVersion
  try {
    const result = await captureSelectionSnapshot()
    if (captureVersion !== selectionCaptureVersion) {
      return
    }
    if (result.snapshot) {
      state.selectionSnapshot = result.snapshot
      state.selectionPreview = textPreview
      state.selectionScopeMeta = describeSelectionScope(result.snapshot)
      state.activeScope = "selection"
      void applySelectionScopeHighlight(result.snapshot)
      renderShell()
      return
    }
  } catch {
    // Fall through to recovery copy below.
  }

  if (captureVersion !== selectionCaptureVersion) {
    return
  }

  showNotify("Couldn't use that selection. Still using this page.", "info")
  renderShell()
}

async function clearSelectionScope(options: { clearBrowserSelection?: boolean } = {}): Promise<void> {
  const tabId = state.activeTabId
  state.activeScope = "page"
  state.selectionSnapshot = null
  state.selectionPreview = null
  state.selectionScopeMeta = null
  selectionCaptureVersion += 1

  if (options.clearBrowserSelection !== false && state.activeTabId !== null) {
    try {
      await sendToContentScript<{ ok: boolean }>(state.activeTabId, {
        type: "CLEAR_PAGE_TEXT_SELECTION"
      })
    } catch {
      // Ignore selection clearing failures; scope state is still local truth.
    }
  }

  await clearSelectionScopeHighlight(tabId)

  renderShell()
}

async function ensurePreparedSnapshot(): Promise<SemanticSnapshot | null> {
  const scopedSnapshot = getActiveScopeSnapshot()
  if (scopedSnapshot) {
    return scopedSnapshot
  }
  return requestSemanticSnapshot()
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

function findRegionDumpEntry(
  dump: RegionDump | null,
  regionId: string | null | undefined
): RegionDump["regions"][number] | null {
  if (!dump || !regionId) {
    return null
  }
  return dump.regions.find((region) => region.id === regionId) ?? null
}

function buildEnrichBounds(region: RegionDump["regions"][number] | null): { x: number; y: number; width: number; height: number } | undefined {
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
  region: RegionDump["regions"][number] | null
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
    if (region.normalizedKind) {
      attributes["data-normalized-kind"] = region.normalizedKind
    }
    if (region.subtype) {
      attributes["data-subtype"] = region.subtype
    }
  }

  if (node.kind === "content") {
    attributes["data-content-type"] = node.type
    if (typeof node.level === "number") {
      attributes["data-heading-level"] = String(node.level)
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
    if (node.action) {
      attributes["data-action"] = node.action
    }
  }

  return Object.keys(attributes).length > 0 ? attributes : undefined
}

function getExpectedNodeId(targetRef: Record<string, unknown>): string | null {
  return asNonEmptyString(targetRef.nodeId) ?? asNonEmptyString(targetRef.entityId)
}

function shouldPreferSemanticCrop(snapshot: SemanticSnapshot): boolean {
  if (snapshot.meta.scopeKind === "selection") {
    return true
  }
  return (
    snapshot.meta.focusRegionHint?.normalizedKind === "card" ||
    snapshot.meta.focusRegionHint?.primitive === "repeated-item"
  )
}

async function buildContextEnrichResult(
  request: {
    requestKind: ContextEnrichResultPayload["requestKind"]
    targetRef: ContextEnrichResultPayload["targetRef"]
  }
): Promise<ContextEnrichResultPayload> {
  const capturedAt = new Date().toISOString()
  const baseResult = {
    requestKind: request.requestKind,
    targetRef: request.targetRef,
    capturedAt
  } satisfies Pick<ContextEnrichResultPayload, "requestKind" | "targetRef" | "capturedAt">

  const snapshot = state.runtimeSnapshot ?? state.latestSemanticSnapshot?.snapshot
  if (!snapshot) {
    return {
      ...baseResult,
      status: "unsupported",
      failureReason: "no semantic snapshot is bound to the active turn"
    }
  }

  const expectedNodeId = getExpectedNodeId(request.targetRef)
  if (expectedNodeId && snapshot.focus.nodeId !== expectedNodeId) {
    return {
      ...baseResult,
      status: "unsupported",
      failureReason: "active semantic snapshot no longer matches the enrich target"
    }
  }

  const region = findRegionDumpEntry(state.latestRegionDump?.dump ?? null, snapshot.focus.region)
  const text = getSemanticNodeText(snapshot.focus.node)
  const detail: Record<string, unknown> = {
    captureScope: request.requestKind,
    scopeKind: snapshot.meta.scopeKind ?? "page",
    pageUrl: snapshot.page.url,
    pageTitle: snapshot.page.title ?? null,
    nodeId: snapshot.focus.nodeId,
    regionId: snapshot.focus.region,
    text,
    ...(snapshot.meta.focusTargetHint?.rootNodeId
      ? { rootNodeId: snapshot.meta.focusTargetHint.rootNodeId }
      : {})
  }
  const bounds = buildEnrichBounds(region)
  if (bounds) {
    detail.bounds = bounds
  }
  const attributes = buildEnrichAttributes(snapshot, snapshot.focus.node, region)
  if (attributes) {
    detail.attributes = attributes
  }
  if (snapshot.meta.focusRegionHint) {
    detail.regionHint = snapshot.meta.focusRegionHint
  }

  if (request.requestKind === "node-detail") {
    return {
      ...baseResult,
      status: "ok",
      detail
    }
  }

  const viewport = await requestViewportCapture()
  if (!viewport) {
    return request.requestKind === "visible-region"
      ? {
          ...baseResult,
          status: "failed",
          failureReason: "viewport capture unavailable for visual enrich request"
        }
      : {
          ...baseResult,
          status: "ok",
          detail
        }
  }

  const preferSemanticCrop = shouldPreferSemanticCrop(snapshot)

  if (request.requestKind === "visible-region" && !preferSemanticCrop) {
    return {
      ...baseResult,
      status: "ok",
      detail,
      imageBase64: viewport,
      mimeType: "image/jpeg"
    }
  }

  const cropTarget = await requestSemanticCropTarget(snapshot)
  const croppedImage = cropTarget ? await cropViewportBase64ToPng(viewport, cropTarget) : null
  if (!croppedImage) {
    return {
      ...baseResult,
      status: "ok",
      detail
    }
  }

  return {
    ...baseResult,
    status: "ok",
    detail,
    imageBase64: croppedImage,
    mimeType: "image/png"
  }
}

async function applyProjectionSideEffects(projection: Projection): Promise<void> {
  routeProjection(projection, {
    respond() {
      // Answer text is handled by transcript/projection message handlers.
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
      state.contextSheetContent = payload.content
    },
    notify(payload) {
      showNotify(payload.message, payload.level)
    },
    copy(payload) {
      void navigator.clipboard.writeText(payload.text)
      showNotify("Copied.", "success")
    }
  })
}

async function handleRuntimeToolRequest(
  event: Extract<RuntimeV2ServerEnvelope, { type: "tool.request" }>
): Promise<RuntimeV2ToolResultPayload | null> {
  if (event.payload.kind === "context.enrich") {
    try {
      const args = event.payload.args as {
        requestKind?: ContextEnrichResultPayload["requestKind"]
        targetRef?: ContextEnrichResultPayload["targetRef"]
      }
      if (!args.requestKind || !args.targetRef) {
        throw new Error("runtime enrich request is missing requestKind or targetRef")
      }
      const payload = await buildContextEnrichResult({
        requestKind: args.requestKind,
        targetRef: args.targetRef
      })
      return {
        toolRequestId: event.payload.toolRequestId,
        kind: event.payload.kind,
        ok: true,
        result: {
          payload
        }
      }
    } catch (error) {
      return {
        toolRequestId: event.payload.toolRequestId,
        kind: event.payload.kind,
        ok: false,
        error: error instanceof Error ? error.message : "enrich handling failed"
      }
    }
  }

  if (
    event.payload.kind === "focus.node" ||
    event.payload.kind === "present.content" ||
    event.payload.kind === "copy.text" ||
    event.payload.kind === "navigate.url"
  ) {
    const projection = event.payload.args.projection as Projection | undefined
    if (!projection) {
      return {
        toolRequestId: event.payload.toolRequestId,
        kind: event.payload.kind,
        ok: false,
        error: "runtime frontend tool payload is missing a projection"
      }
    }
    if (projection?.type === "present") {
      updateTurnDecoration(event.turnId, { contextContent: projection.payload.content })
    }
    if (projection?.type === "focus" || projection?.type === "focusMultiple") {
      updateTurnDecoration(event.turnId, { highlightProjection: projection })
    }
    await applyProjectionSideEffects(projection)
    return {
      toolRequestId: event.payload.toolRequestId,
      kind: event.payload.kind,
      ok: true
    }
  }

  return {
    toolRequestId: event.payload.toolRequestId,
    kind: event.payload.kind,
    ok: false,
    error: "unsupported runtime frontend tool"
  }
}

function applyAuthState(next: ExtensionAuthState): void {
  const previous = state.authState.status
  state.authState = next
  state.authBusy = next.status === "signing-in" || next.status === "refreshing"

  const signedOutNow =
    previous !== "signed-out" &&
    previous !== "error" &&
    next.status !== "signed-in" &&
    next.status !== "refreshing"

  if (signedOutNow) {
    void state.conversationController?.close()
    state.activeTurnId = null
    state.pendingEnrichRequest = null
    state.lastRuntimeError = null
    state.runtimeSnapshot = null
    state.currentTurnOrigin = null
    resetVoiceTranscriptState()
    setVoiceActivityState("idle")
    resetConversationSurface()
  }

  renderShell()
}

async function hydrateAuthState(): Promise<void> {
  applyAuthState(await authClient.getAuthState())
}

async function signInWithGoogle(): Promise<void> {
  const next = await authClient.signInWithGoogle()
  applyAuthState(next)
  if (next.status === "signed-in") {
    showNotify("Signed in with Google.", "success")
  } else if (next.errorMessage) {
    showNotify(next.errorMessage, next.status === "error" ? "error" : "info")
  }
}

async function signOut(): Promise<void> {
  const next = await authClient.signOut()
  applyAuthState(next)
  showNotify("Signed out.", "info")
}

async function submitTextPrompt(prompt: string): Promise<void> {
  const normalized = prompt.trim()
  if (!normalized) {
    return
  }
  if (!isSignedIn()) {
    showNotify("Sign in with Google before asking about this page.", "info")
    return
  }
  if (!isSupportedPage()) {
    showNotify("This page is not available for ThreadAtlas.", "info")
    return
  }
  if (hasActiveRuntimeTurn()) {
    showNotify("Wait for the current answer to finish.", "info")
    return
  }

  const snapshot = await ensurePreparedSnapshot()
  if (!snapshot || state.activeTabId === null) {
    return
  }

  state.lastRuntimeError = null
  state.runtimeSnapshot = snapshot
  state.currentTurnOrigin = "text"
  state.contextSheetOpen = false
  try {
    await state.conversationController?.sendTextTurn({
      activeTabId: state.activeTabId,
      snapshot,
      text: normalized,
      language: window.navigator.language
    })
    state.composerText = ""
    renderShell()
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to send prompt"
    state.lastRuntimeError = {
      code: "GENERATION_FAILED",
      message
    }
    state.runtimeSnapshot = null
    showNotify(message, "error")
    renderShell()
  }
}

async function startVoiceCapture(): Promise<void> {
  const controller = state.conversationController
  if (!controller?.inputSupported) {
    showNotify("Voice input is unavailable in this browser.", "info")
    return
  }
  if (!isSignedIn()) {
    showNotify("Sign in with Google before starting voice input.", "info")
    return
  }
  if (!isSupportedPage()) {
    showNotify("This page is not available for ThreadAtlas.", "info")
    return
  }
  if (hasActiveRuntimeTurn()) {
    showNotify("Wait for the current answer to finish.", "info")
    return
  }
  if (state.speechInputState === "listening" || state.speechInputState === "processing") {
    return
  }

  const snapshot = await ensurePreparedSnapshot()
  if (!snapshot || state.activeTabId === null) {
    return
  }

  state.lastRuntimeError = null
  state.runtimeSnapshot = snapshot
  state.currentTurnOrigin = "voice"
  try {
    await controller.startVoiceTurn({
      activeTabId: state.activeTabId,
      snapshot,
      language: window.navigator.language
    })
    renderShell()
  } catch (error) {
    state.speechInputState = "error"
    state.speechInputDetail =
      error instanceof Error ? error.message : "Voice capture could not be started."
    showNotify(state.speechInputDetail, "error")
    renderShell()
  }
}

async function finishVoiceCapture(): Promise<void> {
  if (state.speechInputState !== "listening") {
    return
  }
  await state.conversationController?.finishVoiceTurn()
  renderShell()
}

async function cancelVoiceCapture(): Promise<void> {
  if (state.speechInputState !== "listening" && state.speechInputState !== "processing") {
    return
  }
  await state.conversationController?.interrupt("cancelled")
  setVoiceActivityState("idle")
  resetVoiceTranscriptState()
  renderShell()
}

function toggleMenu(): void {
  state.menuOpen = !state.menuOpen
  renderShell()
}

function toggleVoiceOutput(): void {
  if (!state.conversationController?.outputSupported) {
    showNotify("Voice output is unavailable in this browser.", "info")
    return
  }
  state.ttsEnabled = !state.ttsEnabled
  persistTtsEnabled()
  state.conversationController.setVoiceOutputEnabled(state.ttsEnabled)
  renderShell()
}

function openInternalConsole(): void {
  if (typeof chrome !== "undefined" && chrome.tabs?.create) {
    chrome.tabs.create({
      url: chrome.runtime.getURL("console.html"),
      active: true
    })
  }
}

function openContextSheet(messageId: string): void {
  const message = getAssistantMessageById(messageId)
  if (!message?.contextContent) {
    return
  }
  state.contextSheetContent = message.contextContent
  state.contextSheetOpen = true
  renderShell()
}

async function copyAssistantMessage(messageId: string): Promise<void> {
  const message = getAssistantMessageById(messageId)
  const text = message?.actions?.copyText ?? message?.text
  if (!text) {
    return
  }
  await navigator.clipboard.writeText(text)
  showNotify("Copied.", "success")
}

async function highlightAssistantMessage(messageId: string): Promise<void> {
  const message = getAssistantMessageById(messageId)
  if (!message?.highlightProjection || state.activeTabId === null) {
    return
  }
  await sendToContentScript(state.activeTabId, {
    type: "EXECUTE_PROJECTION",
    projection: message.highlightProjection
  })
}

async function handleRecovery(kind: "refresh" | "microphone" | "runtime" | null): Promise<void> {
  if (kind === "microphone") {
    await startVoiceCapture()
    return
  }
  await requestSemanticSnapshot()
}

function resetForNewPage(): void {
  const previousTabId = state.activeTabId
  void clearSelectionScopeHighlight(previousTabId)
  selectionCaptureVersion += 1
  state.activeTurnId = null
  state.pendingEnrichRequest = null
  state.lastRuntimeError = null
  state.pageSnapshot = null
  state.selectionSnapshot = null
  state.activeScope = "page"
  state.selectionPreview = null
  state.selectionScopeMeta = null
  state.runtimeSnapshot = null
  state.currentTurnOrigin = null
  state.contextSheetOpen = false
  state.contextSheetContent = null
  state.latestSemanticSnapshot = null
  state.latestRegionDump = null
  resetVoiceTranscriptState()
  resetConversationSurface()
  setVoiceActivityState("idle")
}

async function handleEscapeAction(): Promise<void> {
  if (state.speechInputState === "listening" || state.speechInputState === "processing") {
    await cancelVoiceCapture()
    return
  }
  if (state.menuOpen) {
    state.menuOpen = false
    renderShell()
    return
  }
  if (state.contextSheetOpen) {
    state.contextSheetOpen = false
    renderShell()
    return
  }
  if (state.activeScope === "selection") {
    await clearSelectionScope()
  }
}

async function prepareCurrentPage(): Promise<void> {
  if (!isSupportedPage()) {
    state.latestSemanticSnapshot = {
      tabId: state.activeTabId,
      snapshot: null,
      error: "This page is not supported."
    }
    renderShell()
    return
  }
  await requestSemanticSnapshot({ silent: true })
}

function registerRuntimeListeners(): void {
  if (typeof chrome === "undefined" || !chrome.runtime?.onMessage) {
    return
  }

  chrome.runtime.onMessage.addListener((message: AnyRuntimeMessage) => {
    if (message.type === "ACTIVE_TAB_CHANGED") {
      const nextKey = `${message.payload.tabId}:${message.payload.url}`
      const pageChanged = state.currentPageKey !== nextKey
      state.activeTabId = message.payload.tabId
      state.activeTabUrl = message.payload.url
      state.activeTabTitle = message.payload.title || "ThreadAtlas"
      if (pageChanged) {
        state.currentPageKey = nextKey
        resetForNewPage()
      }
      renderShell()
      void prepareCurrentPage()
      return
    }

    if (message.type === "AUTH_STATE_CHANGED") {
      applyAuthState(message.payload)
      return
    }

    if (message.type === "SEMANTIC_SNAPSHOT_READY") {
      updateSemanticSnapshot(message.payload)
      void hydrateSemanticRegionDump(message.payload.tabId ?? undefined)
      renderShell()
      return
    }

    if (message.type === "PAGE_AUDIO_CAPTURE_READY") {
      return
    }

    if (isPageTextSelectionChangedMessage(message)) {
      if (
        !message.payload.hasSelection ||
        state.activeTabId === null ||
        message.payload.tabId !== state.activeTabId ||
        !isSupportedPage()
      ) {
        return
      }
      void captureSelectionScope(message.payload.textPreview)
    }
  })
}

async function hydrateActiveTabState(): Promise<void> {
  if (typeof chrome === "undefined" || !chrome.tabs?.query) {
    return
  }

  await new Promise<void>((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0]
      state.activeTabId = tab?.id ?? null
      state.activeTabUrl = tab?.url ?? ""
      state.activeTabTitle = tab?.title ?? "ThreadAtlas"
      state.currentPageKey =
        typeof tab?.id === "number" && tab?.url ? `${tab.id}:${tab.url}` : null
      resolve()
    })
  })

  renderShell()
  await prepareCurrentPage()
}

function createConversationController(): ConversationController {
  const controller = new ConversationController({
    apiBaseUrl: state.apiBaseUrl,
    authClient,
    getActiveTabId: () => state.activeTabId,
    sendToContentScript,
    addRuntimeListener(listener) {
      chrome.runtime.onMessage.addListener(
        listener as Parameters<typeof chrome.runtime.onMessage.addListener>[0]
      )
    },
    removeRuntimeListener(listener) {
      chrome.runtime.onMessage.removeListener(
        listener as Parameters<typeof chrome.runtime.onMessage.removeListener>[0]
      )
    },
    ttsEnabled: state.ttsEnabled,
    handlers: {
      onPhaseChange(phase) {
        state.phase = phase
        refreshVoiceVisualState()
        renderShell()
      },
      onSpeechStateChange(speechState, detail) {
        state.speechInputState = speechState
        state.speechInputDetail = detail ?? null
        refreshVoiceVisualState()
        renderShell()
      },
      onSessionReady() {
        state.lastRuntimeError = null
      },
      onTurnStarted(event) {
        state.activeTurnId = event.turnId
        state.lastRuntimeError = null
        state.currentTurnOrigin = event.payload.modality
        refreshVoiceVisualState()
        renderShell()
      },
      onInputTranscript(text, final, event) {
        if (event.turnId && state.currentTurnOrigin === "voice") {
          upsertVoiceUserTranscript(event.turnId, text, final)
        } else {
          upsertConversationMessage({
            id: `turn-user-${event.turnId}`,
            role: "user",
            text,
            pending: !final,
            turnId: event.turnId
          })
        }
        renderShell()
      },
      onOutputTranscript(text, final, event) {
        if (state.currentTurnOrigin === "voice") {
          upsertVoiceAssistantTranscript(event.turnId, text, final)
        }
        renderShell()
      },
      onProjection(projection, event) {
        if (projection.type === "respond") {
          if (state.currentTurnOrigin !== "voice") {
            appendConversationMessage({
              id: `turn-assistant-${event.turnId}`,
              role: "assistant",
              text: projection.payload.text,
              turnId: event.turnId,
              actions: {
                copyText: projection.payload.text
              }
            })
          } else {
            updateTurnDecoration(event.turnId, {
              copyText: projection.payload.text
            })
          }
          renderShell()
          return
        }

        if (projection.type === "present") {
          updateTurnDecoration(event.turnId, { contextContent: projection.payload.content })
          renderShell()
          return
        }

        if (projection.type === "focus" || projection.type === "focusMultiple") {
          updateTurnDecoration(event.turnId, { highlightProjection: projection })
          renderShell()
          return
        }

        void applyProjectionSideEffects(projection)
      },
      async onToolRequest(event) {
        state.pendingEnrichRequest = event
        renderShell()
        try {
          return await handleRuntimeToolRequest(event)
        } finally {
          state.pendingEnrichRequest = null
          renderShell()
        }
      },
      onTurnDone(event) {
        state.activeTurnId = null
        state.pendingEnrichRequest = null
        state.lastRuntimeError = null
        state.runtimeSnapshot = null
        if (Array.isArray(event.payload.provenanceSummary) && event.payload.provenanceSummary.length > 0) {
          updateTurnDecoration(event.turnId, {
            provenanceSummary: event.payload.provenanceSummary
          })
        }
        resetVoiceTranscriptState()
        refreshVoiceVisualState()
        renderShell()
      },
      onError(error) {
        state.activeTurnId = null
        state.pendingEnrichRequest = null
        state.lastRuntimeError = error
        state.runtimeSnapshot = null
        resetVoiceTranscriptState()
        refreshVoiceVisualState()
        showNotify(error.message, "error")
        renderShell()
      }
    }
  })

  controller.audioInput.onLevel = (level) => {
    pushSignalLevel(level)
    state.voiceActivityState = "listening"
    scheduleVoiceVisualDecay()
    renderShell()
  }
  controller.audioOutput.onLevel = (level) => {
    pushSignalLevel(level)
    state.voiceActivityState = "speaking"
    scheduleVoiceVisualDecay()
    renderShell()
  }

  return controller
}

async function initialize(): Promise<void> {
  const config = await loadExtensionConfig(createChromeLocalStorage())
  state.apiBaseUrl = config.apiBaseUrl
  state.showInternalConsoleLauncher = Boolean(config.devBootstrap)
  state.conversationController = createConversationController()
  state.conversationController.setVoiceOutputEnabled(state.ttsEnabled)
  state.speechInputState = state.conversationController.inputSupported ? "idle" : "unsupported"

  bindConsumerShellActions({
    onComposerInput: (value) => {
      state.composerText = value
      renderShell()
    },
    onSubmitPrompt: (prompt) => {
      void submitTextPrompt(prompt)
    },
    onStartMicPress: () => {
      void startVoiceCapture()
    },
    onEndMicPress: () => {
      void finishVoiceCapture()
    },
    onCancelMicPress: () => {
      void cancelVoiceCapture()
    },
    onToggleMenu: () => {
      toggleMenu()
    },
    onToggleVoiceOutput: () => {
      toggleVoiceOutput()
    },
    onSignIn: () => {
      void signInWithGoogle()
    },
    onSignOut: () => {
      void signOut()
    },
    onRecoveryPrimary: (kind) => {
      void handleRecovery(kind)
    },
    onCopyMessage: (messageId) => {
      void copyAssistantMessage(messageId)
    },
    onShowContext: (messageId) => {
      openContextSheet(messageId)
    },
    onHighlightMessage: (messageId) => {
      void highlightAssistantMessage(messageId)
    },
    onClearScope: () => {
      void clearSelectionScope()
    },
    onEscape: () => {
      void handleEscapeAction()
    },
    onOpenInternalConsole: () => {
      openInternalConsole()
    },
    onCloseContextSheet: () => {
      state.contextSheetOpen = false
      renderShell()
    }
  })

  renderShell()
  registerRuntimeListeners()
  await Promise.all([hydrateActiveTabState(), hydrateAuthState()])
  window.addEventListener("beforeunload", () => {
    void state.conversationController?.close()
  })
}

void initialize().catch((error) => {
  showNotify(error instanceof Error ? error.message : "failed to initialize", "error")
})
