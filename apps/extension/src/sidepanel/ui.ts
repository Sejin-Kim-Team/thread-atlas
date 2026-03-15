import type {
  CommentNode,
  ContentNode,
  ContextRelation,
  InteractiveNode,
  PresentContent,
  SemanticSnapshot,
  TokenUser
} from "@threadatlas/shared"
import type { ContextProjectionFormat, ContextTaskProfile } from "@threadatlas/shared/projection-policy"
import type { ExtensionAuthProvider, ExtensionAuthStatus } from "@threadatlas/shared/runtime"
import type { SemanticSelectionTarget } from "@threadatlas/shared/runtime"

export type Phase =
  | "initializing"
  | "ready"
  | "opening-session"
  | "sending-intent"
  | "waiting-enrich"
  | "resuming-turn"
  | "dormant"
  | "error"

const PHASE_COLORS: Record<Phase, string> = {
  initializing: "#eab308",
  ready: "#16a34a",
  "opening-session": "#0ea5e9",
  "sending-intent": "#2563eb",
  "waiting-enrich": "#f59e0b",
  "resuming-turn": "#0f766e",
  dormant: "#64748b",
  error: "#dc2626"
}

const PHASE_LABELS: Record<Phase, string> = {
  initializing: "analyzing",
  ready: "ready",
  "opening-session": "opening session",
  "sending-intent": "sending intent",
  "waiting-enrich": "waiting enrich",
  "resuming-turn": "resuming turn",
  dormant: "dormant",
  error: "error"
}

const CONTEXT_RELATIONS: ContextRelation[] = [
  "parent",
  "child",
  "sibling",
  "container",
  "ancestor"
]

export interface DisabledContextProfileReason {
  profile: ContextTaskProfile
  reason: string
}

export interface SemanticDebugInfo {
  regionId: string
  primitive: string
  subtype: string
  category: string
  layoutRole: string
  roleRank: string
  suppression: string
  normalizedKind: string
  assembledItemCount: string
  signals: string
  note?: string
}

export interface ConversationMessage {
  id?: string
  role: "user" | "assistant"
  text: string
  pending?: boolean
}

function getAuthDisplayName(user: TokenUser | null): string {
  return user?.displayName ?? user?.primaryEmail ?? "Signed in"
}

function getAuthFallbackInitials(user: TokenUser | null): string {
  const source = getAuthDisplayName(user).trim()
  if (!source) {
    return "TA"
  }
  const parts = source.split(/\s+/).filter(Boolean)
  const initials = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")
  return (initials || source.slice(0, 2) || "TA").toUpperCase()
}

export function bindAuthActions(args: {
  onSignIn: () => void
  onSignOut: () => void
}): void {
  const signInButton = document.getElementById("auth-sign-in-button") as HTMLButtonElement | null
  const signOutButton = document.getElementById("auth-sign-out-button") as HTMLButtonElement | null
  signInButton?.addEventListener("click", args.onSignIn)
  signOutButton?.addEventListener("click", args.onSignOut)
}

