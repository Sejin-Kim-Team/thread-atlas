import {
  buildContextPack,
  type ExtensionAuthProvider,
  type ExtensionAuthState,
  type ExtensionAuthStatus,
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
  RuntimeV2ErrorPayload,
  RuntimeV2ServerEnvelope,
  RuntimeV2ToolResultPayload,
  SemanticSelectionTarget
} from "@threadatlas/shared/runtime"
import type { RegionDump } from "../content/semantic/core/observability"
import { isSemanticCaptureSupportedUrl } from "../common/semantic-url"
import { routeProjection } from "./projection-router"
import { ContentGraphManager } from "./content-graph"
import { createAuthClient } from "./auth-client"
import { createChromeLocalStorage, loadExtensionConfig } from "../common/extension-config"
import { ConversationController } from "./conversation-controller"
import type { SpeechInputState, TurnOrigin } from "./speech-types"
import { mergeStreamingTranscript } from "./transcript-merge"
import {
  bindAuthActions,
  bindConversationActions,
  clearPresent,
  clearSuggestChips,
  renderAuthCard,
  renderConversation,
  bindSemanticSnapshotActions,
  renderPresent,
  renderSemanticSnapshot,
  selectSnapshotById,
  setSemanticSnapshotBusy,
  showNotify,
  showSuggestChips,
  updatePhaseIndicator,
  type ConversationMessage,
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

type TranscriptMessage = ConversationMessage

interface SidePanelState {
  phase: Phase
  apiBaseUrl: string
  conversationController: ConversationController | null
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
  pendingEnrichRequest: Extract<RuntimeV2ServerEnvelope, { type: "tool.request" }> | null
  lastRuntimeError: RuntimeV2ErrorPayload | null
  runtimeSnapshot: SemanticSnapshot | null
  semanticContextProfile: ContextTaskProfile
  semanticContextFormat: ContextProjectionFormat
  conversationMessages: TranscriptMessage[]
  composerText: string
  speechInputState: SpeechInputState
  speechInputDetail: string | null
  ttsEnabled: boolean
  authStatus: ExtensionAuthStatus
  authProvider: ExtensionAuthProvider | null
  authUser: ExtensionAuthState["user"]
  authError: string | null
  authBusy: boolean
  currentTurnOrigin: TurnOrigin | null
  pendingTurnOrigin: TurnOrigin | null
  voiceAssistantMessageId: string | null
  voiceUserMessageId: string | null
  voiceAssistantTranscriptBuffer: string
  voiceUserTranscriptBuffer: string
}

const TTS_ENABLED_STORAGE_KEY = "THREADATLAS_TTS_ENABLED"
const authClient = createAuthClient()

function readPersistedTtsEnabled(): boolean {
  const stored = window.localStorage.getItem(TTS_ENABLED_STORAGE_KEY)
  return stored === null ? true : stored === "true"
}

const state: SidePanelState = {
  phase: "initializing",
  apiBaseUrl: "",
  conversationController: null,
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
  semanticContextFormat: "context-pack-json",
  conversationMessages: [],
  composerText: "",
  speechInputState: "unsupported",
  speechInputDetail: null,
  ttsEnabled: readPersistedTtsEnabled(),
  authStatus: "signed-out",
  authProvider: null,
  authUser: null,
  authError: null,
  authBusy: false,
  currentTurnOrigin: null,
  pendingTurnOrigin: null,
  voiceAssistantMessageId: null,
  voiceUserMessageId: null,
  voiceAssistantTranscriptBuffer: "",
  voiceUserTranscriptBuffer: ""
}

function resetVoiceTranscriptState(): void {
  state.voiceAssistantMessageId = null
  state.voiceUserMessageId = null
  state.voiceAssistantTranscriptBuffer = ""
  state.voiceUserTranscriptBuffer = ""
}

type RegionDumpEntry = RegionDump["regions"][number]
type RuntimeToolRequestEvent = Extract<RuntimeV2ServerEnvelope, { type: "tool.request" }>
const INTERACTIVE_CONTEXT_RESTRICTION = "Interactive semantic snapshots currently support only the branch-summary profile."

function setPhase(phase: Phase): void {
  state.phase = phase
  updatePhaseIndicator(phase)
  renderConversationState()
}

function renderAuthState(): void {
  renderAuthCard({
    status: state.authStatus,
    provider: state.authProvider,
    user: state.authUser,
    errorMessage: state.authError
  })
}

function applyAuthState(next: ExtensionAuthState): void {
  const previousStatus = state.authStatus
  state.authStatus = next.status
  state.authProvider = next.provider
  state.authUser = next.user
  state.authError = next.errorMessage ?? null
  state.authBusy = next.status === "signing-in" || next.status === "refreshing"

  const shouldResetRuntime =
    previousStatus !== "signed-out" &&
    previousStatus !== "error" &&
    next.status !== "signed-in" &&
    next.status !== "refreshing"

  if (shouldResetRuntime) {
    void state.conversationController?.close()
    resetVoiceTranscriptState()
    resetSpeechInputState()
    state.sessionId = null
    state.clientSessionId = null
    state.activeTurnId = null
    state.pendingEnrichRequest = null
    state.lastRuntimeError = null
    state.runtimeSnapshot = null
    clearTurnOrigin()
    resetConversationSurface()
  }

  renderAuthState()
  renderConversationState()
}

function isConversationAuthReady(): boolean {
  return state.authStatus === "signed-in"
}

function persistTtsEnabled(): void {
  window.localStorage.setItem(TTS_ENABLED_STORAGE_KEY, state.ttsEnabled ? "true" : "false")
}

function isSpeechListening(): boolean {
  return state.speechInputState === "listening"
}

function isSpeechProcessing(): boolean {
  return state.speechInputState === "processing"
}

function shouldShowSpeechError(): boolean {
  return state.speechInputState === "error" && Boolean(state.speechInputDetail)
}

function resetSpeechInputState(): void {
  state.speechInputState = state.conversationController?.inputSupported ? "idle" : "unsupported"
  state.speechInputDetail = null
}

function setComposerDraft(value: string): void {
  state.composerText = value
}

function clearTurnOrigin(): void {
  state.currentTurnOrigin = null
  state.pendingTurnOrigin = null
}

function stopLiveAudioOutput(): void {
  state.conversationController?.audioOutput.stop()
}

async function interruptVoiceSession(reason = "interrupted"): Promise<void> {
  await state.conversationController?.interrupt(reason)
  stopLiveAudioOutput()
  resetVoiceTranscriptState()
  resetSpeechInputState()
}

function upsertVoiceUserTranscript(text: string, final: boolean): void {
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
    pending: !final
  })
  if (final) {
    state.voiceUserTranscriptBuffer = ""
    state.voiceUserMessageId = null
  }
}

