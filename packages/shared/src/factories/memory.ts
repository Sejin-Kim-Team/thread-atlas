import type { InterestProfile, MemoryDelta } from "../types/memory"

export function createEmptyInterestProfile(): InterestProfile {
  return {
    topics: {},
    updatedAt: Date.now()
  }
}

export function createMemoryDelta(
  topicDeltas: Record<string, number>,
  highlights: string[] = []
): MemoryDelta {
  return {
    interestProfile: { topicDeltas },
    threadHistory: {
      highlights,
      turnCountDelta: 1
    }
  }
}

export function mergeTopicDeltas(
  base: Record<string, number>,
  incoming: Record<string, number>
): Record<string, number> {
  const merged: Record<string, number> = { ...base }
  for (const [topic, count] of Object.entries(incoming)) {
    merged[topic] = (merged[topic] ?? 0) + count
  }
  return merged
}
