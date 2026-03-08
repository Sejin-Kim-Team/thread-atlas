import { GoogleGenAI } from "@google/genai"

const DEFAULT_GENERATION_MODEL = "gemini-2.5-flash"

export class ModelConfigError extends Error {
  readonly code = "MODEL_CONFIG_MISSING"
}

export interface GeminiClient {
  generateText(prompt: string): Promise<string>
}

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

export function createGeminiClient(): GeminiClient {
  const config = resolveModelConfig()
  const ai = new GoogleGenAI({
    vertexai: true,
    project: config.project,
    location: config.location
  })

  return {
    async generateText(prompt: string): Promise<string> {
      const response = await ai.models.generateContent({
        model: config.model,
        contents: prompt
      })
      const text = response.text
      if (!text || text.trim().length === 0) {
        throw new Error("empty model response")
      }
      return text.trim()
    }
  }
}
