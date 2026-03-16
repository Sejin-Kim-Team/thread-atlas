import type { PresentContent, TokenUser } from "@threadatlas/shared"
import type { ConsumerShellViewState, ConsumerVoiceActivityState } from "./view-state"
import { renderAssistantMarkdownFragment } from "./markdown"

export interface ConsumerConversationMessage {
  id: string
  role: "user" | "assistant"
  text: string
  pending?: boolean
  turnId?: string | null
  provenanceSummary?: string[]
  actions?: {
    copyText?: string
    highlight?: boolean
    showContext?: boolean
  }
}

const TRANSCRIPT_BOTTOM_THRESHOLD_PX = 48

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

function getElement<T extends Element>(id: string): T | null {
  return document.getElementById(id) as T | null
}

function getTranscriptScrollRoot(): HTMLDivElement | null {
  return getElement<HTMLDivElement>("consumer-transcript-scroll")
}

function createWavePath(levels: number[], mode: ConsumerVoiceActivityState): string {
  const width = 240
  const height = 24
  const baseline = height / 2
  const safeLevels =
    levels.length > 1
      ? levels
      : mode === "thinking"
        ? [0.08, 0.11, 0.08, 0.11, 0.08, 0.11, 0.08, 0.11]
        : [0, 0, 0, 0, 0, 0, 0, 0]
  const step = width / Math.max(1, safeLevels.length - 1)
  return safeLevels
    .map((level, index) => {
      const amplitude = mode === "thinking" ? 2 + level * 5 : 1 + level * 10
      const phase = index % 2 === 0 ? -1 : 1
      const y = baseline + amplitude * phase
      return `${index === 0 ? "M" : "L"} ${Math.round(index * step)} ${Math.round(y)}`
    })
    .join(" ")
}

function createAssistantMessageBody(message: ConsumerConversationMessage): HTMLDivElement {
  const body = document.createElement("div")
  body.className = "consumer-message-text consumer-message-markdown"
  const fragment = renderAssistantMarkdownFragment(message.text)
  if (!fragment.hasChildNodes()) {
    body.textContent = message.text
    return body
  }
  body.appendChild(fragment)
  return body
}

function createUserMessageBody(message: ConsumerConversationMessage): HTMLDivElement {
  const body = document.createElement("div")
  body.className = "consumer-message-text consumer-message-plain"
  body.textContent = message.text
  return body
}

function renderTranscript(messages: ConsumerConversationMessage[]): void {
  const root = getElement<HTMLDivElement>("consumer-transcript")
  if (!root) {
    return
  }

  root.innerHTML = ""
  if (messages.length === 0) {
    const empty = document.createElement("div")
    empty.className = "consumer-empty"
    empty.textContent = "Ask what matters on this page, or hold to talk."
    root.appendChild(empty)
    return
  }

  for (const message of messages) {
    const item = document.createElement("article")
    item.className = `consumer-message consumer-message-${message.role}`
    item.dataset.messageId = message.id
    if (message.pending) {
      item.classList.add("consumer-message-pending")
    }

    const surface = document.createElement("div")
    surface.className = "consumer-message-surface"

    const label = document.createElement("div")
    label.className = "consumer-message-role"
    label.textContent = message.role === "user" ? "You" : "ThreadAtlas"

    const body =
      message.role === "assistant" ? createAssistantMessageBody(message) : createUserMessageBody(message)

    surface.append(label, body)

    if (message.role === "assistant") {
      const hasProvenance = Boolean(message.provenanceSummary?.length)
      const hasActions =
        Boolean(message.actions?.copyText) ||
        Boolean(message.actions?.highlight) ||
        Boolean(message.actions?.showContext)

      if (hasProvenance || hasActions) {
        const footer = document.createElement("div")
        footer.className = "consumer-message-footer"

        if (hasProvenance) {
          const provenance = document.createElement("div")
          provenance.className = "consumer-provenance"
          for (const itemText of message.provenanceSummary ?? []) {
            const pill = document.createElement("span")
            pill.className = "consumer-provenance-pill"
            pill.textContent =
              itemText === "current-page"
                ? "Based on this page"
                : itemText === "enriched-context"
                  ? "Used image context"
                  : itemText
            provenance.appendChild(pill)
          }
          footer.appendChild(provenance)
        }

        if (hasActions) {
          const actions = document.createElement("div")
          actions.className = "consumer-actions"

          if (message.actions?.highlight) {
            const button = document.createElement("button")
            button.type = "button"
            button.className = "consumer-action-button"
            button.dataset.action = "highlight"
            button.dataset.messageId = message.id
            button.textContent = "Highlight"
            actions.appendChild(button)
          }

          if (message.actions?.showContext) {
            const button = document.createElement("button")
            button.type = "button"
            button.className = "consumer-action-button"
            button.dataset.action = "context"
            button.dataset.messageId = message.id
            button.textContent = "Show context"
            actions.appendChild(button)
          }

          if (message.actions?.copyText) {
            const button = document.createElement("button")
            button.type = "button"
            button.className = "consumer-action-button"
            button.dataset.action = "copy"
            button.dataset.messageId = message.id
            button.textContent = "Copy"
            actions.appendChild(button)
          }

          footer.appendChild(actions)
        }

        surface.appendChild(footer)
      }
    }

    item.appendChild(surface)
    root.appendChild(item)
  }
}

