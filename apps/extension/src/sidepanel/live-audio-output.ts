import { decodePcm16Base64ToFloat32, measurePcm16Base64Level } from "./audio-level"

export class LiveAudioOutputPlayer {
  readonly supported: boolean
  onLevel?: (level: number) => void
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

    const float32 = decodePcm16Base64ToFloat32(chunkBase64)
    this.onLevel?.(measurePcm16Base64Level(chunkBase64))
    const audioBuffer = context.createBuffer(1, float32.length, 24000)
    audioBuffer.copyToChannel(Float32Array.from(float32), 0)

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
    this.onLevel?.(0)
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
