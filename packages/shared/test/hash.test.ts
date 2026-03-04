import { describe, expect, it } from "vitest"
import { hashUrl } from "../src/utils/hash"

describe("hashUrl", () => {
  it("returns deterministic 16-char hash", () => {
    const a = hashUrl("https://news.ycombinator.com/item?id=39900001")
    const b = hashUrl("https://news.ycombinator.com/item?id=39900001")

    expect(a).toBe(b)
    expect(a).toHaveLength(16)
  })

  it("returns different value for different urls", () => {
    const a = hashUrl("https://news.ycombinator.com/item?id=1")
    const b = hashUrl("https://news.ycombinator.com/item?id=2")

    expect(a).not.toBe(b)
  })
})