function upsertVoiceAssistantTranscript(text: string, final: boolean): void {
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
    pending: !final
  })
  if (final) {
    state.voiceAssistantTranscriptBuffer = ""
    state.voiceAssistantMessageId = null
  }
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

function getConversationSnapshot(): SemanticSnapshot | null {
  return state.runtimeSnapshot ?? getSelectedSemanticSnapshot()
}

function getConversationStatus(): {
  status: string
  placeholder: string
  composerDisabled: boolean
  composerReadOnly: boolean
  micDisabled: boolean
  micLabel: string
  voiceOutputLabel: string
  voiceOutputDisabled: boolean
} {
  const inputSupported = state.conversationController?.inputSupported ?? false
  const outputSupported = state.conversationController?.outputSupported ?? false

  if (state.activeTabId === null) {
    return {
      status: "No active tab context.",
      placeholder: "Open a supported tab to start asking questions.",
      composerDisabled: true,
      composerReadOnly: false,
      micDisabled: true,
      micLabel: "Mic",
      voiceOutputLabel: outputSupported
        ? state.ttsEnabled
          ? "Voice Output On"
          : "Voice Output Off"
        : "Voice Output Unavailable",
      voiceOutputDisabled: !outputSupported
    }
  }

  if (!getConversationSnapshot()) {
    return {
      status: "Capture a semantic snapshot to ask about the current page.",
      placeholder: "Capture a semantic snapshot first.",
      composerDisabled: true,
      composerReadOnly: false,
      micDisabled: true,
      micLabel: "Mic",
      voiceOutputLabel: outputSupported
        ? state.ttsEnabled
          ? "Voice Output On"
          : "Voice Output Off"
        : "Voice Output Unavailable",
      voiceOutputDisabled: !outputSupported
    }
  }

  if (state.authStatus === "signing-in") {
    return {
      status: "Signing in with Google before starting the current-page assistant...",
      placeholder: "Waiting for Google sign-in...",
      composerDisabled: true,
      composerReadOnly: false,
      micDisabled: true,
      micLabel: "Mic",
      voiceOutputLabel: outputSupported
        ? state.ttsEnabled
          ? "Voice Output On"
          : "Voice Output Off"
        : "Voice Output Unavailable",
      voiceOutputDisabled: !outputSupported
    }
  }

  if (state.authStatus === "refreshing") {
    return {
      status: "Refreshing your ThreadAtlas session...",
      placeholder: "Waiting for session refresh...",
      composerDisabled: true,
      composerReadOnly: false,
      micDisabled: true,
      micLabel: "Mic",
      voiceOutputLabel: outputSupported
        ? state.ttsEnabled
          ? "Voice Output On"
          : "Voice Output Off"
        : "Voice Output Unavailable",
      voiceOutputDisabled: !outputSupported
    }
  }

  if (!isConversationAuthReady()) {
    return {
      status: state.authError ?? "Continue with Google to ask about the current page.",
      placeholder: "Sign in to ask about the current snapshot...",
      composerDisabled: true,
      composerReadOnly: false,
      micDisabled: true,
      micLabel: "Mic",
      voiceOutputLabel: outputSupported
        ? state.ttsEnabled
          ? "Voice Output On"
          : "Voice Output Off"
        : "Voice Output Unavailable",
      voiceOutputDisabled: !outputSupported
    }
  }

  if (state.phase === "opening-session" || state.phase === "sending-intent") {
    return {
      status: "Sending your question to the current-page runtime...",
      placeholder: "Waiting for the current turn to start...",
      composerDisabled: true,
      composerReadOnly: false,
      micDisabled: true,
      micLabel: "Mic",
      voiceOutputLabel: outputSupported
        ? state.ttsEnabled
          ? "Voice Output On"
          : "Voice Output Off"
        : "Voice Output Unavailable",
      voiceOutputDisabled: !outputSupported
    }
  }

  if (state.phase === "waiting-enrich") {
    return {
      status: "Gathering more page context before answering...",
      placeholder: "Waiting for enrich to finish...",
      composerDisabled: true,
      composerReadOnly: false,
      micDisabled: true,
      micLabel: "Mic",
      voiceOutputLabel: outputSupported
        ? state.ttsEnabled
          ? "Voice Output On"
          : "Voice Output Off"
        : "Voice Output Unavailable",
      voiceOutputDisabled: !outputSupported
    }
  }

  if (state.phase === "resuming-turn") {
    return {
      status: "Finishing the current answer...",
      placeholder: "Waiting for the answer to complete...",
      composerDisabled: true,
      composerReadOnly: false,
      micDisabled: true,
      micLabel: "Mic",
      voiceOutputLabel: outputSupported
        ? state.ttsEnabled
          ? "Voice Output On"
          : "Voice Output Off"
        : "Voice Output Unavailable",
      voiceOutputDisabled: !outputSupported
    }
  }

  if (isSpeechListening()) {
    return {
      status: "Listening for a single utterance. Tap Stop to send it automatically.",
      placeholder: "Listening...",
      composerDisabled: false,
      composerReadOnly: true,
      micDisabled: false,
      micLabel: "Stop",
      voiceOutputLabel: outputSupported
        ? state.ttsEnabled
          ? "Voice Output On"
          : "Voice Output Off"
        : "Voice Output Unavailable",
      voiceOutputDisabled: !outputSupported
    }
  }

  if (isSpeechProcessing()) {
    return {
      status: "Processing the captured voice input...",
      placeholder: "Waiting for the current voice turn to finish...",
      composerDisabled: false,
      composerReadOnly: true,
      micDisabled: true,
      micLabel: "Processing...",
      voiceOutputLabel: outputSupported
        ? state.ttsEnabled
          ? "Voice Output On"
          : "Voice Output Off"
        : "Voice Output Unavailable",
      voiceOutputDisabled: !outputSupported
    }
  }

  if (state.lastRuntimeError) {
    return {
      status: `Last runtime error: ${state.lastRuntimeError.message}`,
      placeholder: "Ask a follow-up about the current snapshot...",
      composerDisabled: false,
      composerReadOnly: false,
      micDisabled: !inputSupported,
      micLabel: "Mic",
      voiceOutputLabel: outputSupported
        ? state.ttsEnabled
          ? "Voice Output On"
          : "Voice Output Off"
        : "Voice Output Unavailable",
      voiceOutputDisabled: !outputSupported
    }
  }

  if (shouldShowSpeechError()) {
    return {
      status: `Voice input error: ${state.speechInputDetail}`,
      placeholder: "Ask about the current snapshot...",
      composerDisabled: false,
      composerReadOnly: false,
      micDisabled: !inputSupported,
      micLabel: "Retry Mic",
      voiceOutputLabel: outputSupported
        ? state.ttsEnabled
          ? "Voice Output On"
          : "Voice Output Off"
        : "Voice Output Unavailable",
      voiceOutputDisabled: !outputSupported
    }
  }

  if (state.phase === "dormant") {
    return {
      status: "Semantic capture is not available on this page.",
      placeholder: "Open a supported page to ask questions.",
      composerDisabled: true,
      composerReadOnly: false,
      micDisabled: true,
      micLabel: "Mic",
      voiceOutputLabel: outputSupported
        ? state.ttsEnabled
          ? "Voice Output On"
          : "Voice Output Off"
        : "Voice Output Unavailable",
      voiceOutputDisabled: !outputSupported
    }
  }

  if (!inputSupported) {
    return {
      status: "Ask about the current semantic snapshot. Voice input is unavailable in this browser.",
      placeholder: "Ask about the current snapshot...",
      composerDisabled: false,
      composerReadOnly: false,
      micDisabled: true,
      micLabel: "Mic Unavailable",
      voiceOutputLabel: outputSupported
        ? state.ttsEnabled
          ? "Voice Output On"
          : "Voice Output Off"
        : "Voice Output Unavailable",
      voiceOutputDisabled: !outputSupported
    }
  }

  return {
    status: "Ask about the current semantic snapshot.",
    placeholder: "Ask about the current snapshot...",
    composerDisabled: false,
    composerReadOnly: false,
    micDisabled: false,
    micLabel: "Mic",
    voiceOutputLabel: outputSupported
      ? state.ttsEnabled
        ? "Voice Output On"
        : "Voice Output Off"
      : "Voice Output Unavailable",
    voiceOutputDisabled: !outputSupported
  }
}