export function renderAuthCard(args: {
  status: ExtensionAuthStatus
  provider: ExtensionAuthProvider | null
  user: TokenUser | null
  errorMessage: string | null
}): void {
  const copy = document.getElementById("auth-copy")
  const userRoot = document.getElementById("auth-user")
  const avatar = document.getElementById("auth-avatar") as HTMLImageElement | null
  const avatarFallback = document.getElementById("auth-avatar-fallback")
  const userName = document.getElementById("auth-user-name")
  const userEmail = document.getElementById("auth-user-email")
  const signInButton = document.getElementById("auth-sign-in-button") as HTMLButtonElement | null
  const signOutButton = document.getElementById("auth-sign-out-button") as HTMLButtonElement | null
  if (
    !copy ||
    !userRoot ||
    !avatar ||
    !avatarFallback ||
    !userName ||
    !userEmail ||
    !signInButton ||
    !signOutButton
  ) {
    return
  }

  userName.textContent = args.user ? getAuthDisplayName(args.user) : ""
  userEmail.textContent = args.user?.primaryEmail ?? ""
  avatarFallback.textContent = getAuthFallbackInitials(args.user)
  avatar.classList.toggle("hidden-inline", !args.user?.avatarUrl)
  avatarFallback.classList.toggle("hidden-inline", Boolean(args.user?.avatarUrl))
  if (args.user?.avatarUrl) {
    avatar.src = args.user.avatarUrl
    avatar.alt = `${getAuthDisplayName(args.user)} avatar`
  } else {
    avatar.removeAttribute("src")
    avatar.alt = ""
  }

  signInButton.disabled = args.status === "signing-in" || args.status === "refreshing"
  signOutButton.disabled = args.status === "signing-in" || args.status === "refreshing"

  userRoot.classList.toggle("hidden-inline", !(args.status === "signed-in" && args.user))
  signOutButton.classList.toggle("hidden-inline", args.status !== "signed-in" || !args.user)

  if (args.status === "signed-in" && args.user) {
    copy.textContent =
      args.provider === "dev-bootstrap"
        ? "Internal preview session is active."
        : "Signed in. You can now ask about the current page."
    signInButton.classList.add("hidden-inline")
    signInButton.textContent = "Continue with Google"
    return
  }

  signInButton.classList.remove("hidden-inline")
  if (args.status === "signing-in") {
    copy.textContent = "Signing in with Google..."
    signInButton.textContent = "Signing in..."
    return
  }
  if (args.status === "refreshing") {
    copy.textContent = "Refreshing your ThreadAtlas session..."
    signInButton.textContent = "Refreshing..."
    return
  }
  if (args.status === "error") {
    copy.textContent = args.errorMessage ?? "Google sign-in failed. Try again."
    signInButton.textContent = "Retry Google Sign-In"
    return
  }

  copy.textContent =
    args.errorMessage ?? "Sign in with Google to ask questions about the current page."
  signInButton.textContent = "Continue with Google"
}

function setText(id: string, value: string): void {
  const element = document.getElementById(id)
  if (!element) {
    return
  }

  element.textContent = value
}

function createValue(label: string, value: string): HTMLDivElement {
  const wrapper = document.createElement("div")
  const labelElement = document.createElement("div")
  labelElement.className = "snapshot-label"
  labelElement.textContent = label
  const valueElement = document.createElement("div")
  valueElement.className = "snapshot-value"
  valueElement.textContent = value
  wrapper.append(labelElement, valueElement)
  return wrapper
}

function isCommentNode(node: ContentNode | CommentNode): node is CommentNode {
  return node.kind === "comment"
}

function isInteractiveNode(node: ContentNode | CommentNode | InteractiveNode): node is InteractiveNode {
  return node.kind === "interactive"
}

function getNodeText(node: ContentNode | CommentNode | InteractiveNode): string {
  if (node.kind !== "interactive") {
    return node.text || "(empty)"
  }

  return node.label ?? node.valuePreview ?? "(empty)"
}

function renderPageSummary(snapshot: SemanticSnapshot | null): void {
  const root = document.getElementById("semantic-page-summary")
  if (!root) {
    return
  }

  root.innerHTML = ""
  if (!snapshot) {
    root.appendChild(createValue("State", "No semantic snapshot selected"))
    return
  }

  root.appendChild(createValue("Title", snapshot.page.title ?? "(untitled)"))
  root.appendChild(createValue("URL", snapshot.page.url))
  root.appendChild(createValue("Kind", snapshot.page.kind))
}

