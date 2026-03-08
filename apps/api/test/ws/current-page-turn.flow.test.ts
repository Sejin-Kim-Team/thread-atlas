import request from "supertest"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Express } from "express"
import {
  assertOrderedEventTypes,
  createContextUpdatePayload,
  createEnvelope,
  createSessionOpenPayload,
  issueAuthToken,
  createUserIntentPayload,
  createValidSnapshot,
  postWsEventWithAuth
} from "./helpers/ws-contract"

const generateTextMock = vi.fn(async () => "GENAI_FLOW_TEST_ANSWER")

async function createApp(): Promise<Express> {
  const mod = await import("../../src/server")
  return mod.createServer()
}

describe("ws current-page turn flow", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT ?? "threadatlas"
    process.env.GOOGLE_CLOUD_LOCATION = process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1"
    vi.doMock("../../src/services/gemini", () => ({
      createGeminiClient: () => ({
        // generation 품질 검증은 별도 테스트에서 다루고, 본 흐름 테스트는 이벤트 계약만 고정한다.
        generateText: generateTextMock
      }),
      isModelConfigError: () => false
    }))
  })

  it("follows open -> context.update -> snapshot.push -> user.intent and returns progress/projection/turn.done", async () => {
    const app = await createApp()
    const client = request(app)
    const token = await issueAuthToken(client)

    const open = await postWsEventWithAuth(
      client,
      createEnvelope("session.open", createSessionOpenPayload(), { requestId: "req-open-1" }),
      token
    )

    const sessionId = open.body?.payload?.sessionId

    const context = await postWsEventWithAuth(
      client,
      createEnvelope("context.update", createContextUpdatePayload(), {
        requestId: "req-ctx-1",
        sessionId
      }),
      token
    )

    const snapshot = await postWsEventWithAuth(
      client,
      createEnvelope(
        "snapshot.push",
        {
          tabId: 128,
          snapshot: createValidSnapshot()
        },
        {
          requestId: "req-snapshot-1",
          sessionId
        }
      ),
      token
    )

    const intent = await postWsEventWithAuth(
      client,
      createEnvelope("user.intent", createUserIntentPayload(), {
        requestId: "req-intent-1",
        sessionId
      }),
      token
    )

    expect(open.status).toBe(200)
    expect(context.status).toBe(200)
    expect(snapshot.status).toBe(200)
    expect(intent.status).toBe(200)
    expect(Array.isArray(intent.body.events)).toBe(true)
    expect(
      assertOrderedEventTypes(intent.body.events as Array<{ type?: string }>, [
        "progress",
        "projection",
        "turn.done"
      ])
    ).toBe(true)
  })

  it("keeps referencedTabIds in turn.done within current-page scope", async () => {
    const app = await createApp()
    const client = request(app)
    const token = await issueAuthToken(client)

    const open = await postWsEventWithAuth(
      client,
      createEnvelope("session.open", createSessionOpenPayload(), { requestId: "req-open-1" }),
      token
    )
    const sessionId = open.body?.payload?.sessionId

    await postWsEventWithAuth(
      client,
      createEnvelope("context.update", createContextUpdatePayload(128), {
        requestId: "req-ctx-1",
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
          snapshot: createValidSnapshot()
        },
        {
          requestId: "req-snapshot-1",
          sessionId
        }
      ),
      token
    )

    const intent = await postWsEventWithAuth(
      client,
      createEnvelope("user.intent", createUserIntentPayload(128), {
        requestId: "req-intent-1",
        sessionId
      }),
      token
    )

    expect(intent.status).toBe(200)
    const doneEvent = (intent.body.events as Array<{ type?: string; payload?: unknown }>).find(
      (event) => event.type === "turn.done"
    ) as { payload?: { referencedTabIds?: number[] } } | undefined

    expect(doneEvent).toBeDefined()
    expect(Array.isArray(doneEvent?.payload?.referencedTabIds)).toBe(true)
    expect(doneEvent?.payload?.referencedTabIds).toEqual([128])
  })

  it("does not rely on TURN_CONFLICT for follow-up intents", async () => {
    const app = await createApp()
    const client = request(app)
    const token = await issueAuthToken(client)

    const open = await postWsEventWithAuth(
      client,
      createEnvelope("session.open", createSessionOpenPayload(), { requestId: "req-open-1" }),
      token
    )
    const sessionId = open.body?.payload?.sessionId

    await postWsEventWithAuth(
      client,
      createEnvelope("context.update", createContextUpdatePayload(128), {
        requestId: "req-ctx-1",
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
          snapshot: createValidSnapshot()
        },
        {
          requestId: "req-snapshot-1",
          sessionId
        }
      ),
      token
    )

    await postWsEventWithAuth(
      client,
      createEnvelope("user.intent", createUserIntentPayload(128), {
        requestId: "req-intent-1",
        sessionId
      }),
      token
    )

    const followUp = await postWsEventWithAuth(
      client,
      createEnvelope("user.intent", createUserIntentPayload(128), {
        requestId: "req-intent-2",
        sessionId
      }),
      token
    )

    expect(followUp.status).toBe(200)
    expect(followUp.body.type).not.toBe("error")
    expect(followUp.body.payload?.code).not.toBe("TURN_CONFLICT")
  })

  it("does not emit stale events when an earlier intent is interrupted", async () => {
    const previousTriggerMode = process.env.ENRICH_TRIGGER_MODE
    process.env.ENRICH_TRIGGER_MODE = "rule"

    try {
      const isolatedApp = await createApp()
      const client = request(isolatedApp)
      const token = await issueAuthToken(client)

      let releaseFirstGeneration: (() => void) | null = null
      generateTextMock.mockReset()
      generateTextMock
        .mockImplementationOnce(
          () =>
            new Promise<string>((resolve) => {
              releaseFirstGeneration = () => resolve("FIRST_ANSWER")
            })
        )
        .mockResolvedValueOnce("SECOND_ANSWER")

      const open = await postWsEventWithAuth(
        client,
        createEnvelope("session.open", createSessionOpenPayload(), { requestId: "req-open-1" }),
        token
      )
      const sessionId = open.body?.payload?.sessionId

      await postWsEventWithAuth(
        client,
        createEnvelope("context.update", createContextUpdatePayload(128), {
          requestId: "req-ctx-1",
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
            snapshot: createValidSnapshot()
          },
          {
            requestId: "req-snapshot-1",
            sessionId
          }
        ),
        token
      )

      const firstIntentPromise = postWsEventWithAuth(
        client,
        createEnvelope("user.intent", createUserIntentPayload(128), {
          requestId: "req-intent-1",
          sessionId
        }),
        token
      )

      await vi.waitFor(() => {
        expect(generateTextMock).toHaveBeenCalledTimes(1)
      })

      const secondIntentPromise = postWsEventWithAuth(
        client,
        createEnvelope("user.intent", createUserIntentPayload(128), {
          requestId: "req-intent-2",
          sessionId
        }),
        token
      )

      await vi.waitFor(() => {
        expect(generateTextMock).toHaveBeenCalledTimes(2)
      })

      const firstGenerationRelease = releaseFirstGeneration as (() => void) | null
      if (typeof firstGenerationRelease === "function") {
        firstGenerationRelease()
      }

      const [firstIntent, secondIntent] = await Promise.all([firstIntentPromise, secondIntentPromise])

      expect(firstIntent.status).toBe(200)
      expect(firstIntent.body.type).toBe("event.batch")
      expect(firstIntent.body.events).toEqual([])

      expect(secondIntent.status).toBe(200)
      expect(Array.isArray(secondIntent.body.events)).toBe(true)
      expect(
        assertOrderedEventTypes(secondIntent.body.events as Array<{ type?: string }>, [
          "progress",
          "projection",
          "turn.done"
        ])
      ).toBe(true)
    } finally {
      if (previousTriggerMode) {
        process.env.ENRICH_TRIGGER_MODE = previousTriggerMode
      } else {
        delete process.env.ENRICH_TRIGGER_MODE
      }
    }
  })
})