function renderConversationState(): void {
  const availability = getConversationStatus()
  renderConversation({
    messages: state.conversationMessages,
    composerValue: state.composerText,
    status: availability.status,
    composerDisabled: availability.composerDisabled,
    composerReadOnly: availability.composerReadOnly,
    submitDisabled:
      availability.composerDisabled ||
      availability.composerReadOnly ||
      state.composerText.trim().length === 0,
    micDisabled: availability.micDisabled,
    micLabel: availability.micLabel,
    voiceOutputEnabled: state.ttsEnabled,
    voiceOutputDisabled: availability.voiceOutputDisabled,
    voiceOutputLabel: availability.voiceOutputLabel,
    placeholder: availability.placeholder
  })
}

function appendConversationMessage(message: TranscriptMessage): void {
  state.conversationMessages = [
    ...state.conversationMessages,
    {
      ...message,
      id: message.id ?? globalThis.crypto?.randomUUID?.() ?? `msg-${Date.now()}`
    }
  ]
  renderConversationState()
}

function upsertConversationMessage(message: TranscriptMessage & { id: string }): void {
  const existingIndex = state.conversationMessages.findIndex((item) => item.id === message.id)
  if (existingIndex === -1) {
    state.conversationMessages = [...state.conversationMessages, message]
  } else {
    const next = [...state.conversationMessages]
    next[existingIndex] = {
      ...next[existingIndex],
      ...message
    }
    state.conversationMessages = next
  }
  renderConversationState()
}