function renderFocusDetail(snapshot: SemanticSnapshot | null): void {
  const root = document.getElementById("semantic-focus-detail")
  if (!root) {
    return
  }

  root.innerHTML = ""
  if (!snapshot) {
    root.appendChild(createValue("Focus", "No focus"))
    return
  }

  const node = snapshot.focus.node
  root.appendChild(createValue("Node", snapshot.focus.nodeId))
  root.appendChild(createValue("Region", snapshot.focus.region))
  root.appendChild(createValue("Text", getNodeText(node)))

  if (!isInteractiveNode(node) && isCommentNode(node)) {
    root.appendChild(createValue("Author", node.author ?? "(unknown)"))
    root.appendChild(createValue("Timestamp", node.timestamp ?? "(unknown)"))
    root.appendChild(createValue("Depth", String(node.depth)))
  } else if (isInteractiveNode(node)) {
    root.appendChild(createValue("Type", node.controlType))
    root.appendChild(createValue("Label", node.label ?? "(none)"))
    root.appendChild(createValue("Action", node.action ?? "(unknown)"))
    root.appendChild(createValue("State", node.state ?? "(none)"))
    root.appendChild(createValue("Value", node.valuePreview ?? "(none)"))
  } else {
    root.appendChild(createValue("Type", node.type))
    if (node.level) {
      root.appendChild(createValue("Level", String(node.level)))
    }
  }
}

function renderContextGroups(snapshot: SemanticSnapshot | null): void {
  const root = document.getElementById("semantic-context-groups")
  if (!root) {
    return
  }

  root.innerHTML = ""
  if (!snapshot || snapshot.context.length === 0) {
    root.appendChild(createValue("Context", "No related context"))
    return
  }

  for (const relation of CONTEXT_RELATIONS) {
    const group = snapshot.context.filter((slice) => slice.relation === relation)
    if (group.length === 0) {
      continue
    }

    const section = document.createElement("div")
    const label = document.createElement("div")
    label.className = "snapshot-label"
    label.textContent = relation
    section.appendChild(label)

    for (const slice of group) {
      const value = document.createElement("div")
      value.className = "snapshot-value"
      value.textContent = getNodeText(slice.node)
      section.appendChild(value)
    }

    root.appendChild(section)
  }
}

function renderHistory(history: SemanticSnapshot[], selectedSnapshotId: string | null): void {
  const root = document.getElementById("semantic-history-list")
  if (!root) {
    return
  }

  root.innerHTML = ""
  if (history.length === 0) {
    root.appendChild(createValue("History", "No snapshots in this tab yet"))
    return
  }

  for (const snapshot of history) {
    const button = document.createElement("button")
    button.type = "button"
    button.className = "history-item"
    button.dataset.snapshotId = snapshot.meta.capturedAt
    if (snapshot.meta.capturedAt === selectedSnapshotId) {
      button.classList.add("active")
    }

    const title = snapshot.page.title ?? snapshot.page.url
    button.textContent = `${snapshot.meta.capturedAt} · ${snapshot.focus.region} · ${title}`
    root.appendChild(button)
  }
}

function renderRawSnapshot(snapshot: SemanticSnapshot | null, rawVisible: boolean): void {
  const output = document.getElementById("semantic-snapshot-json")
  const toggleButton = document.getElementById("semantic-raw-toggle-button")
  if (!output || !toggleButton) {
    return
  }

  output.textContent = snapshot ? JSON.stringify(snapshot, null, 2) : ""
  output.classList.toggle("hidden", !rawVisible)
  toggleButton.textContent = rawVisible ? "Hide Raw JSON" : "Show Raw JSON"
}

