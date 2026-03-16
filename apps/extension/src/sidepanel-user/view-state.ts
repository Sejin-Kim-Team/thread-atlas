import type { ExtensionAuthStatus } from "@threadatlas/shared"
import type { RuntimeV2ErrorPayload } from "@threadatlas/shared/runtime"
import type { SpeechInputState } from "../sidepanel/speech-types"

export type ConsumerPageReadinessState = "preparing" | "ready" | "needs-refresh" | "unavailable"
export type ConsumerVoiceActivityState = "idle" | "listening" | "thinking" | "speaking"

export interface ConsumerShellViewState {
  readinessState: ConsumerPageReadinessState
  readinessLabel: string
  activityLabel: string
  composerDisabled: boolean
  composerPlaceholder: string
  micDisabled: boolean
  showAuthPrompt: boolean
  showRecovery: boolean
  recoveryTitle: string | null
  recoveryBody: string | null
  recoveryPrimaryLabel: string | null
  recoveryKind: "refresh" | "microphone" | "runtime" | null
}

function isActivelyThinking(
  runtimePhase: "initializing" | "ready" | "opening-session" | "sending-intent" | "waiting-enrich" | "resuming-turn" | "dormant" | "error",
  voiceActivityState: ConsumerVoiceActivityState
): boolean {
  if (voiceActivityState === "thinking") {
    return true
  }

  return runtimePhase === "sending-intent" || runtimePhase === "waiting-enrich" || runtimePhase === "resuming-turn"
}

export function deriveConsumerShellViewState(args: {
  pageSupported: boolean
  snapshotReady: boolean
  snapshotPreparing: boolean
  snapshotError: string | null
  authStatus: ExtensionAuthStatus
  inputSupported: boolean
  voiceActivityState: ConsumerVoiceActivityState
  runtimePhase: "initializing" | "ready" | "opening-session" | "sending-intent" | "waiting-enrich" | "resuming-turn" | "dormant" | "error"
  speechInputState: SpeechInputState
  speechInputDetail: string | null
  lastRuntimeError: RuntimeV2ErrorPayload | null
}): ConsumerShellViewState {
  const readinessState: ConsumerPageReadinessState = !args.pageSupported
    ? "unavailable"
    : args.snapshotPreparing
      ? "preparing"
      : args.snapshotReady
        ? "ready"
        : "needs-refresh"

  let readinessLabel = "Needs refresh"
  if (readinessState === "unavailable") {
    readinessLabel = "Unavailable"
  } else if (readinessState === "preparing") {
    readinessLabel = "Preparing"
  } else if (readinessState === "ready") {
    readinessLabel = "Ready"
  }

  const signedIn = args.authStatus === "signed-in"
  const showAuthPrompt = !signedIn && args.authStatus !== "signing-in" && args.authStatus !== "refreshing"

  let activityLabel = "Hold to talk or type a question."
  if (args.voiceActivityState === "listening" || args.speechInputState === "listening") {
    activityLabel = "Listening... release to send."
  } else if (args.voiceActivityState === "speaking") {
    activityLabel = "Speaking..."
  } else if (isActivelyThinking(args.runtimePhase, args.voiceActivityState)) {
    activityLabel = "Thinking..."
  } else if (!signedIn) {
    activityLabel = "Sign in to talk with the page you are reading."
  } else if (readinessState === "preparing") {
    activityLabel = "Preparing this page..."
  } else if (readinessState === "needs-refresh") {
    activityLabel = "This page needs a refresh before it can answer reliably."
  } else if (readinessState === "unavailable") {
    activityLabel = "This page is not ready for ThreadAtlas."
  }

  let showRecovery = false
  let recoveryTitle: string | null = null
  let recoveryBody: string | null = null
  let recoveryPrimaryLabel: string | null = null
  let recoveryKind: ConsumerShellViewState["recoveryKind"] = null

  if (args.speechInputState === "error" && args.speechInputDetail) {
    showRecovery = true
    recoveryTitle = "Microphone access is needed"
    recoveryBody = args.speechInputDetail
    recoveryPrimaryLabel = "Try microphone again"
    recoveryKind = "microphone"
  } else if (args.lastRuntimeError) {
    showRecovery = true
    recoveryTitle = "The answer was interrupted"
    recoveryBody = args.lastRuntimeError.message
    recoveryPrimaryLabel = "Refresh page"
    recoveryKind = "runtime"
  } else if (readinessState === "needs-refresh" && args.snapshotError) {
    showRecovery = true
    recoveryTitle = "This page needs a refresh"
    recoveryBody = args.snapshotError
    recoveryPrimaryLabel = "Refresh page"
    recoveryKind = "refresh"
  } else if (readinessState === "unavailable" && args.pageSupported) {
    showRecovery = true
    recoveryTitle = "This page is not ready yet"
    recoveryBody = "Try refreshing the page context and then ask again."
    recoveryPrimaryLabel = "Refresh page"
    recoveryKind = "refresh"
  }

  const composerDisabled = !signedIn || readinessState === "unavailable"
  const micDisabled = !signedIn || !args.inputSupported || readinessState === "unavailable"

  let composerPlaceholder = "Ask about this page..."
  if (!signedIn) {
    composerPlaceholder = "Sign in to ask about this page..."
  } else if (readinessState === "preparing") {
    composerPlaceholder = "Preparing this page..."
  } else if (readinessState === "needs-refresh") {
    composerPlaceholder = "Ask anyway or refresh the page context..."
  } else if (readinessState === "unavailable") {
    composerPlaceholder = "Open a supported page to start."
  }

  return {
    readinessState,
    readinessLabel,
    activityLabel,
    composerDisabled,
    composerPlaceholder,
    micDisabled,
    showAuthPrompt,
    showRecovery,
    recoveryTitle,
    recoveryBody,
    recoveryPrimaryLabel,
    recoveryKind
  }
}