function removeConversationMessage(id: string | null): void {
  if (!id) {
    return
  }
  state.conversationMessages = state.conversationMessages.filter((item) => item.id !== id)
  renderConversationState()
}

function resetConversationSurface(): void {
  state.conversationMessages = []
  setComposerDraft("")
  resetSpeechInputState()
  clearTurnOrigin()
  resetVoiceTranscriptState()
  clearSuggestChips()
  clearPresent()
  renderConversationState()
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
  renderConversationState()
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

async function handleRuntimeToolRequest(
  event: RuntimeToolRequestEvent
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
    if (projection) {
      await applyProjectionSideEffects(projection)
    }
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

async function startVoiceCapture(): Promise<void> {
  const controller = state.conversationController
  if (!controller?.inputSupported) {
    showNotify("Voice input is unavailable in this browser.", "info")
    return
  }

  if (!isConversationAuthReady()) {
    showNotify("Sign in with Google before starting voice input.", "info")
    return
  }

  if (state.activeTabId === null) {
    showNotify("No active tab context.", "error")
    return
  }

  if (!getConversationSnapshot()) {
    showNotify("Capture a semantic snapshot before starting voice input.", "info")
    return
  }

  if (hasActiveRuntimeTurn()) {
    showNotify("Wait for the current answer to finish.", "info")
    return
  }

  if (isSpeechListening() || isSpeechProcessing()) {
    return
  }

  state.lastRuntimeError = null
  clearSuggestChips()
  clearPresent()
  setComposerDraft("")
  state.pendingTurnOrigin = "voice"
  state.currentTurnOrigin = null
  await state.conversationController?.transport.interrupt("superseded-by-voice-turn")
  await interruptVoiceSession("restart-voice-turn")

  const snapshot = getConversationSnapshot()
  if (!snapshot || state.activeTabId === null) {
    return
  }

  try {
    state.runtimeSnapshot = snapshot
    await controller.startVoiceTurn({
      activeTabId: state.activeTabId,
      snapshot,
      language: window.navigator.language
    })
    renderConversationState()
  } catch (error) {
    state.speechInputState = "error"
    state.speechInputDetail =
      error instanceof Error ? error.message : "Voice capture could not be started."
    showNotify(state.speechInputDetail, "error")
    renderConversationState()
  }
}

async function finishVoiceCapture(): Promise<void> {
  if (!isSpeechListening()) {
    return
  }

  await state.conversationController?.finishVoiceTurn()
  renderConversationState()
}

async function cancelVoiceCapture(): Promise<void> {
  if (!isSpeechListening() && !isSpeechProcessing()) {
    return
  }
  await interruptVoiceSession("cancelled")
  renderConversationState()
}

function toggleVoiceOutput(): void {
  if (!state.conversationController?.outputSupported) {
    showNotify("Voice output is unavailable in this browser.", "info")
    return
  }

  state.ttsEnabled = !state.ttsEnabled
  persistTtsEnabled()
  state.conversationController.setVoiceOutputEnabled(state.ttsEnabled)
  renderConversationState()
}

function splitSuggestOptions(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4)
}

async function applyProjectionSideEffects(projection: Projection): Promise<void> {
  routeProjection(projection, {
    respond() {
      // Text and live transcript rendering are handled at their respective transport layers.
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

async function executeProjection(projection: Projection): Promise<void> {
  routeProjection(projection, {
    respond(payload) {
      appendConversationMessage({
        role: "assistant",
        text: payload.text
      })

      if (payload.mode === "suggest") {
        const options = splitSuggestOptions(payload.text)
        showSuggestChips(options, (choice) => {
          void submitTextPrompt(choice, "text")
        })
        return
      }

      clearSuggestChips()
    },
    focus(projection) {
      void applyProjectionSideEffects(projection)
    },
    navigate(payload) {
      void applyProjectionSideEffects({
        type: "navigate",
        payload
      })
    },
    present(payload) {
      void applyProjectionSideEffects({
        type: "present",
        payload
      })
    },
    notify(payload) {
      void applyProjectionSideEffects({
        type: "notify",
        payload
      })
    },
    copy(payload) {
      void applyProjectionSideEffects({
        type: "copy",
        payload
      })
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

  const snapshot = state.runtimeSnapshot ?? getSelectedSemanticSnapshot()
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
  const nodeText = getSemanticNodeText(snapshot.focus.node)
  const selectedTargetText =
    state.selectedTarget?.regionId === snapshot.focus.region ? state.selectedTarget.text.trim() : ""
  const text = selectedTargetText || nodeText
  const detail: Record<string, unknown> = {
    captureScope: request.requestKind,
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

  if (request.requestKind === "node-detail") {
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

function createConversationController(): ConversationController {
  return new ConversationController({
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
        setPhase(phase)
      },
      onSpeechStateChange(speechState, detail) {
        state.speechInputState = speechState
        state.speechInputDetail = detail ?? null
        renderConversationState()
      },
      onSessionReady(event) {
        state.sessionId = event.payload.sessionId
        state.clientSessionId = event.payload.clientSessionId
        state.lastRuntimeError = null
      },
      onTurnStarted(event) {
        state.activeTurnId = event.turnId
        state.lastRuntimeError = null
        state.currentTurnOrigin = event.payload.modality
        state.pendingTurnOrigin = null
        renderConversationState()
      },
      onInputTranscript(text, final, event) {
        if (state.currentTurnOrigin === "voice") {
          upsertVoiceUserTranscript(text, final)
          return
        }

        upsertConversationMessage({
          id: `turn-user-${event.turnId}`,
          role: "user",
          text,
          pending: !final
        })
      },
      onOutputTranscript(text, final) {
        if (state.currentTurnOrigin !== "voice") {
          return
        }
        upsertVoiceAssistantTranscript(text, final)
      },
      onProjection(projection) {
        if (state.currentTurnOrigin === "voice" && projection.type === "respond") {
          return
        }
        void executeProjection(projection)
      },
      async onToolRequest(event) {
        state.pendingEnrichRequest = event
        renderConversationState()
        try {
          return await handleRuntimeToolRequest(event)
        } finally {
          state.pendingEnrichRequest = null
          renderConversationState()
        }
      },
      onTurnDone() {
        state.activeTurnId = null
        state.pendingEnrichRequest = null
        state.lastRuntimeError = null
        state.runtimeSnapshot = null
        resetVoiceTranscriptState()
        clearTurnOrigin()
        renderConversationState()
      },
      onError(error) {
        state.activeTurnId = null
        state.pendingEnrichRequest = null
        state.lastRuntimeError = error
        state.runtimeSnapshot = null
        resetVoiceTranscriptState()
        clearTurnOrigin()
        stopLiveAudioOutput()
        showNotify(error.message, "error")
        renderConversationState()
      }
    }
  })
}

async function submitTextPrompt(prompt: string, origin: TurnOrigin = "text"): Promise<void> {
  const normalized = prompt.trim()
  if (!normalized) {
    return
  }

  if (!isConversationAuthReady()) {
    showNotify("Sign in with Google before asking about the current page.", "info")
    return
  }

  if (state.activeTabId === null) {
    showNotify("No active tab context.", "error")
    return
  }

  if (!getSelectedSemanticSnapshot()) {
    showNotify("Capture a semantic snapshot before asking a question.", "error")
    return
  }

  if (hasActiveRuntimeTurn()) {
    showNotify("Wait for the current answer to finish.", "info")
    return
  }

  await interruptVoiceSession("superseded-by-text-turn")
  setComposerDraft("")
  state.lastRuntimeError = null
  state.pendingTurnOrigin = origin
  state.currentTurnOrigin = null
  clearSuggestChips()
  clearPresent()
  state.runtimeSnapshot = getSelectedSemanticSnapshot()
  if (!state.runtimeSnapshot) {
    return
  }

  try {
    await state.conversationController?.sendTextTurn({
      activeTabId: state.activeTabId,
      snapshot: state.runtimeSnapshot,
      text: normalized,
      language: window.navigator.language
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "failed to send prompt to the unified runtime"
    state.activeTurnId = null
    state.pendingEnrichRequest = null
    state.runtimeSnapshot = null
    clearTurnOrigin()
    state.lastRuntimeError = {
      code: "GENERATION_FAILED",
      message
    }
    setPhase("error")
    showNotify(message, "error")
    renderConversationState()
  }
}

function registerRuntimeListeners(): void {
  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message: AnyRuntimeMessage) => {
      if (message.type === "ACTIVE_TAB_CHANGED") {
        const tabChanged = state.activeTabId !== message.payload.tabId
        if (tabChanged) {
          void interruptVoiceSession("active-tab-changed")
        }

        state.activeTabId = message.payload.tabId
        if (tabChanged) {
          state.activeTurnId = null
          state.pendingEnrichRequest = null
          state.lastRuntimeError = null
          state.runtimeSnapshot = null
          clearTurnOrigin()
          state.latestSemanticSnapshot = null
          state.latestRegionDump = null
          state.semanticSnapshotHistory = []
          state.selectedSemanticSnapshotId = null
          state.selectionEnabled = false
          state.selectedTarget = null
          resetConversationSurface()
          renderSemanticSnapshotState()
        }
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

      if (message.type === "AUTH_STATE_CHANGED") {
        applyAuthState(message.payload)
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

async function hydrateAuthState(): Promise<void> {
  applyAuthState(await authClient.getAuthState())
}

async function signInWithGoogle(): Promise<void> {
  const next = await authClient.signInWithGoogle()
  applyAuthState(next)
  if (next.status === "signed-in") {
    showNotify("Signed in with Google.", "success")
    return
  }
  if (next.errorMessage) {
    showNotify(next.errorMessage, next.status === "error" ? "error" : "info")
  }
}

async function signOut(): Promise<void> {
  const next = await authClient.signOut()
  applyAuthState(next)
  showNotify("Signed out.", "info")
}

async function initialize(): Promise<void> {
  setPhase("initializing")
  const config = await loadExtensionConfig(createChromeLocalStorage())
  state.apiBaseUrl = config.apiBaseUrl
  state.conversationController = createConversationController()
  state.conversationController.setVoiceOutputEnabled(state.ttsEnabled)
  resetSpeechInputState()
  bindAuthActions({
    onSignIn: () => {
      void signInWithGoogle()
    },
    onSignOut: () => {
      void signOut()
    }
  })
  bindConversationActions({
    onComposerInput: (value) => {
      setComposerDraft(value)
      if (state.speechInputState === "error") {
        resetSpeechInputState()
      }
      renderConversationState()
    },
    onSubmitPrompt: (prompt) => {
      void submitTextPrompt(prompt, "text")
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
    onToggleVoiceOutput: () => {
      toggleVoiceOutput()
    }
  })
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
  renderAuthState()
  renderSemanticSnapshotState()
  renderConversationState()
  registerRuntimeListeners()
  await Promise.all([hydrateActiveTabState(), hydrateAuthState()])
  window.addEventListener("beforeunload", () => {
    void state.conversationController?.close()
  })
}

void initialize().catch((error) => {
  setPhase("error")
  showNotify(error instanceof Error ? error.message : "failed to initialize", "error")
})
