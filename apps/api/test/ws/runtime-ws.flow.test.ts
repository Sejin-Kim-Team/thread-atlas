import express from "express"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WebSocket as NodeWebSocket } from "ws"
import { DEFAULT_JSON_BODY_LIMIT } from "../../src/http/json-body-limit"
import { RuntimeManager } from "../../src/session/runtime/manager"
import { SemanticRuntimeManager } from "../../src/session/semantic-runtime-manager"
import { attachRuntimeWebSocketServer } from "../../src/ws/runtime-ws-server"
import { createValidSnapshot } from "./helpers/ws-contract"

const runtimeState = vi.hoisted(() => ({
  issuedTokens: new Map<string, string>()
}))

vi.mock("../../src/auth/auth-sessions-repository", () => ({
  resolveAuthSession: vi.fn(async (token: string) => {
    const userId = runtimeState.issuedTokens.get(token)
    if (!userId) {
      return { ok: false as const }
    }
    return { ok: true as const, userId }
  })
}))

vi.mock("../../src/services/gemini", () => ({
  createGeminiClient: () => ({
    generateText: vi.fn(async () => "GENAI_RUNTIME_V2_ANSWER")
  }),
  isModelConfigError: () => false
}))

vi.mock("../../src/services/gemini-live", () => ({
  createGeminiLiveSession: vi.fn(async (args: any) => {
    queueMicrotask(() => {
      args.onEvent({
        type: "ready",
        sessionId: "upstream-runtime-live-1"
      })
    })

    return {
      sendAudioChunk: vi.fn(() => {
        args.onEvent({
          type: "input-transcript",
          text: "what matters here",
          final: false
        })
      }),
      commitAudio: vi.fn(() => {
        args.onEvent({
          type: "input-transcript",
          text: "what matters here",
          final: true
        })
        args.onEvent({
          type: "tool-call",
          calls: [
            {
              id: "tool-call-1",
              name: "get_current_page_answer",
              args: {
                question: "What matters here?"
              }
            }
          ]
        })
        args.onEvent({
          type: "turn-complete",
          interrupted: false
        })
      }),
      sendToolResponses: vi.fn((responses: Array<{ response: { answerText?: string } }>) => {
        const answerText = responses[0]?.response.answerText ?? "missing"
        args.onEvent({
          type: "output-transcript",
          text: answerText,
          final: true
        })
        args.onEvent({
          type: "output-audio",
          chunkBase64: Buffer.from("pcm").toString("base64"),
          mimeType: "audio/pcm;rate=24000"
        })
        args.onEvent({
          type: "turn-complete",
          interrupted: false
        })
      }),
      close: vi.fn()
    }
  }),
  isLiveModelConfigError: () => false
}))

function createHarness(): import("http").Server {
  const app = express()
  const semanticRuntime = new SemanticRuntimeManager({
    legacyRuntime: new RuntimeManager({
      enrichTriggerMode: "rule"
    })
  })
  app.use(express.json({ limit: DEFAULT_JSON_BODY_LIMIT }))
  const server = app.listen(0)
  attachRuntimeWebSocketServer(server, semanticRuntime)
  return server
}

function getPort(server: import("http").Server): number {
  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("server port is not available")
  }
  return address.port
}

function issueToken(subject = "runtime-user"): string {
  const token = `runtime-token-${Math.random().toString(16).slice(2)}`
  runtimeState.issuedTokens.set(token, subject)
  return token
}

function connectWebSocket(url: string): Promise<NodeWebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new NodeWebSocket(url)
    const timer = setTimeout(() => {
      ws.close()
      reject(new Error("ws open timeout"))
    }, 5000)

    ws.once("open", () => {
      clearTimeout(timer)
      resolve(ws)
    })

    ws.once("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

function waitForTypes(
  ws: NodeWebSocket,
  requiredTypes: string[]
): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve, reject) => {
    const collected: Array<Record<string, unknown>> = []
    const timer = setTimeout(() => {
      reject(new Error("required runtime ws types timeout"))
    }, 10000)

    ws.on("message", (event) => {
      try {
        collected.push(JSON.parse(String(event)) as Record<string, unknown>)
      } catch {
        clearTimeout(timer)
        reject(new Error("invalid runtime ws json"))
        return
      }

      const types = new Set(collected.map((item) => String(item.type)))
      if (requiredTypes.every((type) => types.has(type))) {
        clearTimeout(timer)
        resolve(collected)
      }
    })
  })
}

