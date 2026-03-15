import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  bindAuthActions,
  bindConversationActions,
  clearPresent,
  clearSuggestChips,
  renderAuthCard,
  renderConversation,
  renderPresent,
  showSuggestChips
} from "../src/sidepanel/ui"

describe("sidepanel conversation ui", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="auth-copy"></div>
      <div id="auth-user" class="hidden-inline"></div>
      <img id="auth-avatar" class="hidden-inline" />
      <div id="auth-avatar-fallback" class="hidden-inline"></div>
      <div id="auth-user-name"></div>
      <div id="auth-user-email"></div>
      <button id="auth-sign-in-button" type="button">Continue with Google</button>
      <button id="auth-sign-out-button" type="button" class="hidden-inline">Sign out</button>
      <div id="conversation-status"></div>
      <div id="conversation-transcript"></div>
      <textarea id="conversation-input"></textarea>
      <button id="conversation-mic-button" type="button">Mic</button>
      <button id="conversation-voice-output-button" type="button">Voice Output On</button>
      <button id="conversation-send-button" type="button">Send</button>
      <div id="present-root"></div>
      <div id="suggest-root"></div>
    `
  })

  it("renders transcript and disables the composer when runtime input is unavailable", () => {
    renderConversation({
      messages: [
        { role: "user", text: "What does this comment mean?" },
        { role: "assistant", text: "It argues for bidirectional updates." }
      ],
      composerValue: "",
      status: "Capture a semantic snapshot to ask about the current page.",
      composerDisabled: true,
      composerReadOnly: false,
      submitDisabled: true,
      micDisabled: true,
      micLabel: "Mic",
      voiceOutputEnabled: true,
      voiceOutputDisabled: false,
      voiceOutputLabel: "Voice Output On",
      placeholder: "Capture a semantic snapshot first."
    })

    expect(document.getElementById("conversation-transcript")?.textContent).toContain("What does this comment mean?")
    expect(document.getElementById("conversation-transcript")?.textContent).toContain("bidirectional updates")
    expect((document.getElementById("conversation-input") as HTMLTextAreaElement).disabled).toBe(true)
    expect((document.getElementById("conversation-send-button") as HTMLButtonElement).disabled).toBe(true)
    expect((document.getElementById("conversation-mic-button") as HTMLButtonElement).disabled).toBe(true)
    expect(document.getElementById("conversation-status")?.textContent).toContain("Capture a semantic snapshot")
  })

  it("binds text submission and voice controls", () => {
    const onComposerInput = vi.fn()
    const onSubmitPrompt = vi.fn()
    const onStartMicPress = vi.fn()
    const onEndMicPress = vi.fn()
    const onCancelMicPress = vi.fn()
    const onToggleVoiceOutput = vi.fn()

    bindConversationActions({
      onComposerInput,
      onSubmitPrompt,
      onStartMicPress,
      onEndMicPress,
      onCancelMicPress,
      onToggleVoiceOutput
    })

    const composer = document.getElementById("conversation-input") as HTMLTextAreaElement
    composer.value = "Summarize this page"
    composer.dispatchEvent(new Event("input"))
    composer.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    composer.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }))
    const makePointerEvent = (type: string) => {
      const event = new Event(type, { bubbles: true })
      Object.defineProperty(event, "pointerId", {
        value: 1
      })
      return event
    }
    ;(document.getElementById("conversation-mic-button") as HTMLButtonElement).dispatchEvent(
      makePointerEvent("pointerdown")
    )
    ;(document.getElementById("conversation-mic-button") as HTMLButtonElement).dispatchEvent(
      makePointerEvent("pointerup")
    )
    ;(document.getElementById("conversation-mic-button") as HTMLButtonElement).dispatchEvent(
      makePointerEvent("pointercancel")
    )
    ;(document.getElementById("conversation-voice-output-button") as HTMLButtonElement).click()
    ;(document.getElementById("conversation-send-button") as HTMLButtonElement).click()

    expect(onComposerInput).toHaveBeenCalledWith("Summarize this page")
    expect(onSubmitPrompt).toHaveBeenCalledTimes(2)
    expect(onSubmitPrompt).toHaveBeenCalledWith("Summarize this page")
    expect(onStartMicPress).toHaveBeenCalledTimes(1)
    expect(onEndMicPress).toHaveBeenCalledTimes(1)
    expect(onCancelMicPress).toHaveBeenCalledTimes(1)
    expect(onToggleVoiceOutput).toHaveBeenCalledTimes(1)
  })

  it("renders signed-out and signed-in auth card states", () => {
    renderAuthCard({
      status: "signed-out",
      provider: null,
      user: null,
      errorMessage: null
    })

    expect(document.getElementById("auth-copy")?.textContent).toContain("Sign in with Google")
    expect((document.getElementById("auth-sign-in-button") as HTMLButtonElement).textContent).toBe(
      "Continue with Google"
    )
    expect(document.getElementById("auth-sign-out-button")?.classList.contains("hidden-inline")).toBe(true)

    renderAuthCard({
      status: "signed-in",
      provider: "google",
      user: {
        id: "user-1",
        displayName: "Sungwoo",
        primaryEmail: "sungwoo@example.com"
      },
      errorMessage: null
    })

    expect(document.getElementById("auth-copy")?.textContent).toContain("Signed in")
    expect(document.getElementById("auth-user-name")?.textContent).toContain("Sungwoo")
    expect(document.getElementById("auth-sign-in-button")?.classList.contains("hidden-inline")).toBe(true)
    expect(document.getElementById("auth-sign-out-button")?.classList.contains("hidden-inline")).toBe(false)
  })

  it("binds auth card actions", () => {
    const onSignIn = vi.fn()
    const onSignOut = vi.fn()

    bindAuthActions({
      onSignIn,
      onSignOut
    })

    ;(document.getElementById("auth-sign-in-button") as HTMLButtonElement).click()
    ;(document.getElementById("auth-sign-out-button") as HTMLButtonElement).click()

    expect(onSignIn).toHaveBeenCalledTimes(1)
    expect(onSignOut).toHaveBeenCalledTimes(1)
  })

  it("renders readonly composer and toggle labels during voice capture", () => {
    renderConversation({
      messages: [],
      composerValue: "Summarize this page",
      status: "Listening for a single utterance.",
      composerDisabled: false,
      composerReadOnly: true,
      submitDisabled: true,
      micDisabled: false,
      micLabel: "Stop",
      voiceOutputEnabled: false,
      voiceOutputDisabled: false,
      voiceOutputLabel: "Voice Output Off",
      placeholder: "Listening..."
    })

    expect((document.getElementById("conversation-input") as HTMLTextAreaElement).readOnly).toBe(true)
    expect((document.getElementById("conversation-mic-button") as HTMLButtonElement).textContent).toBe("Stop")
    expect((document.getElementById("conversation-voice-output-button") as HTMLButtonElement).textContent).toBe("Voice Output Off")
    expect((document.getElementById("conversation-voice-output-button") as HTMLButtonElement).getAttribute("aria-pressed")).toBe("false")
  })

  it("clears supplementary surfaces when resetting conversation context", () => {
    renderPresent({
      title: "Related memory",
      items: [{ source: "branch-summary", summary: "Earlier discussion" }]
    })
    showSuggestChips(["Explain more"], vi.fn())

    clearPresent()
    clearSuggestChips()

    expect(document.getElementById("present-root")?.textContent).toBe("")
    expect(document.getElementById("suggest-root")?.textContent).toBe("")
  })
})
