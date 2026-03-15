function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

export function measurePcm16Base64Level(base64: string): number {
  const bytes = base64ToBytes(base64)
  if (bytes.byteLength < 2) {
    return 0
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const sampleCount = Math.floor(bytes.byteLength / 2)
  let total = 0
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = view.getInt16(index * 2, true) / 0x8000
    total += sample * sample
  }

  const rms = Math.sqrt(total / sampleCount)
  return Math.max(0, Math.min(1, rms * 4))
}

export function decodePcm16Base64ToFloat32(base64: string): Float32Array {
  const bytes = base64ToBytes(base64)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const sampleCount = Math.floor(bytes.byteLength / 2)
  const output = new Float32Array(sampleCount)
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = view.getInt16(index * 2, true)
    output[index] = sample / 0x8000
  }
  return output
}