export function readConsumerTranscriptPinnedToBottom(): boolean {
  const root = getTranscriptScrollRoot()
  if (!root) {
    return true
  }

  return root.scrollHeight - root.scrollTop - root.clientHeight <= TRANSCRIPT_BOTTOM_THRESHOLD_PX
}

export function scrollConsumerTranscriptToLatest(): void {
  const root = getTranscriptScrollRoot()
  if (!root) {
    return
  }

  root.scrollTop = root.scrollHeight
}

export function renderConsumerShell(args: {
  pageTitle: string
  pageDomain: string
  view: ConsumerShellViewState
  messages: ConsumerConversationMessage[]
  activeScope: "page" | "selection"
  selectionPreview: string | null
  selectionScopeMeta: string | null
  composerValue: string
  sendDisabled: boolean
  voiceActivityState: ConsumerVoiceActivityState
  signalLevels: number[]
  signedInUser: TokenUser | null
  authStatusLabel: string
  authStatusDescription: string
  menuOpen: boolean
  voiceOutputEnabled: boolean
  showInternalConsoleLauncher: boolean
  contextContent: PresentContent | null
  contextSheetOpen: boolean
  showJumpToLatest: boolean
}): void {
  const pageDomain = getElement<HTMLDivElement>("consumer-page-domain")
  const pageTitle = getElement<HTMLHeadingElement>("consumer-page-title")
  const readiness = getElement<HTMLDivElement>("consumer-readiness-pill")
  const composer = getElement<HTMLTextAreaElement>("conversation-input")
  const send = getElement<HTMLButtonElement>("conversation-send-button")
  const mic = getElement<HTMLButtonElement>("conversation-mic-button")
  const activity = getElement<HTMLDivElement>("consumer-activity-label")
  const signal = getElement<SVGPathElement>("consumer-signal-path")
  const signalRoot = getElement<HTMLDivElement>("consumer-signal")
  const liveStrip = getElement<HTMLDivElement>("consumer-live-strip")
  const authCard = getElement<HTMLDivElement>("consumer-auth-card")
  const authTitle = getElement<HTMLDivElement>("consumer-auth-title")
  const authBody = getElement<HTMLDivElement>("consumer-auth-body")
  const signInButton = getElement<HTMLButtonElement>("consumer-sign-in-button")
  const recovery = getElement<HTMLDivElement>("consumer-recovery-card")
  const recoveryTitle = getElement<HTMLDivElement>("consumer-recovery-title")
  const recoveryBody = getElement<HTMLDivElement>("consumer-recovery-body")
  const recoveryPrimary = getElement<HTMLButtonElement>("consumer-recovery-primary")
  const scopeChip = getElement<HTMLDivElement>("consumer-scope-chip")
  const scopeLabel = getElement<HTMLSpanElement>("consumer-scope-label")
  const scopeClear = getElement<HTMLButtonElement>("consumer-scope-clear")
  const scopePreview = getElement<HTMLDivElement>("consumer-scope-preview")
  const scopeMeta = getElement<HTMLDivElement>("consumer-scope-meta")
  const menu = getElement<HTMLDivElement>("consumer-menu")
  const menuAvatar = getElement<HTMLDivElement>("consumer-menu-avatar")
  const menuName = getElement<HTMLDivElement>("consumer-menu-name")
  const menuEmail = getElement<HTMLDivElement>("consumer-menu-email")
  const signOutButton = getElement<HTMLButtonElement>("consumer-sign-out-button")
  const voiceOutputButton = getElement<HTMLButtonElement>("consumer-menu-voice-output")
  const internalConsoleButton = getElement<HTMLButtonElement>("consumer-open-console-button")
  const contextSheet = getElement<HTMLDivElement>("consumer-context-sheet")
  const contextTitle = getElement<HTMLHeadingElement>("consumer-context-title")
  const contextList = getElement<HTMLDivElement>("consumer-context-list")
  const jumpButton = getElement<HTMLButtonElement>("consumer-jump-latest-button")

  if (
    !pageDomain ||
    !pageTitle ||
    !readiness ||
    !composer ||
    !send ||
    !mic ||
    !activity ||
    !signal ||
    !signalRoot ||
    !liveStrip ||
    !authCard ||
    !authTitle ||
    !authBody ||
    !signInButton ||
    !recovery ||
    !recoveryTitle ||
    !recoveryBody ||
    !recoveryPrimary ||
    !scopeChip ||
    !scopeLabel ||
    !scopeClear ||
    !scopePreview ||
    !scopeMeta ||
    !menu ||
    !menuAvatar ||
    !menuName ||
    !menuEmail ||
    !signOutButton ||
    !voiceOutputButton ||
    !internalConsoleButton ||
    !contextSheet ||
    !contextTitle ||
    !contextList ||
    !jumpButton
  ) {
    return
  }

  pageDomain.textContent = args.pageDomain
  pageTitle.textContent = args.pageTitle
  readiness.textContent = args.view.readinessLabel
  readiness.dataset.state = args.view.readinessState
  activity.textContent = args.view.activityLabel
  signal.setAttribute("d", createWavePath(args.signalLevels, args.voiceActivityState))
  signalRoot.dataset.state = args.voiceActivityState
  liveStrip.dataset.state = args.voiceActivityState
  liveStrip.classList.toggle("hidden", args.voiceActivityState === "idle")

  renderTranscript(args.messages)

  composer.value = args.composerValue
  composer.disabled = args.view.composerDisabled
  composer.placeholder = args.view.composerPlaceholder
  send.disabled = args.sendDisabled
  mic.disabled = args.view.micDisabled
  const micLabel = args.voiceActivityState === "listening" ? "Release to send" : "Hold to talk"
  mic.dataset.state = args.voiceActivityState === "listening" ? "listening" : "idle"
  mic.setAttribute("aria-label", micLabel)
  mic.setAttribute("title", micLabel)
  send.setAttribute("aria-label", args.sendDisabled ? "Send unavailable" : "Send message")

  authCard.classList.toggle("hidden", !args.view.showAuthPrompt)
  authTitle.textContent = args.authStatusLabel
  authBody.textContent = args.authStatusDescription
  signInButton.disabled = args.view.composerDisabled && !args.view.showAuthPrompt

  recovery.classList.toggle("hidden", !args.view.showRecovery)
  recoveryTitle.textContent = args.view.recoveryTitle ?? ""
  recoveryBody.textContent = args.view.recoveryBody ?? ""
  recoveryPrimary.textContent = args.view.recoveryPrimaryLabel ?? "Try again"
  recoveryPrimary.dataset.kind = args.view.recoveryKind ?? ""

  scopeChip.dataset.scope = args.activeScope
  scopeLabel.textContent = args.activeScope === "selection" ? "Your selection" : "This page"
  scopeClear.classList.toggle("hidden", args.activeScope !== "selection")
  scopePreview.classList.toggle("hidden", !(args.activeScope === "selection" && args.selectionPreview))
  scopePreview.textContent = args.selectionPreview ?? ""
  scopeMeta.classList.toggle("hidden", !(args.activeScope === "selection" && args.selectionScopeMeta))
  scopeMeta.textContent = args.selectionScopeMeta ?? ""

  menu.classList.toggle("hidden", !args.menuOpen)
  menuAvatar.textContent = getAuthFallbackInitials(args.signedInUser)
  menuName.textContent = args.signedInUser ? getAuthDisplayName(args.signedInUser) : "Signed out"
  menuEmail.textContent = args.signedInUser?.primaryEmail ?? ""
  signOutButton.classList.toggle("hidden", !args.signedInUser)
  voiceOutputButton.textContent = args.voiceOutputEnabled ? "Voice output on" : "Voice output off"
  voiceOutputButton.setAttribute("aria-pressed", args.voiceOutputEnabled ? "true" : "false")
  internalConsoleButton.classList.toggle("hidden", !args.showInternalConsoleLauncher)

  jumpButton.classList.toggle("hidden", !args.showJumpToLatest)

  contextSheet.classList.toggle("hidden", !args.contextSheetOpen)
  contextTitle.textContent = args.contextContent?.title ?? "More context"
  contextList.innerHTML = ""
  for (const item of args.contextContent?.items ?? []) {
    const row = document.createElement("div")
    row.className = "consumer-context-item"
    const source = document.createElement("div")
    source.className = "consumer-context-source"
    source.textContent = item.source
    const summary = document.createElement("div")
    summary.className = "consumer-context-summary"
    summary.textContent = item.summary
    row.append(source, summary)
    contextList.appendChild(row)
  }
}