function renderSelectionDetail(
  enabled: boolean,
  selectedTarget: SemanticSelectionTarget | null,
  snapshot: SemanticSnapshot | null,
  resolutionNote?: string | null
): void {
  const status = document.getElementById("semantic-selection-status")
  const detail = document.getElementById("semantic-selection-detail")
  const clearButton = document.getElementById("semantic-selection-clear-button") as HTMLButtonElement | null
  if (!status || !detail || !clearButton) {
    return
  }

  clearButton.disabled = selectedTarget === null
  detail.innerHTML = ""

  if (!enabled) {
    status.textContent = "Selection mode is off."
    detail.appendChild(createValue("State", "No semantic node selected"))
    return
  }

  status.textContent = selectedTarget ? "Selection mode is on." : "Selection mode is on. Click a semantic node to select it."
  if (!selectedTarget) {
    detail.appendChild(createValue("State", "No semantic node selected"))
    return
  }

  detail.appendChild(createValue("Label", selectedTarget.displayLabel))
  detail.appendChild(createValue("Region", selectedTarget.regionId))
  detail.appendChild(createValue("Primitive", selectedTarget.primitive))
  if (selectedTarget.subtype) {
    detail.appendChild(createValue("Subtype", selectedTarget.subtype))
  }
  detail.appendChild(createValue("Category", selectedTarget.category))
  if (selectedTarget.nodeId) {
    detail.appendChild(createValue("Node", selectedTarget.nodeId))
  }
  if (selectedTarget.scopeRootId) {
    detail.appendChild(createValue("Scope Root", selectedTarget.scopeRootId))
  }
  if (selectedTarget.rootNodeId) {
    detail.appendChild(createValue("Root Node", selectedTarget.rootNodeId))
  }
  if (snapshot?.meta.coverage) {
    detail.appendChild(createValue("Coverage", snapshot.meta.coverage.kind))
    detail.appendChild(createValue("Captured Nodes", String(snapshot.meta.coverage.capturedNodeCount)))
    detail.appendChild(createValue("Omitted Nodes", String(snapshot.meta.coverage.omittedNodeCount)))
    detail.appendChild(createValue("Omitted Roots", String(snapshot.meta.coverage.omittedRootCount)))
  }
  if (resolutionNote) {
    detail.appendChild(createValue("Resolution", resolutionNote))
  }
  detail.appendChild(createValue("Text", selectedTarget.text || "(empty)"))
}

function renderDebugDetail(debugStatus: string, debugInfo: SemanticDebugInfo | null): void {
  const status = document.getElementById("semantic-debug-status")
  const detail = document.getElementById("semantic-debug-detail")
  if (!status || !detail) {
    return
  }

  status.textContent = debugStatus
  detail.innerHTML = ""

  if (!debugInfo) {
    detail.appendChild(createValue("State", debugStatus))
    return
  }

  detail.appendChild(createValue("Region", debugInfo.regionId))
  detail.appendChild(createValue("Primitive", debugInfo.primitive))
  detail.appendChild(createValue("Subtype", debugInfo.subtype))
  detail.appendChild(createValue("Category", debugInfo.category))
  detail.appendChild(createValue("Layout Role", debugInfo.layoutRole))
  detail.appendChild(createValue("Role Rank", debugInfo.roleRank))
  detail.appendChild(createValue("Suppression", debugInfo.suppression))
  detail.appendChild(createValue("Normalized", debugInfo.normalizedKind))
  detail.appendChild(createValue("Assembled Items", debugInfo.assembledItemCount))
  detail.appendChild(createValue("Signals", debugInfo.signals))
  if (debugInfo.note) {
    detail.appendChild(createValue("Note", debugInfo.note))
  }
}

function renderContextRestrictions(restrictions: DisabledContextProfileReason[]): void {
  const root = document.getElementById("semantic-context-restrictions")
  if (!root) {
    return
  }

  root.innerHTML = ""
  if (restrictions.length === 0) {
    return
  }

  for (const restriction of restrictions) {
    root.appendChild(createValue(restriction.profile, restriction.reason))
  }
}

export function updatePhaseIndicator(phase: Phase): void {
  const dot = document.getElementById("status-dot")
  const label = document.getElementById("status-label")
  if (!dot || !label) {
    return
  }

  dot.style.background = PHASE_COLORS[phase]
  label.textContent = PHASE_LABELS[phase]
}

export function renderPresent(content: PresentContent): void {
  const root = document.getElementById("present-root")
  if (!root) {
    return
  }

  root.innerHTML = ""
  const title = document.createElement("h3")
  title.textContent = content.title
  title.style.margin = "0 0 8px"
  title.style.fontSize = "14px"
  root.appendChild(title)

  const list = document.createElement("ul")
  list.style.margin = "0"
  list.style.paddingLeft = "16px"

  for (const item of content.items) {
    const li = document.createElement("li")
    li.textContent = `${item.source}: ${item.summary}`
    list.appendChild(li)
  }
  root.appendChild(list)
}

