import { describe, expect, it } from "vitest"
import { appendTurn, setActiveTopics } from "../src/utils/context"

describe("context utils", () => {
  it("trims turns to max length", () => {
    const context = {
      turns: Array.from({ length: 10 }).map((_, idx) => ({
        intent: { type: "UserSpeech", summary: `turn ${idx}` },
        action: "respond",
        result: "ok",
        timestamp: idx
      })),
      activeTopics: [],
      threadUrl: "https://news.ycombinator.com/item?id=1"
    }

    const next = appendTurn(context, {
      intent: { type: "UserSpeech", summary: "new" },
      action: "respond",
      result: "ok",
      timestamp: 999
    })

    expect(next.turns).toHaveLength(10)
    expect(next.turns[0]?.intent.summary).toBe("turn 1")
    expect(next.turns[9]?.intent.summary).toBe("new")
  })

  it("caps active topics", () => {
    const context = {
      turns: [],
      activeTopics: [],
      threadUrl: "https://news.ycombinator.com/item?id=1"
    }
    const topics = Array.from({ length: 30 }).map((_, idx) => `topic-${idx}`)

    const updated = setActiveTopics(context, topics)
    expect(updated.activeTopics).toHaveLength(10)
  })
})
