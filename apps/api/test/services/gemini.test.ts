import { beforeEach, describe, expect, it, vi } from "vitest"

const generateContentMock = vi.fn()

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = {
      generateContent: generateContentMock
    }
  },
  Type: {
    OBJECT: "OBJECT",
    STRING: "STRING",
    ARRAY: "ARRAY"
  },
  createPartFromBase64: vi.fn((data: string, mimeType: string) => ({
    inlineData: { data, mimeType }
  })),
  createPartFromText: vi.fn((text: string) => ({ text })),
  createUserContent: vi.fn((parts: unknown[]) => ({ role: "user", parts }))
}))

describe("createGeminiClient", () => {
  beforeEach(() => {
    vi.resetModules()
    generateContentMock.mockReset()
    process.env.GOOGLE_CLOUD_PROJECT = "threadatlas"
    process.env.GOOGLE_CLOUD_LOCATION = "us-central1"
    process.env.GOOGLE_GENERATION_MODEL = "gemini-2.5-flash"
  })

  it("normalizes non-canonical chart enums from model output to unknown", async () => {
    generateContentMock.mockResolvedValueOnce({
      text: JSON.stringify({
        visualSummary: {
          kind: "chart-summary",
          summaryText: "A histogram-like chart trends sharply.",
          extractedLabels: ["Revenue"],
          chart: {
            chartType: "histogram",
            trend: "spiky",
            comparedSeries: ["Revenue"]
          }
        }
      })
    })

    const { createGeminiClient } = await import("../../src/services/gemini")
    const client = createGeminiClient()
    const result = await client.generateStructuredVisualSummary?.({
      intentText: "이 차트 요약해줘",
      focusText: "Revenue histogram",
      requestKind: "visible-region",
      targetRef: {
        kind: "region",
        pageUrl: "https://example.com/chart",
        region: "focus-node-region"
      }
    })

    expect(result?.visualSummary.chart?.chartType).toBe("unknown")
    expect(result?.visualSummary.chart?.trend).toBe("unknown")
  })
})
