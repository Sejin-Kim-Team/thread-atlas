import express from "express"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WebSocket as NodeWebSocket } from "ws"
import { DEFAULT_JSON_BODY_LIMIT } from "../../src/http/json-body-limit"
import { RuntimeManager } from "../../src/session/runtime/manager"
import { attachLiveWebSocketServer } from "../../src/ws/live-ws-server"
import { createValidSnapshot } from "./helpers/ws-contract"

const liveState = vi.hoisted(() => ({
  issuedTokens: new Map<string, string>()
}))

vi.mock("../../src/auth/auth-sessions-repository", () => ({
  resolveAuthSession: vi.fn(async (token: string) => {
    const userId = liveState.issuedTokens.get(token)
    if (!userId) {
      return { ok: false as const }
    }
    return { ok: true as const, userId }
  })
}))

vi.mock("../../src/services/gemini", () => ({
  createGeminiClient: () => ({
    generateText: vi.fn(async () => "LIVE_RUNTIME_TOOL_ANSWER")
  }),
  isModelConfigError: () => false
}))

vi.mock("../../src/services/gemini-live", () => ({
  createGeminiLiveSession: vi.fn(async (args: any) => {
    queueMicrotask(() => {
      args.onEvent({
        type: "ready",
        sessionId: "upstream-live-session-1"
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
  const runtime = new RuntimeManager({
    enrichTriggerMode: "rule"
  })
  app.use(express.json({ limit: DEFAULT_JSON_BODY_LIMIT }))
  const server = app.listen(0)
  attachLiveWebSocketServer(server, runtime)
  return server
}

function getPort(server: import("http").Server): number {
  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("server port is not available")
  }
  return address.port
}

function issueToken(subject = "live-user"): string {
  const token = `live-token-${Math.random().toString(16).slice(2)}`
  liveState.issuedTokens.set(token, subject)
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
      reject(new Error("required live ws types timeout"))
    }, 10000)

    ws.on("message", (event) => {
      try {
        collected.push(JSON.parse(String(event)) as Record<string, unknown>)
      } catch {
        clearTimeout(timer)
        reject(new Error("invalid live ws json"))
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

describe("ws /ws/live flow", () => {
  const servers: import("http").Server[] = []

  beforeEach(() => {
    process.env.GOOGLE_CLOUD_PROJECT = "threadatlas"
    process.env.GOOGLE_CLOUD_LOCATION = "us-central1"
    liveState.issuedTokens.clear()
  })

  afterEach(async () => {
    while (servers.length > 0) {
      const server = servers.pop()
      if (server) {
        await closeServer(server)
      }
    }
  })

  it(
    "relays live audio, transcripts, and tool-grounded answers",
    async () => {
    const server = createHarness()
    servers.push(server)

    const token = issueToken("voice-user-1")
    const ws = await connectWebSocket(`ws://127.0.0.1:${getPort(server)}/ws/live?token=${token}`)

      ws.send(
      JSON.stringify({
        type: "live.open",
        requestId: "req-open-1",
        timestamp: "2026-03-15T10:00:00.000Z",
        payload: {
          clientSessionId: "voice-client-1",
          tabId: 128,
          snapshot: createValidSnapshot("2026-03-15T10:00:00.000Z"),
          language: "en-US"
        }
      })
      )

      const readyMessages = await waitForTypes(ws, ["live.ready"])

      ws.send(
      JSON.stringify({
        type: "live.audio.append",
        requestId: "req-audio-1",
        timestamp: "2026-03-15T10:00:01.000Z",
        payload: {
          chunkBase64: Buffer.from("pcm").toString("base64")
        }
      })
      )

      ws.send(
      JSON.stringify({
        type: "live.audio.commit",
        requestId: "req-commit-1",
        timestamp: "2026-03-15T10:00:02.000Z",
        payload: {
          endOfTurn: true
        }
      })
      )

      const messages = await waitForTypes(ws, [
        "live.input.transcript.final",
        "live.output.transcript.final",
        "live.output.audio.chunk",
        "live.turn.done"
      ])

      expect(messages.map((message) => message.type)).toEqual(
        expect.arrayContaining([
          "live.input.transcript.final",
          "live.output.transcript.final",
          "live.output.audio.chunk",
          "live.turn.done"
        ])
      )

      const ready = readyMessages.find((message) => message.type === "live.ready")
      expect(ready?.payload).toMatchObject({
        clientSessionId: "voice-client-1",
        model: "gemini-live-2.5-flash-native-audio"
      })

      const outputTranscript = messages.find((message) => message.type === "live.output.transcript.final")
      expect(outputTranscript?.payload).toMatchObject({
        text: "LIVE_RUNTIME_TOOL_ANSWER"
      })

      const audioChunk = messages.find((message) => message.type === "live.output.audio.chunk")
      expect(audioChunk?.payload).toMatchObject({
        mimeType: "audio/pcm;rate=24000"
      })

      await new Promise<void>((resolve) => {
        ws.once("close", () => resolve())
        ws.close()
      })
    },
    15000
  )
})
