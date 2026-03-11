import {
  GoogleGenAI,
  Type,
  createPartFromBase64,
  createPartFromText,
  createUserContent
} from "@google/genai"
import { createLogger } from "../runtime/logger"
import { buildVisualDerivedSummary } from "../session/visual/summary"
import type { VisualReasonerInput, VisualReasonerOutput } from "../session/visual/types"

const DEFAULT_GENERATION_MODEL = "gemini-2.5-flash"
const logger = createLogger("services/gemini")

export class ModelConfigError extends Error {
  readonly code = "MODEL_CONFIG_MISSING"
}

export interface GeminiClient {
  generateText(prompt: string): Promise<string>
  generateStructuredVisualSummary?(input: VisualReasonerInput): Promise<VisualReasonerOutput>
}

const VISUAL_SUMMARY_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    visualSummary: {
      type: Type.OBJECT,
      properties: {
        kind: { type: Type.STRING },
        summaryText: { type: Type.STRING },
        extractedLabels: {
          type: Type.ARRAY,
          items: { type: Type.STRING }
        },
        extractedText: {
          type: Type.ARRAY,
          items: { type: Type.STRING }
        },
        chart: {
          type: Type.OBJECT,
          properties: {
            chartType: { type: Type.STRING },
            trend: { type: Type.STRING },
            comparedSeries: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          }
        },
        diagram: {
          type: Type.OBJECT,
          properties: {
            entities: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            relations: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          }
        },
        uiVisual: {
          type: Type.OBJECT,
          properties: {
            visibleControls: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            visibleSections: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          }
        }
      },
      required: ["kind", "summaryText", "extractedLabels"]
    },
    answerSupplement: {
      type: Type.STRING
    }
  },
  required: ["visualSummary"]
} as const

function resolveModelConfig(): {
  project: string
  location: string
  model: string
} {
  const project = process.env.GOOGLE_CLOUD_PROJECT
  const location = process.env.GOOGLE_CLOUD_LOCATION
  const model = process.env.GOOGLE_GENERATION_MODEL ?? DEFAULT_GENERATION_MODEL

  if (!project || !location) {
    throw new ModelConfigError("GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION are required")
  }

  return {
    project,
    location,
    model
  }
}

export function isModelConfigError(error: unknown): error is ModelConfigError {
  return error instanceof ModelConfigError
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }
  const normalized = value.replace(/\s+/g, " ").trim()
  return normalized.length > 0 ? normalized : null
}

function normalizeStringArray(value: unknown, limit = 12): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  const deduped = new Set<string>()
  for (const entry of value) {
    const normalized = normalizeText(entry)
    if (!normalized) {
      continue
    }
    deduped.add(normalized)
    if (deduped.size >= limit) {
      break
    }
  }
  return [...deduped]
}

function normalizeChartType(
  value: unknown
): "line" | "bar" | "pie" | "scatter" | "table-like" | "unknown" | null {
  const normalized = normalizeText(value)
  if (!normalized) {
    return null
  }
  return normalized === "line" ||
    normalized === "bar" ||
    normalized === "pie" ||
    normalized === "scatter" ||
    normalized === "table-like" ||
    normalized === "unknown"
    ? normalized
    : "unknown"
}

function normalizeChartTrend(
  value: unknown
): "up" | "down" | "flat" | "mixed" | "unknown" | null {
  const normalized = normalizeText(value)
  if (!normalized) {
    return null
  }
  return normalized === "up" ||
    normalized === "down" ||
    normalized === "flat" ||
    normalized === "mixed" ||
    normalized === "unknown"
    ? normalized
    : "unknown"
}

function buildVisualSummaryPrompt(input: VisualReasonerInput): string {
  const promptLines = [
    "You analyze current-page visual evidence for a browser assistant.",
    "Return JSON that matches the provided schema.",
    `User intent: ${input.intentText}`,
    `Focus text: ${input.focusText || "n/a"}`,
    `Request kind: ${input.requestKind}`,
    `Target ref: ${JSON.stringify(input.targetRef)}`
  ]

  if (input.detail) {
    promptLines.push(`Normalized detail: ${JSON.stringify(input.detail)}`)
  }

  promptLines.push(
    "Infer one visual summary kind among chart-summary, diagram-summary, ui-visual-summary.",
    "Keep the summary grounded to the provided current-page evidence only.",
    "Do not mention any unsupported certainty."
  )

  return promptLines.join("\n")
}

