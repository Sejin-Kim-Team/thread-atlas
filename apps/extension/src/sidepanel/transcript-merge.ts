export function mergeStreamingTranscript(current: string, incoming: string): string {
  if (!incoming) {
    return current
  }

  if (!current) {
    return incoming
  }

  if (incoming === current) {
    return current
  }

  if (incoming.startsWith(current)) {
    return incoming
  }

  if (current.startsWith(incoming)) {
    return current
  }

  const maxOverlap = Math.min(current.length, incoming.length)
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (current.slice(-overlap) === incoming.slice(0, overlap)) {
      return current + incoming.slice(overlap)
    }
  }

  return current + incoming
}
