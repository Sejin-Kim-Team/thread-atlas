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

  it("accepts canonical visual summary kind values case-insensitively", async () => {
    generateContentMock.mockResolvedValueOnce({
      text: JSON.stringify({
        visualSummary: {
          kind: "Chart-Summary",
          summaryText: "A bar chart compares weekly signups.",
          extractedLabels: ["Weekly signups"]
        }
      })
    })

    const { createGeminiClient } = await import("../../src/services/gemini")
    const client = createGeminiClient()
    const result = await client.generateStructuredVisualSummary?.({
      intentText: "차트 유형 알려줘",
      focusText: "weekly signups bar chart",
      requestKind: "visible-region",
      targetRef: {
        kind: "region",
        pageUrl: "https://example.com/chart",
        region: "focus-node-region"
      }
    })

    expect(result?.visualSummary.kind).toBe("chart-summary")
  })

  it("accepts canonical chart enums case-insensitively", async () => {
    generateContentMock.mockResolvedValueOnce({
      text: JSON.stringify({
        visualSummary: {
          kind: "chart-summary",
          summaryText: "A bar chart trends upward.",
          extractedLabels: ["Revenue"],
          chart: {
            chartType: "Bar",
            trend: "Up"
          }
        }
      })
    })

    const { createGeminiClient } = await import("../../src/services/gemini")
    const client = createGeminiClient()
    const result = await client.generateStructuredVisualSummary?.({
      intentText: "차트 추세 알려줘",
      focusText: "Revenue bar chart",
      requestKind: "visible-region",
      targetRef: {
        kind: "region",
        pageUrl: "https://example.com/chart",
        region: "focus-node-region"
      }
    })

    expect(result?.visualSummary.chart?.chartType).toBe("bar")
    expect(result?.visualSummary.chart?.trend).toBe("up")
  })

  it("drops subtype fields that do not match the normalized visual summary kind", async () => {
    generateContentMock.mockResolvedValueOnce({
      text: JSON.stringify({
        visualSummary: {
          kind: "ui-visual-summary",
          summaryText: "A dashboard toolbar is visible.",
          extractedLabels: ["Dashboard"],
          chart: {
            chartType: "bar",
            trend: "up",
            comparedSeries: ["Revenue"]
          },
          uiVisual: {
            visibleControls: ["Refresh", "Share"],
            visibleSections: ["Toolbar", "Filters"]
          }
        }
      })
    })

    const { createGeminiClient } = await import("../../src/services/gemini")
    const client = createGeminiClient()
    const result = await client.generateStructuredVisualSummary?.({
      intentText: "보이는 UI를 요약해줘",
      focusText: "dashboard toolbar",
      requestKind: "visible-region",
      targetRef: {
        kind: "region",
        pageUrl: "https://example.com/dashboard",
        region: "focus-node-region"
      }
    })

    expect(result?.visualSummary.kind).toBe("ui-visual-summary")
    expect(result?.visualSummary.chart).toBeUndefined()
    expect(result?.visualSummary.uiVisual).toEqual({
      visibleControls: ["Refresh", "Share"],
      visibleSections: ["Toolbar", "Filters"]
    })
  })
})
