import {
  GoogleGenAI,
  Modality,
  type FunctionCall,
  type FunctionDeclaration,
  type FunctionResponse,
  type LiveServerMessage
} from "@google/genai"
import { createLogger } from "../runtime/logger"

const DEFAULT_LIVE_MODEL = "gemini-live-2.5-flash-native-audio"
const DEFAULT_LIVE_VOICE = "Aoede"
const logger = createLogger("services/gemini-live")

export class LiveModelConfigError extends Error {
  readonly code = "MODEL_CONFIG_MISSING"
}

export interface GeminiLiveToolDeclaration {
  name: string
  description: string
  parametersJsonSchema: Record<string, unknown>
}

export type GeminiLiveEvent =
  | {
      type: "ready"
      sessionId: string
    }
  | {
      type: "input-transcript"
      text: string
      final: boolean
    }
  | {
      type: "output-transcript"
      text: string
      final: boolean
    }
  | {
      type: "output-audio"
      chunkBase64: string
      mimeType: string
    }
  | {
      type: "tool-call"
      calls: Array<{
        id: string
        name: string
        args: Record<string, unknown>
      }>
    }
  | {
      type: "turn-complete"
      interrupted: boolean
      reason?: string
    }

export interface GeminiLiveSession {
  sendAudioChunk(chunkBase64: string, mimeType?: string): void
  commitAudio(): void
  sendToolResponses(
    responses: Array<{
      id: string
      name: string
      response: Record<string, unknown>
    }>
  ): void
  close(): void
}

function resolveModelConfig(): {
  project: string
  location: string
  model: string
  voiceName: string
} {
  const project = process.env.GOOGLE_CLOUD_PROJECT
  const location = process.env.GOOGLE_CLOUD_LOCATION
  const model = process.env.GOOGLE_LIVE_MODEL ?? DEFAULT_LIVE_MODEL
  const voiceName = process.env.GOOGLE_LIVE_VOICE ?? DEFAULT_LIVE_VOICE

  if (!project || !location) {
    throw new LiveModelConfigError("GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION are required")
  }

  return {
    project,
    location,
    model,
    voiceName
  }
}

export function isLiveModelConfigError(error: unknown): error is LiveModelConfigError {
  return error instanceof LiveModelConfigError
}

function normalizeLanguage(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) {
    return undefined
  }

  const primary = trimmed.split(/[-_]/)[0]?.trim().toLowerCase()
  return primary || undefined
}

function toFunctionDeclarations(tools: GeminiLiveToolDeclaration[]): FunctionDeclaration[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parametersJsonSchema: tool.parametersJsonSchema
  }))
}

function emitServerContent(event: LiveServerMessage, emit: (event: GeminiLiveEvent) => void): void {
  const serverContent = event.serverContent
  if (!serverContent) {
    return
  }

  const inputTranscription = serverContent.inputTranscription
  if (inputTranscription?.text) {
    emit({
      type: "input-transcript",
      text: inputTranscription.text,
      final: Boolean(inputTranscription.finished)
    })
  }

  const outputTranscription = serverContent.outputTranscription
  if (outputTranscription?.text) {
    emit({
      type: "output-transcript",
      text: outputTranscription.text,
      final: Boolean(outputTranscription.finished)
    })
  }

  for (const part of serverContent.modelTurn?.parts ?? []) {
    const inlineData = part.inlineData
    if (!inlineData?.data || !inlineData.mimeType?.startsWith("audio/")) {
      continue
    }

    emit({
      type: "output-audio",
      chunkBase64: inlineData.data,
      mimeType: inlineData.mimeType
    })
  }

  if (serverContent.turnComplete) {
    const turnCompleteEvent: GeminiLiveEvent = {
      type: "turn-complete",
      interrupted: Boolean(serverContent.interrupted)
    }
    if (serverContent.turnCompleteReason) {
      turnCompleteEvent.reason = serverContent.turnCompleteReason
    }
    emit(turnCompleteEvent)
  }
}

export async function createGeminiLiveSession(args: {
  language?: string
  systemInstruction: string
  tools: GeminiLiveToolDeclaration[]
  onEvent: (event: GeminiLiveEvent) => void
  onError?: (error: Error) => void
  onClose?: () => void
}): Promise<GeminiLiveSession> {
  const config = resolveModelConfig()
  const languageCode = normalizeLanguage(args.language)
  logger.info("gemini-live-client-configured", {
    model: config.model,
    project: config.project,
    location: config.location
  })

  const ai = new GoogleGenAI({
    vertexai: true,
    project: config.project,
    location: config.location
  })

  const session = await ai.live.connect({
    model: config.model,
    config: {
      responseModalities: [Modality.AUDIO],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: config.voiceName
          }
        },
        ...(languageCode ? { languageCode } : {})
      },
      systemInstruction: args.systemInstruction,
      ...(args.tools.length > 0
        ? {
            tools: [
              {
                functionDeclarations: toFunctionDeclarations(args.tools)
              }
            ]
          }
        : {})
    },
    callbacks: {
      onopen: () => {
        logger.info("gemini-live-opened", {
          model: config.model
        })
      },
      onmessage: (event) => {
        if (event.setupComplete?.sessionId) {
          args.onEvent({
            type: "ready",
            sessionId: event.setupComplete.sessionId
          })
        }

        const functionCalls = event.toolCall?.functionCalls
        if (functionCalls && functionCalls.length > 0) {
          const normalized = functionCalls
            .filter((call): call is FunctionCall & { id: string; name: string; args: Record<string, unknown> } =>
              typeof call.id === "string" &&
              typeof call.name === "string" &&
              !!call.args &&
              typeof call.args === "object"
            )
            .map((call) => ({
              id: call.id,
              name: call.name,
              args: call.args
            }))

          if (normalized.length > 0) {
            args.onEvent({
              type: "tool-call",
              calls: normalized
            })
          }
        }

        emitServerContent(event, args.onEvent)
      },
      onerror: (event) => {
        const error =
          event.error instanceof Error
            ? event.error
            : new Error(event.message || "Gemini Live session failed.")
        logger.error("gemini-live-error", {
          error
        })
        args.onError?.(error)
      },
      onclose: () => {
        logger.info("gemini-live-closed", {
          model: config.model
        })
        args.onClose?.()
      }
    }
  })

  return {
    sendAudioChunk(chunkBase64: string, mimeType = "audio/pcm;rate=16000") {
      session.sendRealtimeInput({
        audio: {
          data: chunkBase64,
          mimeType
        }
      })
    },
    commitAudio() {
      session.sendRealtimeInput({
        audioStreamEnd: true
      })
    },
    sendToolResponses(responses) {
      const functionResponses: FunctionResponse[] = responses.map((response) => ({
        id: response.id,
        name: response.name,
        response: response.response
      }))
      session.sendToolResponse({
        functionResponses
      })
    },
    close() {
      session.close()
    }
  }
}