function parseVisualReasonerOutput(rawText: string): VisualReasonerOutput {
  const parsed = JSON.parse(rawText) as unknown
  if (!isObject(parsed) || !isObject(parsed.visualSummary)) {
    throw new Error("visual summary response is not a valid object")
  }

  const visualSummary = parsed.visualSummary
  const kind = normalizeText(visualSummary.kind)
  const summaryText = normalizeText(visualSummary.summaryText)
  if (
    !kind ||
    !summaryText ||
    (kind !== "chart-summary" && kind !== "diagram-summary" && kind !== "ui-visual-summary")
  ) {
    throw new Error("visual summary response is missing required fields")
  }

  const visualSummaryInput: Parameters<typeof buildVisualDerivedSummary>[0] = {
    kind,
    summaryText,
    extractedLabels: normalizeStringArray(visualSummary.extractedLabels)
  }

  const extractedText = normalizeStringArray(visualSummary.extractedText)
  if (extractedText.length > 0) {
    visualSummaryInput.extractedText = extractedText
  }

  if (isObject(visualSummary.chart)) {
    const chart: NonNullable<typeof visualSummaryInput.chart> = {}
    const chartType = normalizeChartType(visualSummary.chart.chartType)
    const trend = normalizeChartTrend(visualSummary.chart.trend)
    const comparedSeries = normalizeStringArray(visualSummary.chart.comparedSeries)
    if (chartType) {
      chart.chartType = chartType
    }
    if (trend) {
      chart.trend = trend
    }
    if (comparedSeries.length > 0) {
      chart.comparedSeries = comparedSeries
    }
    if (Object.keys(chart).length > 0) {
      visualSummaryInput.chart = chart
    }
  }

  if (isObject(visualSummary.diagram)) {
    const diagram: NonNullable<typeof visualSummaryInput.diagram> = {}
    const entities = normalizeStringArray(visualSummary.diagram.entities)
    const relations = normalizeStringArray(visualSummary.diagram.relations)
    if (entities.length > 0) {
      diagram.entities = entities
    }
    if (relations.length > 0) {
      diagram.relations = relations
    }
    if (Object.keys(diagram).length > 0) {
      visualSummaryInput.diagram = diagram
    }
  }

  if (isObject(visualSummary.uiVisual)) {
    const uiVisual: NonNullable<typeof visualSummaryInput.uiVisual> = {}
    const visibleControls = normalizeStringArray(visualSummary.uiVisual.visibleControls)
    const visibleSections = normalizeStringArray(visualSummary.uiVisual.visibleSections)
    if (visibleControls.length > 0) {
      uiVisual.visibleControls = visibleControls
    }
    if (visibleSections.length > 0) {
      uiVisual.visibleSections = visibleSections
    }
    if (Object.keys(uiVisual).length > 0) {
      visualSummaryInput.uiVisual = uiVisual
    }
  }

  const normalized: VisualReasonerOutput = {
    visualSummary: buildVisualDerivedSummary(visualSummaryInput)
  }

  const answerSupplement = normalizeText(parsed.answerSupplement)
  if (answerSupplement) {
    normalized.answerSupplement = answerSupplement
  }

  return normalized
}

export function createGeminiClient(): GeminiClient {
  const config = resolveModelConfig()
  logger.info("gemini-client-configured", {
    model: config.model,
    project: config.project,
    location: config.location
  })
  const ai = new GoogleGenAI({
    vertexai: true,
    project: config.project,
    location: config.location
  })

  return {
    async generateText(prompt: string): Promise<string> {
      logger.debug("gemini-generate-started", {
        model: config.model,
        promptLength: prompt.length
      })
      try {
        const response = await ai.models.generateContent({
          model: config.model,
          contents: prompt
        })
        const text = response.text
        if (!text || text.trim().length === 0) {
          throw new Error("empty model response")
        }
        logger.info("gemini-generate-completed", {
          model: config.model,
          promptLength: prompt.length,
          responseLength: text.trim().length
        })
        return text.trim()
      } catch (error) {
        logger.error("gemini-generate-failed", {
          model: config.model,
          promptLength: prompt.length,
          error
        })
        throw error
      }
    },
    async generateStructuredVisualSummary(
      input: VisualReasonerInput
    ): Promise<VisualReasonerOutput> {
      const prompt = buildVisualSummaryPrompt(input)
      const parts = [createPartFromText(prompt)]
      if (input.image) {
        parts.push(createPartFromBase64(input.image.imageBytes, input.image.mimeType))
      }

      logger.debug("gemini-visual-summary-started", {
        model: config.model,
        requestKind: input.requestKind,
        hasImage: Boolean(input.image),
        hasDetail: Boolean(input.detail)
      })

      try {
        const response = await ai.models.generateContent({
          model: config.model,
          contents: createUserContent(parts),
          config: {
            responseMimeType: "application/json",
            responseSchema: VISUAL_SUMMARY_RESPONSE_SCHEMA
          }
        })
        const text = response.text
        if (!text || text.trim().length === 0) {
          throw new Error("empty visual summary response")
        }
        const parsed = parseVisualReasonerOutput(text)
        logger.info("gemini-visual-summary-completed", {
          model: config.model,
          requestKind: input.requestKind,
          visualKind: parsed.visualSummary.kind
        })
        return parsed
      } catch (error) {
        logger.error("gemini-visual-summary-failed", {
          model: config.model,
          requestKind: input.requestKind,
          error
        })
        throw error
      }
    }
  }
}