function closeServer(server: import("http").Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

describe("ws /ws/runtime flow", () => {
  const servers: import("http").Server[] = []

  beforeEach(() => {
    process.env.GOOGLE_CLOUD_PROJECT = "threadatlas"
    process.env.GOOGLE_CLOUD_LOCATION = "us-central1"
    runtimeState.issuedTokens.clear()
  })

  afterEach(async () => {
    while (servers.length > 0) {
      const server = servers.pop()
      if (server) {
        await closeServer(server)
      }
    }
  })

  it("handles grounded text turns over /ws/runtime", async () => {
    const server = createHarness()
    servers.push(server)

    const token = issueToken("text-user-1")
    const ws = await connectWebSocket(`ws://127.0.0.1:${getPort(server)}/ws/runtime?token=${token}`)
    const readyPromise = waitForTypes(ws, ["session.ready"])

    ws.send(
      JSON.stringify({
        type: "session.open",
        requestId: "req-open-1",
        timestamp: "2026-03-15T10:00:00.000Z",
        payload: {
          clientSessionId: "runtime-client-1",
          language: "en-US"
        }
      })
    )

    const readyMessages = await readyPromise
    const ready = readyMessages.find((message) => message.type === "session.ready")
    const sessionId = String(ready?.sessionId ?? "")
    expect(ready?.payload).toMatchObject({
      clientSessionId: "runtime-client-1",
      reused: false
    })

    const turnMessagesPromise = waitForTypes(ws, [
      "turn.started",
      "turn.input.transcript.final",
      "turn.output.projection",
      "turn.done"
    ])

    ws.send(
      JSON.stringify({
        type: "session.context.sync",
        requestId: "req-context-1",
        timestamp: "2026-03-15T10:00:01.000Z",
        sessionId,
        payload: {
          tabId: 128,
          isPrimary: true
        }
      })
    )
    ws.send(
      JSON.stringify({
        type: "session.snapshot.sync",
        requestId: "req-snapshot-1",
        timestamp: "2026-03-15T10:00:02.000Z",
        sessionId,
        payload: {
          tabId: 128,
          snapshot: createValidSnapshot("2026-03-15T10:00:02.000Z")
        }
      })
    )
    ws.send(
      JSON.stringify({
        type: "turn.input.text",
        requestId: "req-text-1",
        timestamp: "2026-03-15T10:00:03.000Z",
        sessionId,
        payload: {
          text: "Summarize this page"
        }
      })
    )

    const messages = await turnMessagesPromise

    const projection = messages.find((message) => message.type === "turn.output.projection")
    expect(projection?.payload).toMatchObject({
      projection: {
        type: "respond",
        payload: {
          text: "GENAI_RUNTIME_V2_ANSWER",
          mode: "answer"
        }
      }
    })

    ws.close()
  }, 15000)

  it("handles grounded voice turns over /ws/runtime", async () => {
    const server = createHarness()
    servers.push(server)

    const token = issueToken("voice-user-1")
    const ws = await connectWebSocket(`ws://127.0.0.1:${getPort(server)}/ws/runtime?token=${token}`)
    const readyPromise = waitForTypes(ws, ["session.ready"])

    ws.send(
      JSON.stringify({
        type: "session.open",
        requestId: "req-open-voice",
        timestamp: "2026-03-15T10:10:00.000Z",
        payload: {
          clientSessionId: "runtime-client-voice",
          language: "en-US"
        }
      })
    )

    const readyMessages = await readyPromise
    const ready = readyMessages.find((message) => message.type === "session.ready")
    const sessionId = String(ready?.sessionId ?? "")

    const turnMessagesPromise = waitForTypes(ws, [
      "turn.started",
      "turn.input.transcript.final",
      "turn.output.transcript.final",
      "turn.output.audio.chunk",
      "turn.output.projection",
      "turn.done"
    ])

    ws.send(
      JSON.stringify({
        type: "session.context.sync",
        requestId: "req-context-voice",
        timestamp: "2026-03-15T10:10:01.000Z",
        sessionId,
        payload: {
          tabId: 128,
          isPrimary: true
        }
      })
    )
    ws.send(
      JSON.stringify({
        type: "session.snapshot.sync",
        requestId: "req-snapshot-voice",
        timestamp: "2026-03-15T10:10:02.000Z",
        sessionId,
        payload: {
          tabId: 128,
          snapshot: createValidSnapshot("2026-03-15T10:10:02.000Z")
        }
      })
    )
    ws.send(
      JSON.stringify({
        type: "turn.input.audio.append",
        requestId: "req-audio-voice",
        timestamp: "2026-03-15T10:10:03.000Z",
        sessionId,
        payload: {
          chunkBase64: Buffer.from("pcm").toString("base64")
        }
      })
    )
    ws.send(
      JSON.stringify({
        type: "turn.input.audio.commit",
        requestId: "req-commit-voice",
        timestamp: "2026-03-15T10:10:04.000Z",
        sessionId,
        payload: {
          endOfTurn: true
        }
      })
    )

    const messages = await turnMessagesPromise

    const outputTranscript = messages.find((message) => message.type === "turn.output.transcript.final")
    expect(outputTranscript?.payload).toMatchObject({
      text: "GENAI_RUNTIME_V2_ANSWER"
    })

    const audioChunk = messages.find((message) => message.type === "turn.output.audio.chunk")
    expect(audioChunk?.payload).toMatchObject({
      chunkBase64: Buffer.from("pcm").toString("base64")
    })

    ws.close()
  }, 15000)
})
