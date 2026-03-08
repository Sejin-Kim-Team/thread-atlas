import { describe, expect, it, vi } from "vitest"
import { createLogger } from "../../src/runtime/logger"

describe("structured logger", () => {
  it("바인딩과 필드를 JSON entry로 직렬화한다", () => {
    const sink = vi.fn()
    const logger = createLogger("test/logger", {
      level: "debug",
      sink
    }).child({
      sessionId: "sess-001"
    })

    logger.info("turn-started", {
      turnId: "turn-001",
      tabId: 128
    })

    expect(sink).toHaveBeenCalledTimes(1)
    const entry = sink.mock.calls[0]?.[0]
    expect(entry).toMatchObject({
      level: "info",
      scope: "test/logger",
      event: "turn-started",
      sessionId: "sess-001",
      turnId: "turn-001",
      tabId: 128
    })
    expect(typeof entry?.timestamp).toBe("string")
  })

  it("설정된 레벨보다 낮은 로그는 버린다", () => {
    const sink = vi.fn()
    const logger = createLogger("test/logger", {
      level: "warn",
      sink
    })

    logger.debug("debug-event")
    logger.info("info-event")
    logger.warn("warn-event")

    expect(sink).toHaveBeenCalledTimes(1)
    expect(sink.mock.calls[0]?.[0]).toMatchObject({
      level: "warn",
      event: "warn-event"
    })
  })

  it("에러 객체를 안전한 로그 필드로 직렬화한다", () => {
    const sink = vi.fn()
    const logger = createLogger("test/logger", {
      level: "info",
      sink
    })
    const error = new Error("boom")

    logger.error("request-failed", {
      error
    })

    const entry = sink.mock.calls[0]?.[0]
    expect(entry).toMatchObject({
      level: "error",
      event: "request-failed"
    })
    expect(entry?.error).toMatchObject({
      name: "Error",
      message: "boom"
    })
  })
})
