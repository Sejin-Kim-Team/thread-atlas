const PCM_CHUNK_SAMPLES = 2048

interface PageAudioBridgeMessage {
  source: "threadatlas-content-audio"
  type: "THREADATLAS_PAGE_AUDIO_START" | "THREADATLAS_PAGE_AUDIO_STOP" | "THREADATLAS_PAGE_AUDIO_CANCEL"
  payload: {
    sessionId: string
  }
}

declare global {
  interface Window {
    __threadatlasPageAudioBridgeInitialized__?: boolean
  }
}

export {}

function float32ToInt16(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length)
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index] ?? 0))
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
  }
  return output
}

function concatInt16Arrays(chunks: Int16Array[]): Int16Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const output = new Int16Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}

function int16ToBase64(chunk: Int16Array): string {
  const bytes = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
  let binary = ""
  const blockSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += blockSize) {
    const slice = bytes.subarray(offset, Math.min(offset + blockSize, bytes.length))
    binary += String.fromCharCode(...slice)
  }
  return btoa(binary)
}

function postToContent(type: string, payload: Record<string, unknown>): void {
  window.postMessage(
    {
      source: "threadatlas-page-audio",
      type,
      payload
    },
    "*"
  )
}

function mapCaptureError(error: unknown): { state: "unsupported" | "error"; detail: string } {
  const name =
    typeof error === "object" && error !== null && "name" in error ? String((error as { name?: unknown }).name) : ""
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : ""

  if (
    typeof navigator?.mediaDevices?.getUserMedia !== "function" ||
    typeof AudioContext === "undefined" ||
    typeof AudioWorkletNode === "undefined"
  ) {
    return {
      state: "unsupported",
      detail: "Voice input is unavailable on this page."
    }
  }

  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return {
        state: "error",
        detail: message.toLowerCase().includes("dismissed")
          ? "Microphone permission was dismissed."
          : "Microphone permission was denied."
      }
    case "NotFoundError":
      return {
        state: "error",
        detail: "No microphone was found."
      }
    case "NotReadableError":
    case "TrackStartError":
      return {
        state: "error",
        detail: "Microphone capture failed."
      }
    default:
      return {
        state: "error",
        detail: message.trim().length > 0 ? message : "Voice capture failed on this page."
      }
  }
}

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop())
}

function resolveWorkletUrl(): string | null {
  const bridgeScript = document.currentScript
  if (!(bridgeScript instanceof HTMLScriptElement) || !bridgeScript.src) {
    return null
  }
  return new URL("audio-input-worklet.js", bridgeScript.src).toString()
}

