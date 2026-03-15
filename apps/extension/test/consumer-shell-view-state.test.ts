import { describe, expect, it } from "vitest"
import { deriveConsumerShellViewState } from "../src/sidepanel-user/view-state"

describe("consumer shell view state", () => {
  it("maps signed-out users to an auth-gated state", () => {
    const view = deriveConsumerShellViewState({
      pageSupported: true,
      snapshotReady: true,
      snapshotPreparing: false,
      snapshotError: null,
      authStatus: "signed-out",
      inputSupported: true,
      voiceActivityState: "idle",
      runtimePhase: "ready",
      speechInputState: "idle",
      speechInputDetail: null,
      lastRuntimeError: null
    })

    expect(view.showAuthPrompt).toBe(true)
    expect(view.composerDisabled).toBe(true)
    expect(view.micDisabled).toBe(true)
    expect(view.activityLabel).toContain("Sign in")
  })

  it("prefers listening and speaking labels over generic readiness", () => {
    const listening = deriveConsumerShellViewState({
      pageSupported: true,
      snapshotReady: true,
      snapshotPreparing: false,
      snapshotError: null,
      authStatus: "signed-in",
      inputSupported: true,
      voiceActivityState: "listening",
      runtimePhase: "ready",
      speechInputState: "listening",
      speechInputDetail: null,
      lastRuntimeError: null
    })
    const speaking = deriveConsumerShellViewState({
      pageSupported: true,
      snapshotReady: true,
      snapshotPreparing: false,
      snapshotError: null,
      authStatus: "signed-in",
      inputSupported: true,
      voiceActivityState: "speaking",
      runtimePhase: "ready",
      speechInputState: "idle",
      speechInputDetail: null,
      lastRuntimeError: null
    })

    expect(listening.activityLabel).toContain("Listening")
    expect(speaking.activityLabel).toContain("Speaking")
    expect(listening.readinessState).toBe("ready")
  })

  it("surfaces recovery actions for runtime and refresh failures", () => {
    const runtimeRecovery = deriveConsumerShellViewState({
      pageSupported: true,
      snapshotReady: true,
      snapshotPreparing: false,
      snapshotError: null,
      authStatus: "signed-in",
      inputSupported: true,
      voiceActivityState: "idle",
      runtimePhase: "error",
      speechInputState: "idle",
      speechInputDetail: null,
      lastRuntimeError: {
        code: "LIVE_UPSTREAM_CLOSED",
        message: "Gemini Live session closed unexpectedly",
        recoverable: true
      }
    })

    expect(runtimeRecovery.showRecovery).toBe(true)
    expect(runtimeRecovery.recoveryKind).toBe("runtime")
    expect(runtimeRecovery.recoveryPrimaryLabel).toBe("Refresh page")

    const refreshRecovery = deriveConsumerShellViewState({
      pageSupported: true,
      snapshotReady: false,
      snapshotPreparing: false,
      snapshotError: "Page context is stale.",
      authStatus: "signed-in",
      inputSupported: true,
      voiceActivityState: "idle",
      runtimePhase: "ready",
      speechInputState: "idle",
      speechInputDetail: null,
      lastRuntimeError: null
    })

    expect(refreshRecovery.readinessState).toBe("needs-refresh")
    expect(refreshRecovery.showRecovery).toBe(true)
    expect(refreshRecovery.recoveryKind).toBe("refresh")
  })
})
