interface SpeechRecognitionAlternativeLike {
  transcript: string
}

interface SpeechRecognitionResultLike {
  isFinal: boolean
  length: number
  [index: number]: SpeechRecognitionAlternativeLike
}

interface SpeechRecognitionResultListLike {
  length: number
  [index: number]: SpeechRecognitionResultLike
}

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number
  results: SpeechRecognitionResultListLike
}

interface SpeechRecognitionErrorEventLike extends Event {
  error?: string
  message?: string
}

interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  onstart: ((event: Event) => void) | null
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: ((event: Event) => void) | null
  start(): void
  stop(): void
  abort(): void
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionLike
}

interface SpeechBridgeMessage {
  source: "threadatlas-content-speech"
  type: "THREADATLAS_PAGE_SPEECH_START" | "THREADATLAS_PAGE_SPEECH_STOP" | "THREADATLAS_PAGE_SPEECH_CANCEL"
  payload: {
    sessionId: string
    language?: string
  }
}

declare global {
  interface Window {
    webkitSpeechRecognition?: SpeechRecognitionConstructor
    __threadatlasPageSpeechBridgeInitialized__?: boolean
  }
}

export {}

function normalizeTranscript(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function joinTranscript(base: string, next: string): string {
  const normalizedBase = normalizeTranscript(base)
  const normalizedNext = normalizeTranscript(next)
  if (!normalizedBase) {
    return normalizedNext
  }
  if (!normalizedNext) {
    return normalizedBase
  }
  return `${normalizedBase} ${normalizedNext}`
}

function mapRecognitionError(event: SpeechRecognitionErrorEventLike): string {
  switch (event.error) {
    case "aborted":
      return "Voice input was interrupted."
    case "audio-capture":
      return "Microphone capture failed."
    case "network":
      return "Voice input network request failed."
    case "not-allowed":
      return "Microphone permission was denied."
    case "service-not-allowed":
      return "Speech recognition is unavailable in this browsing context."
    case "no-speech":
      return "No speech was detected."
    default:
      return event.message?.trim() || "Voice input failed."
  }
}

function mapMicrophonePermissionError(error: unknown): string {
  const name = typeof error === "object" && error !== null && "name" in error ? String((error as { name?: unknown }).name) : ""
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "Microphone permission was denied."
    case "NotFoundError":
      return "No microphone was found."
    case "NotReadableError":
    case "TrackStartError":
      return "Microphone capture failed."
    default:
      return error instanceof Error && error.message.trim().length > 0
        ? error.message
        : "Microphone permission could not be requested."
  }
}

function postToContent(type: string, payload: Record<string, unknown>): void {
  window.postMessage(
    {
      source: "threadatlas-page-speech",
      type,
      payload
    },
    "*"
  )
}

if (!window.__threadatlasPageSpeechBridgeInitialized__) {
  window.__threadatlasPageSpeechBridgeInitialized__ = true
  postToContent("THREADATLAS_PAGE_SPEECH_READY", {})

  let activeRecognition: SpeechRecognitionLike | null = null
  let activeSessionId: string | null = null
  let cancelRequested = false
  let finalTranscript = ""
  let currentState: "idle" | "listening" | "processing" | "unsupported" | "error" = "idle"

  const emitState = (sessionId: string, state: "idle" | "listening" | "processing" | "unsupported" | "error", detail?: string) => {
    currentState = state
    postToContent("THREADATLAS_PAGE_SPEECH_STATE", {
      sessionId,
      state,
      ...(detail ? { detail } : {})
    })
  }

  const emitPartial = (sessionId: string, text: string) => {
    postToContent("THREADATLAS_PAGE_SPEECH_PARTIAL", {
      sessionId,
      text
    })
  }

  const emitFinal = (sessionId: string, text: string) => {
    postToContent("THREADATLAS_PAGE_SPEECH_FINAL", {
      sessionId,
      text
    })
  }

  const resetRecognition = () => {
    activeRecognition = null
    activeSessionId = null
    cancelRequested = false
    finalTranscript = ""
    currentState = "idle"
  }

  const cancelRecognition = (sessionId?: string) => {
    if (!activeRecognition || !activeSessionId) {
      return
    }

    const currentSessionId = activeSessionId
    if (sessionId && currentSessionId !== sessionId) {
      return
    }

    cancelRequested = true
    finalTranscript = ""
    activeRecognition.abort()
    emitPartial(currentSessionId, "")
    emitState(currentSessionId, "idle")
    resetRecognition()
  }

  const requestMicrophoneAccess = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      return
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    for (const track of stream.getTracks()) {
      track.stop()
    }
  }

  const startRecognition = async (sessionId: string, language?: string) => {
    cancelRecognition()
    finalTranscript = ""
    emitPartial(sessionId, "")
    emitState(sessionId, "processing")

    const Recognition = window.webkitSpeechRecognition
    if (typeof Recognition !== "function") {
      emitState(sessionId, "unsupported", "Voice input is unavailable on this page.")
      return
    }

    try {
      await requestMicrophoneAccess()
    } catch (error) {
      emitState(sessionId, "error", mapMicrophonePermissionError(error))
      return
    }

    const recognition = new Recognition()
    activeRecognition = recognition
    activeSessionId = sessionId
    cancelRequested = false

    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = language?.trim() || navigator.language

    recognition.onstart = () => {
      if (activeSessionId !== sessionId) {
        return
      }
      emitState(sessionId, "listening")
    }

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      if (activeSessionId !== sessionId) {
        return
      }

      let interimTranscript = ""
      for (let idx = event.resultIndex; idx < event.results.length; idx += 1) {
        const result = event.results[idx]
        if (!result || !result[0]) {
          continue
        }
        if (result.isFinal) {
          finalTranscript = joinTranscript(finalTranscript, result[0].transcript)
        } else {
          interimTranscript = joinTranscript(interimTranscript, result[0].transcript)
        }
      }

      emitPartial(sessionId, normalizeTranscript(interimTranscript))
      if (finalTranscript) {
        emitState(sessionId, "processing")
      }
    }

    recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
      if (activeSessionId !== sessionId) {
        return
      }
      if (cancelRequested && event.error === "aborted") {
        return
      }

      emitState(sessionId, "error", mapRecognitionError(event))
    }

    recognition.onend = () => {
      if (activeSessionId !== sessionId) {
        return
      }

      const resolvedTranscript = normalizeTranscript(finalTranscript)
      const shouldEmitIdle = currentState !== "error"
      emitPartial(sessionId, "")
      if (resolvedTranscript) {
        emitFinal(sessionId, resolvedTranscript)
      }
      resetRecognition()
      if (shouldEmitIdle) {
        emitState(sessionId, "idle")
      }
    }

    recognition.start()
  }

  window.addEventListener("message", (event: MessageEvent<SpeechBridgeMessage>) => {
    if (event.source !== window) {
      return
    }

    const data = event.data
    if (!data || data.source !== "threadatlas-content-speech") {
      return
    }

    switch (data.type) {
      case "THREADATLAS_PAGE_SPEECH_START":
        void startRecognition(data.payload.sessionId, data.payload.language)
        return
      case "THREADATLAS_PAGE_SPEECH_STOP":
        if (activeRecognition && activeSessionId === data.payload.sessionId) {
          emitState(activeSessionId, "processing")
          activeRecognition.stop()
        }
        return
      case "THREADATLAS_PAGE_SPEECH_CANCEL":
        cancelRecognition(data.payload.sessionId)
        return
    }
  })
}
