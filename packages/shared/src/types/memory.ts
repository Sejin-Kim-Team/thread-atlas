import type { Claim } from "./semantics"

export interface InterestProfile {
  topics: Record<string, number>
  updatedAt: number
}

export interface ThreadHistoryEntry {
  url: string
  title: string
  topic: string
  claims: Claim[]
  readAt: number
  lastAccessedAt: number
  highlights: string[]
  turnCount: number
}

export interface MemoryDelta {
  interestProfile?: {
    topicDeltas: Record<string, number>
  }
  threadHistory?: {
    highlights: string[]
    turnCountDelta: number
  }
}