export function clearPresent(): void {
  const root = document.getElementById("present-root")
  if (!root) {
    return
  }

  root.innerHTML = ""
}

export function showNotify(message: string, _level: "status" | "info" | "success" | "error"): void {
  const root = document.getElementById("notify-root")
  if (!root) {
    return
  }

  root.textContent = message
  root.style.display = "block"

  window.setTimeout(() => {
    root.style.display = "none"
  }, 3000)
}

export function clearSuggestChips(): void {
  const root = document.getElementById("suggest-root")
  if (!root) {
    return
  }

  root.innerHTML = ""
}

export function showSuggestChips(
  options: string[],
  onSelect: (value: string) => void
): void {
  const root = document.getElementById("suggest-root")
  if (!root) {
    return
  }

  clearSuggestChips()

  for (const option of options) {
    const button = document.createElement("button")
    button.className = "chip"
    button.textContent = option
    button.type = "button"
    button.addEventListener("click", () => onSelect(option))
    root.appendChild(button)
  }
}

export function bindConversationActions(args: {
  onComposerInput: (value: string) => void
  onSubmitPrompt: (prompt: string) => void
  onStartMicPress: () => void
  onEndMicPress: () => void
  onCancelMicPress: () => void
  onToggleVoiceOutput: () => void
}): void {
  const composer = document.getElementById("conversation-input") as HTMLTextAreaElement | null
  const sendButton = document.getElementById("conversation-send-button") as HTMLButtonElement | null
  const micButton = document.getElementById("conversation-mic-button") as HTMLButtonElement | null
  const voiceOutputButton = document.getElementById("conversation-voice-output-button") as HTMLButtonElement | null
  if (!composer || !sendButton || !micButton || !voiceOutputButton) {
    return
  }

  composer.addEventListener("input", () => {
    args.onComposerInput(composer.value)
  })
  composer.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey) {
      return
    }

    event.preventDefault()
    args.onSubmitPrompt(composer.value)
  })
  sendButton.addEventListener("click", () => {
    args.onSubmitPrompt(composer.value)
  })
  micButton.addEventListener("pointerdown", (event) => {
    event.preventDefault()
    if (typeof micButton.setPointerCapture === "function") {
      micButton.setPointerCapture(event.pointerId)
    }
    args.onStartMicPress()
  })
  micButton.addEventListener("pointerup", (event) => {
    event.preventDefault()
    if (typeof micButton.releasePointerCapture === "function" && micButton.hasPointerCapture(event.pointerId)) {
      micButton.releasePointerCapture(event.pointerId)
    }
    args.onEndMicPress()
  })
  micButton.addEventListener("pointercancel", () => {
    args.onCancelMicPress()
  })
  micButton.addEventListener("lostpointercapture", () => {
    args.onCancelMicPress()
  })
  voiceOutputButton.addEventListener("click", () => {
    args.onToggleVoiceOutput()
  })
}