function initializePageAudioBridge(): void {
  const workletUrl = resolveWorkletUrl()

  let activeSessionId: string | null = null
  let captureGeneration = 0
  let currentState: "idle" | "listening" | "processing" | "unsupported" | "error" = "idle"
  let stream: MediaStream | null = null
  let audioContext: AudioContext | null = null
  let sourceNode: MediaStreamAudioSourceNode | null = null
  let workletNode: AudioWorkletNode | null = null
  let sinkNode: GainNode | null = null
  let pendingChunks: Int16Array[] = []
  let pendingSamples = 0

  const emitState = (
    sessionId: string,
    state: "idle" | "listening" | "processing" | "unsupported" | "error",
    detail?: string
  ) => {
    currentState = state
    postToContent("THREADATLAS_PAGE_AUDIO_STATE", {
      sessionId,
      state,
      ...(detail ? { detail } : {})
    })
  }

  const flushPendingChunks = (sessionId: string) => {
    if (pendingSamples === 0 || pendingChunks.length === 0) {
      return
    }

    const merged = concatInt16Arrays(pendingChunks)
    pendingChunks = []
    pendingSamples = 0
    postToContent("THREADATLAS_PAGE_AUDIO_CHUNK", {
      sessionId,
      chunkBase64: int16ToBase64(merged)
    })
  }

  const clearPendingChunks = () => {
    pendingChunks = []
    pendingSamples = 0
  }

  const closeActiveCapture = async (flush: boolean) => {
    const sessionId = activeSessionId
    if (flush && sessionId) {
      flushPendingChunks(sessionId)
    } else {
      clearPendingChunks()
    }

    workletNode?.disconnect()
    sourceNode?.disconnect()
    sinkNode?.disconnect()
    stopStream(stream)
    workletNode = null
    sourceNode = null
    sinkNode = null
    stream = null

    if (audioContext) {
      await audioContext.close()
      audioContext = null
    }
  }

  const resetCaptureState = () => {
    activeSessionId = null
    currentState = "idle"
    clearPendingChunks()
  }

  const cancelCapture = async (sessionId?: string) => {
    const currentSessionId = activeSessionId
    if (!currentSessionId || (sessionId && sessionId !== currentSessionId)) {
      return
    }

    captureGeneration += 1
    await closeActiveCapture(false)
    emitState(currentSessionId, "idle")
    resetCaptureState()
  }

  const stopCapture = async (sessionId: string) => {
    if (!activeSessionId || activeSessionId !== sessionId) {
      return
    }

    captureGeneration += 1
    await closeActiveCapture(true)
    emitState(sessionId, "idle")
    resetCaptureState()
  }

  const startCapture = async (sessionId: string) => {
    await cancelCapture()

    if (
      typeof navigator?.mediaDevices?.getUserMedia !== "function" ||
      typeof AudioContext === "undefined" ||
      typeof AudioWorkletNode === "undefined" ||
      !workletUrl
    ) {
      emitState(sessionId, "unsupported", "Voice input is unavailable on this page.")
      return
    }

    const generation = ++captureGeneration
    activeSessionId = sessionId
    emitState(sessionId, "processing")

    let nextStream: MediaStream | null = null
    let nextAudioContext: AudioContext | null = null
    let nextSourceNode: MediaStreamAudioSourceNode | null = null
    let nextWorkletNode: AudioWorkletNode | null = null
    let nextSinkNode: GainNode | null = null

    try {
      nextStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      nextAudioContext = new AudioContext({ sampleRate: 16000 })
      await nextAudioContext.audioWorklet.addModule(workletUrl)
      await nextAudioContext.resume()

      if (activeSessionId !== sessionId || captureGeneration !== generation) {
        stopStream(nextStream)
        await nextAudioContext.close()
        return
      }

      nextSourceNode = nextAudioContext.createMediaStreamSource(nextStream)
      nextWorkletNode = new AudioWorkletNode(nextAudioContext, "pcm-capture-processor")
      nextSinkNode = nextAudioContext.createGain()
      nextSinkNode.gain.value = 0

      nextWorkletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (activeSessionId !== sessionId || captureGeneration !== generation) {
          return
        }

        const chunk = float32ToInt16(event.data)
        pendingChunks.push(chunk)
        pendingSamples += chunk.length
        if (pendingSamples >= PCM_CHUNK_SAMPLES) {
          flushPendingChunks(sessionId)
        }
      }

      nextSourceNode.connect(nextWorkletNode)
      nextWorkletNode.connect(nextSinkNode)
      nextSinkNode.connect(nextAudioContext.destination)

      stream = nextStream
      audioContext = nextAudioContext
      sourceNode = nextSourceNode
      workletNode = nextWorkletNode
      sinkNode = nextSinkNode

      emitState(sessionId, "listening")
    } catch (error) {
      nextWorkletNode?.disconnect()
      nextSourceNode?.disconnect()
      nextSinkNode?.disconnect()
      stopStream(nextStream)
      if (nextAudioContext) {
        try {
          await nextAudioContext.close()
        } catch {
          // Ignore close races when setup fails.
        }
      }

      if (activeSessionId !== sessionId || captureGeneration !== generation) {
        return
      }

      const failure = mapCaptureError(error)
      emitState(sessionId, failure.state, failure.detail)
      resetCaptureState()
    }
  }

  window.addEventListener("message", (event: MessageEvent<PageAudioBridgeMessage>) => {
    if (event.source !== window) {
      return
    }

    const data = event.data
    if (!data || data.source !== "threadatlas-content-audio") {
      return
    }

    switch (data.type) {
      case "THREADATLAS_PAGE_AUDIO_START":
        void startCapture(data.payload.sessionId)
        return
      case "THREADATLAS_PAGE_AUDIO_STOP":
        void stopCapture(data.payload.sessionId)
        return
      case "THREADATLAS_PAGE_AUDIO_CANCEL":
        void cancelCapture(data.payload.sessionId)
        return
    }
  })
}

if (window.__threadatlasPageAudioBridgeInitialized__) {
  postToContent("THREADATLAS_PAGE_AUDIO_READY", {})
} else {
  window.__threadatlasPageAudioBridgeInitialized__ = true
  initializePageAudioBridge()
  postToContent("THREADATLAS_PAGE_AUDIO_READY", {})
}
