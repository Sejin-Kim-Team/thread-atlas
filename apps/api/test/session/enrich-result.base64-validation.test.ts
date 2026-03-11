import { describe, expect, it } from "vitest"
import { normalizeEnrichEvidence } from "../../src/session/visual/enrich-result"

describe("normalizeEnrichEvidence base64 validation", () => {
  const baseInput = {
    requestKind: "visible-region" as const,
    targetRef: {
      type: "visible-region",
      tabId: 1,
      pageUrl: "https://example.com"
    },
    capturedAt: "2026-03-10T00:00:00.000Z",
    mimeType: "image/png"
  }

  it("rejects malformed base64 payloads", () => {
    const result = normalizeEnrichEvidence({
      ...baseInput,
      imageBase64: "%%%not-base64%%%"
    })

    expect(result).toEqual({
      ok: false,
      message: "imageBase64 is not valid base64"
    })
  })

  it("rejects data-url style payloads in imageBase64", () => {
    const dataUrlPayload = `data:image/png;base64,${Buffer.from("png-bytes").toString("base64")}`
    const result = normalizeEnrichEvidence({
      ...baseInput,
      imageBase64: dataUrlPayload
    })

    expect(result).toEqual({
      ok: false,
      message: "imageBase64 is not valid base64"
    })
  })

  it("accepts canonical base64 payloads", () => {
    const encoded = Buffer.from("valid-image-bytes").toString("base64")
    const result = normalizeEnrichEvidence({
      ...baseInput,
      imageBase64: encoded
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.evidence.image).toEqual({
      mimeType: "image/png",
      imageBytes: encoded
    })
  })
})