let detachKeyboardBindings: (() => void) | null = null

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return Boolean(target.closest("textarea, input, select, button, [contenteditable='true']"))
}

export function bindConsumerShellActions(args: {
  onComposerInput: (value: string) => void
  onSubmitPrompt: (prompt: string) => void
  onStartMicPress: () => void
  onEndMicPress: () => void
  onCancelMicPress: () => void
  onToggleMenu: () => void
  onToggleVoiceOutput: () => void
  onSignIn: () => void
  onSignOut: () => void
  onRecoveryPrimary: (kind: "refresh" | "microphone" | "runtime" | null) => void
  onCopyMessage: (messageId: string) => void
  onShowContext: (messageId: string) => void
  onHighlightMessage: (messageId: string) => void
  onClearScope: () => void
  onEscape: () => void
  onOpenInternalConsole: () => void
  onCloseContextSheet: () => void
  onTranscriptScroll: () => void
  onJumpToLatest: () => void
}): void {
  const composer = getElement<HTMLTextAreaElement>("conversation-input")
  const send = getElement<HTMLButtonElement>("conversation-send-button")
  const mic = getElement<HTMLButtonElement>("conversation-mic-button")
  const menuButton = getElement<HTMLButtonElement>("consumer-menu-button")
  const voiceOutputButton = getElement<HTMLButtonElement>("consumer-menu-voice-output")
  const signInButton = getElement<HTMLButtonElement>("consumer-sign-in-button")
  const signOutButton = getElement<HTMLButtonElement>("consumer-sign-out-button")
  const recoveryPrimary = getElement<HTMLButtonElement>("consumer-recovery-primary")
  const scopeClear = getElement<HTMLButtonElement>("consumer-scope-clear")
  const transcript = getElement<HTMLDivElement>("consumer-transcript")
  const transcriptScroll = getTranscriptScrollRoot()
  const internalConsoleButton = getElement<HTMLButtonElement>("consumer-open-console-button")
  const closeContextButton = getElement<HTMLButtonElement>("consumer-context-close")
  const jumpButton = getElement<HTMLButtonElement>("consumer-jump-latest-button")

  composer?.addEventListener("input", () => {
    args.onComposerInput(composer.value)
  })
  composer?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      args.onSubmitPrompt(composer.value)
    }
  })
  send?.addEventListener("click", () => {
    args.onSubmitPrompt(composer?.value ?? "")
  })

  let activePointerId: number | null = null
  mic?.addEventListener("pointerdown", (event) => {
    activePointerId = event.pointerId
    mic.setPointerCapture?.(event.pointerId)
    args.onStartMicPress()
  })
  mic?.addEventListener("pointerup", (event) => {
    if (activePointerId === event.pointerId) {
      activePointerId = null
      args.onEndMicPress()
    }
  })
  mic?.addEventListener("pointercancel", () => {
    activePointerId = null
    args.onCancelMicPress()
  })

  menuButton?.addEventListener("click", args.onToggleMenu)
  voiceOutputButton?.addEventListener("click", args.onToggleVoiceOutput)
  signInButton?.addEventListener("click", args.onSignIn)
  signOutButton?.addEventListener("click", args.onSignOut)
  scopeClear?.addEventListener("click", args.onClearScope)
  internalConsoleButton?.addEventListener("click", args.onOpenInternalConsole)
  closeContextButton?.addEventListener("click", args.onCloseContextSheet)
  transcriptScroll?.addEventListener("scroll", args.onTranscriptScroll)
  jumpButton?.addEventListener("click", args.onJumpToLatest)

  recoveryPrimary?.addEventListener("click", () => {
    const kind = (recoveryPrimary.dataset.kind || null) as "refresh" | "microphone" | "runtime" | null
    args.onRecoveryPrimary(kind)
  })

  transcript?.addEventListener("click", (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) {
      return
    }
    const button = target.closest("[data-action][data-message-id]") as HTMLButtonElement | null
    if (!button) {
      return
    }
    const messageId = button.dataset.messageId
    if (!messageId) {
      return
    }
    const action = button.dataset.action
    if (action === "copy") {
      args.onCopyMessage(messageId)
      return
    }
    if (action === "context") {
      args.onShowContext(messageId)
      return
    }
    if (action === "highlight") {
      args.onHighlightMessage(messageId)
    }
  })

  detachKeyboardBindings?.()
  detachKeyboardBindings = null

  let keyboardVoiceActive = false
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.repeat || event.isComposing) {
      return
    }
    if (event.ctrlKey || event.metaKey) {
      return
    }
    if (event.code === "Space" && event.altKey && !isEditableTarget(event.target)) {
      event.preventDefault()
      keyboardVoiceActive = true
      args.onStartMicPress()
      return
    }
    if (event.key === "Escape") {
      event.preventDefault()
      if (keyboardVoiceActive) {
        keyboardVoiceActive = false
      }
      args.onEscape()
    }
  }
  const handleKeyUp = (event: KeyboardEvent) => {
    if (event.isComposing) {
      return
    }
    if (event.code === "Space" && event.altKey && keyboardVoiceActive && !isEditableTarget(event.target)) {
      event.preventDefault()
      keyboardVoiceActive = false
      args.onEndMicPress()
    }
  }
  const handleBlur = () => {
    if (!keyboardVoiceActive) {
      return
    }
    keyboardVoiceActive = false
    args.onCancelMicPress()
  }
  const handleVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      handleBlur()
    }
  }

  document.addEventListener("keydown", handleKeyDown)
  document.addEventListener("keyup", handleKeyUp)
  window.addEventListener("blur", handleBlur)
  document.addEventListener("visibilitychange", handleVisibilityChange)

  detachKeyboardBindings = () => {
    document.removeEventListener("keydown", handleKeyDown)
    document.removeEventListener("keyup", handleKeyUp)
    window.removeEventListener("blur", handleBlur)
    document.removeEventListener("visibilitychange", handleVisibilityChange)
  }
}
