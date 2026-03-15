import { LIVE_INPUT_AUDIO_FORMAT, LIVE_OUTPUT_AUDIO_FORMAT } from "@threadatlas/shared/runtime"

const BASE64_PATTERN = /^[A-Za-z0-9+/=_-]+$/
const MAX_AUDIO_CHUNK_BYTES = 64 * 1024

function normalizeBase64(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed || !BASE64_PATTERN.test(trimmed)) {
    return null
  }
  return trimmed.replace(/-/g, "+").replace(/_/g, "/")
}

export function decodeBase64AudioChunk(base64: string): { ok: true; bytes: Buffer } | { ok: false; message: string } {
  const normalized = normalizeBase64(base64)
  if (!normalized) {
    return {
      ok: false,
      message: "audio chunk is not valid base64"
    }
  }

  try {
    const bytes = Buffer.from(normalized, "base64")
    if (bytes.length === 0) {
      return {
        ok: false,
        message: "audio chunk is empty"
      }
    }
    if (bytes.length > MAX_AUDIO_CHUNK_BYTES) {
      return {
        ok: false,
        message: "audio chunk exceeds size limit"
      }
    }
    return {
      ok: true,
      bytes
    }
  } catch {
    return {
      ok: false,
      message: "audio chunk is not valid base64"
    }
  }
}

export function encodeAudioChunkBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64")
}

export function isSupportedInputAudioMimeType(value: unknown): value is typeof LIVE_INPUT_AUDIO_FORMAT.mimeType {
  return value === LIVE_INPUT_AUDIO_FORMAT.mimeType
}

export function isSupportedOutputAudioMimeType(
  value: unknown
): value is typeof LIVE_OUTPUT_AUDIO_FORMAT.mimeType {
  return value === LIVE_OUTPUT_AUDIO_FORMAT.mimeType
}
