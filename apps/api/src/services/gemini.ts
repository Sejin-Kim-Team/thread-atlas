import {
  GoogleGenAI,
  createPartFromFunctionCall,
  createPartFromFunctionResponse,
  type Content,
  type FunctionCall,
  type FunctionDeclaration
} from "@google/genai"
import { createLogger } from "../runtime/logger"

const DEFAULT_GENERATION_MODEL = "gemini-2.5-flash"
const logger = createLogger("services/gemini")

export class ModelConfigError extends Error {
  readonly code = "MODEL_CONFIG_MISSING"
}

export interface GeminiToolCall {
  name: string
  args: Record<string, unknown>
  id: string | undefined
}

export interface GeminiToolResponse {
  text: string | undefined
  toolCalls: GeminiToolCall[] | undefined
}

export interface GeminiClient {
  generateText(prompt: string): Promise<string>
  generateWithTools(
    contents: Content[],
    tools: FunctionDeclaration[],
    systemInstruction?: string
  ): Promise<GeminiToolResponse>
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

    async generateWithTools(
      contents: Content[],
      tools: FunctionDeclaration[],
      systemInstruction?: string
    ): Promise<GeminiToolResponse> {
      logger.debug("gemini-tool-generate-started", {
        model: config.model,
        contentTurns: contents.length,
        toolCount: tools.length
      })
      try {
        const response = await ai.models.generateContent({
          model: config.model,
          contents,
          config: {
            tools: [{ functionDeclarations: tools }],
            ...(systemInstruction ? { systemInstruction } : {})
          }
        })

        const functionCalls = response.functionCalls
        if (functionCalls && functionCalls.length > 0) {
          logger.info("gemini-tool-calls-received", {
            model: config.model,
            callCount: functionCalls.length,
            toolNames: functionCalls.map((fc) => fc.name)
          })
          return {
            text: undefined,
            toolCalls: functionCalls.map((fc) => ({
              name: fc.name ?? "unknown",
              args: fc.args ?? {},
              id: fc.id ?? undefined
            }))
          }
        }

        const text = response.text?.trim()
        logger.info("gemini-tool-generate-completed", {
          model: config.model,
          responseLength: text?.length ?? 0
        })
        return { text: text || undefined, toolCalls: undefined }
      } catch (error) {
        logger.error("gemini-tool-generate-failed", {
          model: config.model,
          error
        })
        throw error
      }
    }
  }
}

// Re-export helpers for building multi-turn tool conversations
export { createPartFromFunctionCall, createPartFromFunctionResponse }
export type { Content, FunctionCall, FunctionDeclaration }
