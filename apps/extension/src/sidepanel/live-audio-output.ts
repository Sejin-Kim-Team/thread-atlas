function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function pcm16ToFloat32(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const sampleCount = Math.floor(bytes.byteLength / 2)
  const output = new Float32Array(sampleCount)
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = view.getInt16(index * 2, true)
    output[index] = sample / 0x8000
  }
  return output
}

export class LiveAudioOutputPlayer {
  readonly supported: boolean
  private audioContext: AudioContext | null = null
  private activeSources = new Set<AudioBufferSourceNode>()
  private nextPlaybackTime = 0

  constructor() {
    this.supported = typeof AudioContext !== "undefined"
  }

  async playChunk(chunkBase64: string): Promise<void> {
    if (!this.supported) {
      return
    }

    const context = this.ensureContext()
    await context.resume()

    const float32 = pcm16ToFloat32(base64ToBytes(chunkBase64))
    const audioBuffer = context.createBuffer(1, float32.length, 24000)
    audioBuffer.copyToChannel(new Float32Array(float32), 0)

    const source = context.createBufferSource()
    source.buffer = audioBuffer
    source.connect(context.destination)

    const startTime = Math.max(context.currentTime, this.nextPlaybackTime)
    this.nextPlaybackTime = startTime + audioBuffer.duration
    source.start(startTime)
    this.activeSources.add(source)
    source.onended = () => {
      this.activeSources.delete(source)
    }
  }

  stop(): void {
    for (const source of this.activeSources) {
      try {
        source.stop()
      } catch {
        // Ignore stop races on completed sources.
      }
    }
    this.activeSources.clear()
    this.nextPlaybackTime = 0
  }

  async dispose(): Promise<void> {
    this.stop()
    if (this.audioContext) {
      await this.audioContext.close()
      this.audioContext = null
    }
  }

  private ensureContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new AudioContext({ sampleRate: 24000 })
    }
    return this.audioContext
  }
}
