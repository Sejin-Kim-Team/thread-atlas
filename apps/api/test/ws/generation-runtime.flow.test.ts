import request from "supertest"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Express } from "express"
import {
  createContextUpdatePayload,
  createEnvelope,
  createSessionOpenPayload,
  createUserIntentPayload,
  createValidSnapshot,
  issueAuthToken,
  postWsEventWithAuth
} from "./helpers/ws-contract"

async function createApp(): Promise<Express> {
  const mod = await import("../../src/server")
  return mod.createServer()
}

async function openSession(client: request.SuperTest<request.Test>, token: string) {
  const open = await postWsEventWithAuth(
    client,
    createEnvelope("session.open", createSessionOpenPayload(), { requestId: "req-open-gen-1" }),
    token
  )
  const sessionId = open.body?.payload?.sessionId as string

  await postWsEventWithAuth(
    client,
    createEnvelope("context.update", createContextUpdatePayload(128), {
      requestId: "req-ctx-gen-1",
      sessionId
    }),
    token
  )

  await postWsEventWithAuth(
    client,
    createEnvelope(
      "snapshot.push",
      {
        tabId: 128,
        snapshot: createValidSnapshot("2026-03-07T14:00:01.500Z")
      },
      {
        requestId: "req-snapshot-gen-1",
        sessionId
      }
    ),
    token
  )

  return sessionId
}

describe("ws generation runtime flow", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it("uses generation result instead of placeholder answer", async () => {
    // generation service 결과를 강제해 placeholder 사용 여부를 검증한다.
    vi.doMock("../../src/services/gemini", () => ({
      createGeminiClient: () => ({
        generateText: vi.fn(async () => "GENAI_ANSWER_FROM_SDK")
      })
    }))

    const app = await createApp()
    const client = request(app)
    const token = await issueAuthToken(client)
    const sessionId = await openSession(client, token)

    const intent = await postWsEventWithAuth(
      client,
      createEnvelope(
        "user.intent",
        createUserIntentPayload(128, "2026-03-07T14:00:01.500Z"),
        {
          requestId: "req-intent-gen-1",
          sessionId
        }
      ),
      token
    )

    expect(intent.status).toBe(200)
    const answerProjection = (intent.body.events as Array<{ type?: string; payload?: any }>).find(
      (event) => event.type === "projection" && event.payload?.body?.type === "answer"
    )
    expect(answerProjection).toBeDefined()
    expect(answerProjection?.payload?.body?.text).toBe("GENAI_ANSWER_FROM_SDK")
    expect(answerProjection?.payload?.body?.text).not.toBe("current-page answer placeholder")
    expect(String(answerProjection?.payload?.body?.text ?? "")).not.toContain("stubbed gemini output")
  })

  it("passes intent text and focus text into generation grounding input", async () => {
    // grounding 최소 입력(의도 + focus text)이 generation 호출 인자로 포함되는지 확인한다.
    const generateText = vi.fn(async () => "GENAI_ANSWER_WITH_GROUNDING")
    vi.doMock("../../src/services/gemini", () => ({
      createGeminiClient: () => ({
        generateText
      })
    }))

    const app = await createApp()
    const client = request(app)
    const token = await issueAuthToken(client)
    const sessionId = await openSession(client, token)

    const intentText = "Summarize this and recall similar past case"
    await postWsEventWithAuth(
      client,
      createEnvelope(
        "user.intent",
        {
          ...createUserIntentPayload(128, "2026-03-07T14:00:01.500Z"),
          text: intentText
        },
        {
          requestId: "req-intent-gen-2",
          sessionId
        }
      ),
      token
    )

    expect(generateText).toHaveBeenCalledTimes(1)
    const prompt = String(generateText.mock.calls[0]?.[0] ?? "")
    expect(prompt).toContain(intentText)
    expect(prompt).toContain("WebSocket is better for interruption and bidirectional updates.")
  })

  it("returns MODEL_CONFIG_MISSING when GOOGLE_CLOUD_PROJECT is missing", async () => {
    // 필수 Vertex 설정 누락 시 명시적 오류를 반환해야 한다.
    const previousProject = process.env.GOOGLE_CLOUD_PROJECT
    const previousLocation = process.env.GOOGLE_CLOUD_LOCATION

    delete process.env.GOOGLE_CLOUD_PROJECT
    process.env.GOOGLE_CLOUD_LOCATION = previousLocation ?? "us-central1"

    try {
      const app = await createApp()
      const client = request(app)
      const token = await issueAuthToken(client)
      const sessionId = await openSession(client, token)

      const intent = await postWsEventWithAuth(
        client,
        createEnvelope(
          "user.intent",
          createUserIntentPayload(128, "2026-03-07T14:00:01.500Z"),
          {
            requestId: "req-intent-gen-3",
            sessionId
          }
        ),
        token
      )

      expect(intent.status).toBe(400)
      expect(intent.body?.type).toBe("error")
      expect(intent.body?.payload?.code).toBe("MODEL_CONFIG_MISSING")
    } finally {
      if (previousProject === undefined) {
        delete process.env.GOOGLE_CLOUD_PROJECT
      } else {
        process.env.GOOGLE_CLOUD_PROJECT = previousProject
      }
      if (previousLocation === undefined) {
        delete process.env.GOOGLE_CLOUD_LOCATION
      } else {
        process.env.GOOGLE_CLOUD_LOCATION = previousLocation
      }
    }
  })

  it("returns GENERATION_FAILED when generation call fails with valid model config", async () => {
    // 설정이 유효해도 모델 호출 자체가 실패하면 GENERATION_FAILED여야 한다.
    vi.doMock("../../src/services/gemini", () => ({
      createGeminiClient: () => ({
        generateText: vi.fn(async () => {
          throw new Error("upstream model failure")
        })
      }),
      isModelConfigError: vi.fn(() => false)
    }))

    const previousProject = process.env.GOOGLE_CLOUD_PROJECT
    const previousLocation = process.env.GOOGLE_CLOUD_LOCATION
    process.env.GOOGLE_CLOUD_PROJECT = previousProject ?? "threadatlas"
    process.env.GOOGLE_CLOUD_LOCATION = previousLocation ?? "us-central1"

    try {
      const app = await createApp()
      const client = request(app)
      const token = await issueAuthToken(client)
      const sessionId = await openSession(client, token)

      const intent = await postWsEventWithAuth(
        client,
        createEnvelope(
          "user.intent",
          createUserIntentPayload(128, "2026-03-07T14:00:01.500Z"),
          {
            requestId: "req-intent-gen-4",
            sessionId
          }
        ),
        token
      )

      expect(intent.status).toBe(400)
      expect(intent.body?.type).toBe("error")
      expect(intent.body?.payload?.code).toBe("GENERATION_FAILED")
      expect(intent.body?.payload?.code).not.toBe("INVALID_EVENT")
    } finally {
      if (previousProject === undefined) {
        delete process.env.GOOGLE_CLOUD_PROJECT
      } else {
        process.env.GOOGLE_CLOUD_PROJECT = previousProject
      }
      if (previousLocation === undefined) {
        delete process.env.GOOGLE_CLOUD_LOCATION
      } else {
        process.env.GOOGLE_CLOUD_LOCATION = previousLocation
      }
    }
  })
})
