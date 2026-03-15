const PCM_CHUNK_SAMPLES = 2048

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

export class LiveAudioInputCapture {
  readonly supported: boolean

  private stream: MediaStream | null = null
  private audioContext: AudioContext | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private workletNode: AudioWorkletNode | null = null
  private sinkNode: GainNode | null = null
  private pendingChunks: Int16Array[] = []
  private pendingSamples = 0

  constructor(
    private readonly args: {
      onChunkBase64: (chunkBase64: string) => void
    }
  ) {
    this.supported =
      typeof navigator !== "undefined" &&
      typeof navigator.mediaDevices?.getUserMedia === "function" &&
      typeof AudioContext !== "undefined" &&
      typeof AudioWorkletNode !== "undefined"
  }

  async start(): Promise<void> {
    if (!this.supported) {
      throw new Error("Voice input is unavailable in this browser.")
    }

    await this.stop(false)

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const audioContext = new AudioContext({ sampleRate: 16000 })
    const workletUrl =
      typeof chrome !== "undefined" && chrome.runtime?.getURL
        ? chrome.runtime.getURL("audio-input-worklet.js")
        : "./audio-input-worklet.js"

    await audioContext.audioWorklet.addModule(workletUrl)
    await audioContext.resume()

    const sourceNode = audioContext.createMediaStreamSource(stream)
    const workletNode = new AudioWorkletNode(audioContext, "pcm-capture-processor")
    const sinkNode = audioContext.createGain()
    sinkNode.gain.value = 0

    workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
      const chunk = float32ToInt16(event.data)
      this.pendingChunks.push(chunk)
      this.pendingSamples += chunk.length
      if (this.pendingSamples >= PCM_CHUNK_SAMPLES) {
        this.flushPendingChunks()
      }
    }

    sourceNode.connect(workletNode)
    workletNode.connect(sinkNode)
    sinkNode.connect(audioContext.destination)

    this.stream = stream
    this.audioContext = audioContext
    this.sourceNode = sourceNode
    this.workletNode = workletNode
    this.sinkNode = sinkNode
  }

  async stop(flush = true): Promise<void> {
    if (flush) {
      this.flushPendingChunks()
    } else {
      this.pendingChunks = []
      this.pendingSamples = 0
    }

    this.workletNode?.disconnect()
    this.sourceNode?.disconnect()
    this.sinkNode?.disconnect()
    this.stream?.getTracks().forEach((track) => track.stop())
    this.workletNode = null
    this.sourceNode = null
    this.sinkNode = null
    this.stream = null

    if (this.audioContext) {
      await this.audioContext.close()
      this.audioContext = null
    }
  }

  private flushPendingChunks(): void {
    if (this.pendingSamples === 0 || this.pendingChunks.length === 0) {
      return
    }

    const merged = concatInt16Arrays(this.pendingChunks)
    this.pendingChunks = []
    this.pendingSamples = 0
    this.args.onChunkBase64(int16ToBase64(merged))
  }
}