export function bindSemanticSnapshotActions(args: {
  onCapture: () => void
  onCopy: () => void
  onCopyContext: () => void
  onToggleSelection: () => void
  onClearSelection: () => void
  onToggleRaw: () => void
  onSelectHistory: (snapshotId: string) => void
  onSelectContextProfile: (profile: ContextTaskProfile) => void
  onSelectContextFormat: (format: ContextProjectionFormat) => void
}): void {
  const captureButton = document.getElementById("semantic-capture-button") as HTMLButtonElement | null
  const copyButton = document.getElementById("semantic-copy-button") as HTMLButtonElement | null
  const copyContextButton = document.getElementById("semantic-context-copy-button") as HTMLButtonElement | null
  const selectionButton = document.getElementById("semantic-selection-button") as HTMLButtonElement | null
  const clearSelectionButton = document.getElementById("semantic-selection-clear-button") as HTMLButtonElement | null
  const rawToggleButton = document.getElementById("semantic-raw-toggle-button") as HTMLButtonElement | null
  const contextProfile = document.getElementById("semantic-context-profile") as HTMLSelectElement | null
  const contextPackTab = document.getElementById("semantic-context-pack-tab") as HTMLButtonElement | null
  const compactTab = document.getElementById("semantic-context-compact-tab") as HTMLButtonElement | null
  const linearTab = document.getElementById("semantic-context-linear-tab") as HTMLButtonElement | null
  const historyRoot = document.getElementById("semantic-history-list")

  captureButton?.addEventListener("click", args.onCapture)
  copyButton?.addEventListener("click", args.onCopy)
  copyContextButton?.addEventListener("click", args.onCopyContext)
  selectionButton?.addEventListener("click", args.onToggleSelection)
  clearSelectionButton?.addEventListener("click", args.onClearSelection)
  rawToggleButton?.addEventListener("click", args.onToggleRaw)
  contextProfile?.addEventListener("change", () => {
    args.onSelectContextProfile(contextProfile.value as ContextTaskProfile)
  })
  contextPackTab?.addEventListener("click", () => {
    args.onSelectContextFormat("context-pack-json")
  })
  compactTab?.addEventListener("click", () => {
    args.onSelectContextFormat("compact-json")
  })
  linearTab?.addEventListener("click", () => {
    args.onSelectContextFormat("linear-text")
  })
  historyRoot?.addEventListener("click", (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) {
      return
    }

    const button = target.closest("[data-snapshot-id]") as HTMLButtonElement | null
    const snapshotId = button?.dataset.snapshotId
    if (snapshotId) {
      args.onSelectHistory(snapshotId)
    }
  })
}

export function setSemanticSnapshotBusy(isBusy: boolean): void {
  const captureButton = document.getElementById("semantic-capture-button") as HTMLButtonElement | null
  if (!captureButton) {
    return
  }

  captureButton.disabled = isBusy
  captureButton.textContent = isBusy ? "Capturing..." : "Capture Snapshot"
}

export function renderConversation(args: {
  messages: ConversationMessage[]
  composerValue: string
  status: string
  composerDisabled: boolean
  composerReadOnly?: boolean
  submitDisabled: boolean
  micDisabled?: boolean
  micLabel?: string
  voiceOutputEnabled?: boolean
  voiceOutputDisabled?: boolean
  voiceOutputLabel?: string
  placeholder?: string
}): void {
  const transcript = document.getElementById("conversation-transcript")
  const status = document.getElementById("conversation-status")
  const composer = document.getElementById("conversation-input") as HTMLTextAreaElement | null
  const sendButton = document.getElementById("conversation-send-button") as HTMLButtonElement | null
  const micButton = document.getElementById("conversation-mic-button") as HTMLButtonElement | null
  const voiceOutputButton = document.getElementById("conversation-voice-output-button") as HTMLButtonElement | null
  if (!transcript || !status || !composer || !sendButton || !micButton || !voiceOutputButton) {
    return
  }

  transcript.innerHTML = ""
  if (args.messages.length === 0) {
    const empty = document.createElement("div")
    empty.className = "conversation-empty"
    empty.textContent = "Capture a semantic snapshot, then ask about the current page."
    transcript.appendChild(empty)
  } else {
    for (const message of args.messages) {
      const item = document.createElement("div")
      item.className = `conversation-message conversation-${message.role}`
      if (message.pending) {
        item.classList.add("conversation-pending")
      }

      const label = document.createElement("div")
      label.className = "conversation-role"
      label.textContent = message.role === "user" ? "You" : "ThreadAtlas"

      const body = document.createElement("div")
      body.className = "conversation-text"
      body.textContent = message.text

      item.append(label, body)
      transcript.appendChild(item)
    }
  }

  status.textContent = args.status
  composer.value = args.composerValue
  composer.disabled = args.composerDisabled
  composer.readOnly = args.composerReadOnly ?? false
  composer.placeholder = args.placeholder ?? "Ask about the current snapshot..."
  sendButton.disabled = args.submitDisabled
  micButton.disabled = args.micDisabled ?? false
  micButton.textContent = args.micLabel ?? "Mic"
  voiceOutputButton.disabled = args.voiceOutputDisabled ?? false
  voiceOutputButton.textContent = args.voiceOutputLabel ?? (args.voiceOutputEnabled === false ? "Voice Output Off" : "Voice Output On")
  voiceOutputButton.classList.toggle("active-toggle", args.voiceOutputEnabled !== false)
  voiceOutputButton.setAttribute("aria-pressed", args.voiceOutputEnabled === false ? "false" : "true")
}

