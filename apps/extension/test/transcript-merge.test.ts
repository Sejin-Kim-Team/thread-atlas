import { describe, expect, it } from "vitest"
import { mergeStreamingTranscript } from "../src/sidepanel/transcript-merge"

describe("mergeStreamingTranscript", () => {
  it("appends delta-style transcript chunks", () => {
    expect(mergeStreamingTranscript("이 페이지는", " 판매되지 않아")).toBe(
      "이 페이지는 판매되지 않아"
    )
  })

  it("accepts cumulative transcript updates without duplicating text", () => {
    expect(mergeStreamingTranscript("The page", "The page explains")).toBe("The page explains")
  })

  it("deduplicates overlapping transcript boundaries", () => {
    expect(mergeStreamingTranscript("판매", "판매되지 않아")).toBe("판매되지 않아")
    expect(mergeStreamingTranscript("이 페이지는 판매", "판매되지 않아")).toBe(
      "이 페이지는 판매되지 않아"
    )
  })

  it("keeps the longer transcript when an older shorter chunk arrives late", () => {
    expect(mergeStreamingTranscript("The page explains", "The page")).toBe("The page explains")
  })
})
