import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  bindConsumerShellActions,
  readConsumerTranscriptPinnedToBottom,
  renderConsumerShell,
  scrollConsumerTranscriptToLatest
} from "../src/sidepanel-user/ui"

describe("consumer shell ui", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="consumer-page-domain"></div>
      <h1 id="consumer-page-title"></h1>
      <div id="consumer-readiness-pill"></div>
      <button id="consumer-menu-button" type="button">···</button>
      <div id="consumer-menu" class="hidden"></div>
      <div id="consumer-menu-avatar"></div>
      <div id="consumer-menu-name"></div>
      <div id="consumer-menu-email"></div>
      <button id="consumer-menu-voice-output" type="button"></button>
      <button id="consumer-sign-out-button" class="hidden" type="button">Sign out</button>
      <button id="consumer-open-console-button" class="hidden" type="button">Open internal console</button>
      <div id="consumer-auth-card" class="hidden"></div>
      <div id="consumer-auth-title"></div>
      <div id="consumer-auth-body"></div>
      <button id="consumer-sign-in-button" type="button">Continue with Google</button>
      <div id="consumer-recovery-card" class="hidden"></div>
      <div id="consumer-recovery-title"></div>
      <div id="consumer-recovery-body"></div>
      <button id="consumer-recovery-primary" type="button"></button>
      <div id="consumer-scope-chip" data-scope="page"></div>
      <span id="consumer-scope-label"></span>
      <button id="consumer-scope-clear" class="hidden" type="button">×</button>
      <div id="consumer-scope-preview" class="hidden"></div>
      <div id="consumer-scope-meta" class="hidden"></div>
      <div id="consumer-live-strip" data-state="idle"></div>
      <div id="consumer-signal" data-state="idle"></div>
      <svg><path id="consumer-signal-path"></path></svg>
      <div id="consumer-activity-label"></div>
      <div id="consumer-transcript-scroll" style="height: 180px; overflow: auto;">
        <div id="consumer-transcript"></div>
      </div>
      <button id="consumer-jump-latest-button" class="hidden" type="button">Jump to latest</button>
      <textarea id="conversation-input"></textarea>
      <button id="conversation-mic-button" type="button">Hold to talk</button>
      <button id="conversation-send-button" type="button">Send</button>
      <div id="consumer-context-sheet" class="hidden"></div>
      <h2 id="consumer-context-title"></h2>
      <div id="consumer-context-list"></div>
      <button id="consumer-context-close" type="button">Close</button>
    `
  })

  it("renders transcript, readiness, provenance, and context sheet", () => {
    renderConsumerShell({
      pageTitle: "The Appalling Stupidity of Spotify's AI DJ",
      pageDomain: "news.ycombinator.com",
      view: {
        readinessState: "ready",
        readinessLabel: "Ready",
        activityLabel: "Hold to talk or type a question.",
        composerDisabled: false,
        composerPlaceholder: "Ask about this page...",
        micDisabled: false,
        showAuthPrompt: false,
        showRecovery: false,
        recoveryTitle: null,
        recoveryBody: null,
        recoveryPrimaryLabel: null,
        recoveryKind: null
      },
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          text: "This page **argues** Spotify's AI DJ is mostly a product design failure.\n\n- Product issue\n- Weak framing\n\n[Read more](https://example.com)",
          provenanceSummary: ["current-page", "enriched-context"],
          actions: {
            copyText: "This page argues Spotify's AI DJ is mostly a product design failure.",
            highlight: true,
            showContext: true
          }
        }
      ],
      activeScope: "selection",
      selectionPreview: "Spotify DJ is essentially shuffle with voice interludes.",
      selectionScopeMeta: "Comment branch",
      composerValue: "",
      sendDisabled: true,
      voiceActivityState: "speaking",
      signalLevels: [0.1, 0.3, 0.2, 0.4],
      signedInUser: {
        id: "user-1",
        displayName: "Local Dev",
        primaryEmail: "local-dev@example.com"
      },
      authStatusLabel: "Talk with the page you are reading",
      authStatusDescription: "Sign in once and ask questions about the current page with voice or text.",
      menuOpen: true,
      voiceOutputEnabled: true,
      showInternalConsoleLauncher: true,
      contextContent: {
        title: "More context",
        items: [{ source: "Comment branch", summary: "The discussion argues this is mostly a product issue." }]
      },
      contextSheetOpen: true,
      showJumpToLatest: true
    })

    expect(document.getElementById("consumer-page-title")?.textContent).toContain("Spotify")
    expect(document.getElementById("consumer-readiness-pill")?.textContent).toBe("Ready")
    expect(document.getElementById("consumer-scope-label")?.textContent).toBe("Your selection")
    expect(document.getElementById("consumer-scope-preview")?.textContent).toContain("shuffle")
    expect(document.getElementById("consumer-scope-meta")?.textContent).toBe("Comment branch")
    expect(document.getElementById("consumer-activity-label")?.textContent).toContain("Hold to talk")
    expect(document.getElementById("consumer-live-strip")?.dataset.state).toBe("speaking")
    expect(document.getElementById("consumer-transcript")?.textContent).toContain("product design failure")
    expect(document.getElementById("consumer-transcript")?.textContent).toContain("Based on this page")
    expect(document.getElementById("consumer-transcript")?.textContent).toContain("Used image context")
    expect(document.getElementById("consumer-context-list")?.textContent).toContain("Comment branch")
    expect(document.getElementById("consumer-menu")?.classList.contains("hidden")).toBe(false)
    expect(document.querySelector("#consumer-transcript strong")?.textContent).toBe("argues")
    expect(document.querySelector("#consumer-transcript a")?.getAttribute("target")).toBe("_blank")
    expect(document.getElementById("consumer-jump-latest-button")?.classList.contains("hidden")).toBe(false)
  })

  it("binds keyboard and pointer voice controls plus transcript actions", () => {
    const onComposerInput = vi.fn()
    const onSubmitPrompt = vi.fn()
    const onStartMicPress = vi.fn()
    const onEndMicPress = vi.fn()
    const onCancelMicPress = vi.fn()
    const onToggleMenu = vi.fn()
    const onToggleVoiceOutput = vi.fn()
    const onSignIn = vi.fn()
    const onSignOut = vi.fn()
    const onRecoveryPrimary = vi.fn()
    const onCopyMessage = vi.fn()
    const onShowContext = vi.fn()
    const onHighlightMessage = vi.fn()
    const onClearScope = vi.fn()
    const onEscape = vi.fn()
    const onOpenInternalConsole = vi.fn()
    const onCloseContextSheet = vi.fn()
    const onTranscriptScroll = vi.fn()
    const onJumpToLatest = vi.fn()

    bindConsumerShellActions({
      onComposerInput,
      onSubmitPrompt,
      onStartMicPress,
      onEndMicPress,
      onCancelMicPress,
      onToggleMenu,
      onToggleVoiceOutput,
      onSignIn,
      onSignOut,
      onRecoveryPrimary,
      onCopyMessage,
      onShowContext,
      onHighlightMessage,
      onClearScope,
      onEscape,
      onOpenInternalConsole,
      onCloseContextSheet,
      onTranscriptScroll,
      onJumpToLatest
    })

    const composer = document.getElementById("conversation-input") as HTMLTextAreaElement
    composer.value = "What matters here?"
    composer.dispatchEvent(new Event("input"))
    composer.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))

    const makePointerEvent = (type: string) => {
      const event = new Event(type, { bubbles: true })
      Object.defineProperty(event, "pointerId", { value: 7 })
      return event
    }

    const mic = document.getElementById("conversation-mic-button") as HTMLButtonElement
    mic.dispatchEvent(makePointerEvent("pointerdown"))
    mic.dispatchEvent(makePointerEvent("pointerup"))
    mic.dispatchEvent(makePointerEvent("pointerdown"))
    mic.dispatchEvent(makePointerEvent("pointercancel"))

    document.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " ", altKey: true, bubbles: true }))
    document.dispatchEvent(new KeyboardEvent("keyup", { code: "Space", key: " ", altKey: true, bubbles: true }))
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))

    document.getElementById("consumer-menu-button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    document.getElementById("consumer-menu-voice-output")?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    document.getElementById("consumer-sign-in-button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    document.getElementById("consumer-sign-out-button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    document.getElementById("consumer-scope-clear")?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    document.getElementById("consumer-open-console-button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    document.getElementById("consumer-context-close")?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    document.getElementById("consumer-jump-latest-button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    document.getElementById("consumer-transcript-scroll")?.dispatchEvent(new Event("scroll", { bubbles: true }))

    const transcript = document.getElementById("consumer-transcript") as HTMLDivElement
    transcript.innerHTML = `
      <button data-action="copy" data-message-id="m-1"></button>
      <button data-action="context" data-message-id="m-2"></button>
      <button data-action="highlight" data-message-id="m-3"></button>
    `
    ;(transcript.querySelector("[data-action='copy']") as HTMLButtonElement).click()
    ;(transcript.querySelector("[data-action='context']") as HTMLButtonElement).click()
    ;(transcript.querySelector("[data-action='highlight']") as HTMLButtonElement).click()

    expect(onComposerInput).toHaveBeenCalledWith("What matters here?")
    expect(onSubmitPrompt).toHaveBeenCalledWith("What matters here?")
    expect(onStartMicPress).toHaveBeenCalledTimes(3)
    expect(onEndMicPress).toHaveBeenCalledTimes(2)
    expect(onCancelMicPress).toHaveBeenCalledTimes(1)
    expect(onEscape).toHaveBeenCalledTimes(1)
    expect(onToggleMenu).toHaveBeenCalledTimes(1)
    expect(onToggleVoiceOutput).toHaveBeenCalledTimes(1)
    expect(onSignIn).toHaveBeenCalledTimes(1)
    expect(onSignOut).toHaveBeenCalledTimes(1)
    expect(onClearScope).toHaveBeenCalledTimes(1)
    expect(onOpenInternalConsole).toHaveBeenCalledTimes(1)
    expect(onCloseContextSheet).toHaveBeenCalledTimes(1)
    expect(onTranscriptScroll).toHaveBeenCalledTimes(1)
    expect(onJumpToLatest).toHaveBeenCalledTimes(1)
    expect(onCopyMessage).toHaveBeenCalledWith("m-1")
    expect(onShowContext).toHaveBeenCalledWith("m-2")
    expect(onHighlightMessage).toHaveBeenCalledWith("m-3")
  })

  it("tracks transcript bottom state and can jump to latest", () => {
    const transcriptScroll = document.getElementById("consumer-transcript-scroll") as HTMLDivElement
    Object.defineProperty(transcriptScroll, "clientHeight", { value: 180, configurable: true })
    Object.defineProperty(transcriptScroll, "scrollHeight", { value: 520, configurable: true })
    transcriptScroll.scrollTop = 340

    expect(readConsumerTranscriptPinnedToBottom()).toBe(true)

    transcriptScroll.scrollTop = 40
    expect(readConsumerTranscriptPinnedToBottom()).toBe(false)

    scrollConsumerTranscriptToLatest()
    expect(transcriptScroll.scrollTop).toBe(520)
  })
})