export function renderSemanticSnapshot(args: {
  snapshot: SemanticSnapshot | null
  error: string | null
  history: SemanticSnapshot[]
  selectedSnapshotId: string | null
  rawVisible: boolean
  selectionEnabled: boolean
  selectedTarget: SemanticSelectionTarget | null
  contextProfile: ContextTaskProfile
  contextFormat: ContextProjectionFormat
  contextPreview: string
  contextAvailable: boolean
  contextStatus: string
  contextRestrictions?: DisabledContextProfileReason[]
  selectionResolutionNote?: string | null
  debugStatus?: string
  debugInfo?: SemanticDebugInfo | null
}): void {
  const status = document.getElementById("semantic-snapshot-status")
  const selectionButton = document.getElementById("semantic-selection-button")
  const contextProfile = document.getElementById("semantic-context-profile") as HTMLSelectElement | null
  const contextStatus = document.getElementById("semantic-context-status")
  const contextPreview = document.getElementById("semantic-context-preview")
  const contextCopyButton = document.getElementById("semantic-context-copy-button") as HTMLButtonElement | null
  const contextPackTab = document.getElementById("semantic-context-pack-tab")
  const compactTab = document.getElementById("semantic-context-compact-tab")
  const linearTab = document.getElementById("semantic-context-linear-tab")
  if (
    !status ||
    !selectionButton ||
    !contextProfile ||
    !contextStatus ||
    !contextPreview ||
    !contextCopyButton ||
    !contextPackTab ||
    !compactTab ||
    !linearTab
  ) {
    return
  }

  const {
    snapshot,
    error,
    history,
    selectedSnapshotId,
    rawVisible,
    selectionEnabled,
    selectedTarget,
    contextAvailable,
    contextRestrictions = [],
    selectionResolutionNote = null
  } = args
  if (snapshot) {
    status.textContent = error ? `Captured with warning: ${error}` : "Latest semantic snapshot"
  } else if (error) {
    status.textContent = error
  } else {
    status.textContent = "No semantic snapshot captured yet."
  }

  selectionButton.textContent = selectionEnabled ? "Selection On" : "Selection Off"
  renderPageSummary(snapshot)
  renderFocusDetail(snapshot)
  renderContextGroups(snapshot)
  renderHistory(history, selectedSnapshotId)
  renderRawSnapshot(snapshot, rawVisible)
  renderSelectionDetail(selectionEnabled, selectedTarget, snapshot, selectionResolutionNote)
  renderDebugDetail(args.debugStatus ?? "No region dump loaded.", args.debugInfo ?? null)
  renderContextRestrictions(contextRestrictions)

  contextProfile.value = args.contextProfile
  for (const option of Array.from(contextProfile.options)) {
    option.disabled = contextRestrictions.some((restriction) => restriction.profile === option.value)
  }
  contextStatus.textContent = args.contextStatus
  contextPreview.textContent = args.contextPreview
  contextCopyButton.disabled = !contextAvailable
  contextPackTab.classList.toggle("active", args.contextFormat === "context-pack-json")
  compactTab.classList.toggle("active", args.contextFormat === "compact-json")
  linearTab.classList.toggle("active", args.contextFormat === "linear-text")
}

export function selectSnapshotById(
  history: SemanticSnapshot[],
  selectedSnapshotId: string | null,
  latestSnapshot: SemanticSnapshot | null
): SemanticSnapshot | null {
  if (selectedSnapshotId) {
    const selected = history.find((snapshot) => snapshot.meta.capturedAt === selectedSnapshotId)
    if (selected) {
      return selected
    }
  }

  return history[0] ?? latestSnapshot
}
