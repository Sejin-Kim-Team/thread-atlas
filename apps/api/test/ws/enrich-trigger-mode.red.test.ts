import express from "express"
import request from "supertest"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_JSON_BODY_LIMIT } from "../../src/http/json-body-limit"
import { createWsSessionEventsRouter } from "../../src/routes/ws-session-events"
import { RuntimeManager } from "../../src/session/runtime/manager"
import {
  createContextUpdatePayload,
  createEnvelope,
  createSessionOpenPayload,
  createValidSnapshot,
  postWsEventWithAuth
} from "./helpers/ws-contract"

const { geminiGenerateTextMock } = vi.hoisted(() => ({
  geminiGenerateTextMock: vi.fn(async (prompt: string) => {
    if (prompt.includes("ENRICH_TRIGGER_ASSIST")) {
      return JSON.stringify({
        decision: "enrich",
        requestKind: "visible-region",
        reason: "assist says enrichment is needed"
      })
    }
    return "GENAI_TRIGGER_MODE_TEST_ANSWER"
  })
}))

vi.mock("../../src/auth/principal", () => ({
  resolvePrincipalFromAuthorizationHeader: vi.fn(async (authorization: unknown) => {
    if (authorization === "Bearer test-token") {
      return {
        ok: true as const,
        userId: "user_trigger_mode"
      }
    }
    return {
      ok: false as const,
      message: "unauthorized"
    }
  })
}))

vi.mock("../../src/services/gemini", () => ({
  createGeminiClient: () => ({
    // trigger mode 테스트는 LLM assist 호출 경로와 분기만 고정한다.
    generateText: geminiGenerateTextMock
  }),
  isModelConfigError: () => false
}))

type TriggerMode = "rule" | "hybrid-simple" | "hybrid-complex"
const ALLOWED_REQUEST_KINDS = ["node-screenshot", "visible-region", "node-detail"] as const

type TestClient = ReturnType<typeof request>

interface SessionSetup {
  client: TestClient
  token: string
  sessionId: string
  capturedAt: string
}

interface IntentInput {
  text: string
  requestId: string
}

function createTestClient(mode?: TriggerMode): TestClient {
  const runtime = new RuntimeManager(mode ? { enrichTriggerMode: mode } : undefined)
  const app = express()
  app.use(express.json({ limit: DEFAULT_JSON_BODY_LIMIT }))
  app.use("/ws/session/events", createWsSessionEventsRouter(runtime))
  return request(app)
}

function findEvent(
  events: Array<Record<string, unknown>>,
  type: string
): Record<string, unknown> | undefined {
  return events.find((event) => event.type === type)
}

function hasEvent(events: Array<Record<string, unknown>>, type: string): boolean {
  return events.some((event) => event.type === type)
}

function countAssistCalls(): number {
  return geminiGenerateTextMock.mock.calls.filter(([prompt]) =>
    String(prompt).includes("ENRICH_TRIGGER_ASSIST")
  ).length
}

async function prepareSession(
  options?: {
    mode?: TriggerMode
    snapshot?: Record<string, unknown>
    capturedAt?: string
  }
): Promise<SessionSetup> {
  const client = createTestClient(options?.mode)
  const token = "test-token"
  const capturedAt = options?.capturedAt ?? "2026-03-08T11:00:00.000Z"
  const snapshot = options?.snapshot ?? createValidSnapshot(capturedAt)
  const clientSessionId = `sidepanel-trigger-${Math.random().toString(16).slice(2)}`

  const open = await postWsEventWithAuth(
    client,
    createEnvelope(
      "session.open",
      {
        ...createSessionOpenPayload(),
        clientSessionId
      },
      { requestId: "req-trigger-open" }
    ),
    token
  )
  const sessionId = open.body?.payload?.sessionId as string

  await postWsEventWithAuth(
    client,
    createEnvelope("context.update", createContextUpdatePayload(128), {
      requestId: "req-trigger-context",
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
        snapshot
      },
      {
        requestId: "req-trigger-snapshot",
        sessionId
      }
    ),
    token
  )

  return { client, token, sessionId, capturedAt }
}

async function postIntent(setup: SessionSetup, input: IntentInput): Promise<request.Response> {
  return postWsEventWithAuth(
    setup.client,
    createEnvelope(
      "user.intent",
      {
        text: input.text,
        primaryTabId: 128,
        boundSnapshotCapturedAt: setup.capturedAt
      },
      {
        requestId: input.requestId,
        sessionId: setup.sessionId
      }
    ),
    setup.token
  )
}

describe("ws enrich trigger mode redesign contract (red)", () => {
  beforeEach(() => {
    process.env.GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT ?? "threadatlas"
    process.env.GOOGLE_CLOUD_LOCATION = process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1"
    geminiGenerateTextMock.mockClear()
    geminiGenerateTextMock.mockImplementation(async (prompt: string) => {
      if (prompt.includes("ENRICH_TRIGGER_ASSIST")) {
        return JSON.stringify({
          decision: "enrich",
          requestKind: "visible-region",
          reason: "assist says enrichment is needed"
        })
      }
      return "GENAI_TRIGGER_MODE_TEST_ANSWER"
    })
  })

  it.each([
    {
      name: "ko visual+detail",
      text: "이 차트 영역을 더 자세히 확인해서 설명해줘."
    },
    {
      name: "en visual+detail",
      text: "Please inspect this chart region in detail and explain."
    }
  ])("requests enrich in rule mode when visual+detail rule hits ($name)", async ({ text }) => {
    const setup = await prepareSession({ mode: "rule" })
    const intent = await postIntent(setup, {
      text,
      requestId: `req-trigger-rule-hit-${Math.random().toString(16).slice(2)}`
    })

    expect(intent.status).toBe(200)
    const events = intent.body.events as Array<Record<string, unknown>>

    expect(hasEvent(events, "context.enrich.request")).toBe(true)
    expect(hasEvent(events, "turn.done")).toBe(false)
    expect(countAssistCalls()).toBe(0)
    const enrichRequest = findEvent(events, "context.enrich.request")
    const requestPayload = enrichRequest?.payload as Record<string, unknown> | undefined
    expect(requestPayload?.timeoutMs).toBe(5000)
  })

  it("does not request enrich in rule mode when rule does not match", async () => {
    const setup = await prepareSession({ mode: "rule" })
    const intent = await postIntent(setup, {
      text: "현재 포커스 댓글만 한 줄로 요약해줘.",
      requestId: "req-trigger-rule-miss"
    })

    expect(intent.status).toBe(200)
    const events = intent.body.events as Array<Record<string, unknown>>

    expect(hasEvent(events, "context.enrich.request")).toBe(false)
    expect(hasEvent(events, "projection")).toBe(true)
    expect(hasEvent(events, "turn.done")).toBe(true)
    expect(countAssistCalls()).toBe(0)
  })

  it("can request enrich via LLM assist in hybrid-simple mode even when rule misses", async () => {
    const setup = await prepareSession({ mode: "hybrid-simple" })
    const intent = await postIntent(setup, {
      text: "지금 화면에서 추가 확인이 필요한지 판단해줘.",
      requestId: "req-trigger-hs-llm-assist"
    })

    expect(intent.status).toBe(200)
    const events = intent.body.events as Array<Record<string, unknown>>

    expect(hasEvent(events, "context.enrich.request")).toBe(true)
    expect(hasEvent(events, "turn.done")).toBe(false)
    expect(countAssistCalls()).toBeGreaterThan(0)
  })

  it("does not force enrich when LLM assist explicitly returns no-enrich", async () => {
    geminiGenerateTextMock.mockImplementation(async (prompt: string) => {
      if (prompt.includes("ENRICH_TRIGGER_ASSIST")) {
        return JSON.stringify({
          decision: "no-enrich",
          requestKind: "visible-region",
          reason: "current evidence is sufficient"
        })
      }
      return "GENAI_TRIGGER_MODE_TEST_ANSWER"
    })

    const setup = await prepareSession({ mode: "hybrid-simple" })
    const intent = await postIntent(setup, {
      text: "지금 화면에서 추가 확인이 필요한지 판단해줘.",
      requestId: "req-trigger-hs-assist-no-enrich"
    })

    expect(intent.status).toBe(200)
    const events = intent.body.events as Array<Record<string, unknown>>

    expect(hasEvent(events, "context.enrich.request")).toBe(false)
    expect(hasEvent(events, "projection")).toBe(true)
    expect(hasEvent(events, "turn.done")).toBe(true)
    expect(countAssistCalls()).toBeGreaterThan(0)
  })

  it("falls back conservatively without forcing enrich when LLM assist response is non-json", async () => {
    geminiGenerateTextMock.mockImplementation(async (prompt: string) => {
      if (prompt.includes("ENRICH_TRIGGER_ASSIST")) {
        return "not a json response"
      }
      return "GENAI_TRIGGER_MODE_TEST_ANSWER"
    })

    const setup = await prepareSession({ mode: "hybrid-simple" })
    const intent = await postIntent(setup, {
      text: "지금 화면에서 추가 확인이 필요한지 판단해줘.",
      requestId: "req-trigger-hs-assist-non-json"
    })

    expect(intent.status).toBe(200)
    const events = intent.body.events as Array<Record<string, unknown>>

    expect(hasEvent(events, "context.enrich.request")).toBe(false)
    expect(hasEvent(events, "projection")).toBe(true)
    expect(hasEvent(events, "turn.done")).toBe(true)
    expect(countAssistCalls()).toBeGreaterThan(0)
  })

  it("uses LLM assist in hybrid-complex mode when question is ambiguous but snapshot is visually suspicious", async () => {
    const capturedAt = "2026-03-08T11:20:00.000Z"
    const baseSnapshot = createValidSnapshot(capturedAt)
    const suspiciousSnapshot = {
      ...baseSnapshot,
      focus: {
        ...baseSnapshot.focus,
        node: {
          ...baseSnapshot.focus.node,
          text: "버튼 라벨이 깨지고 UI 경계가 흐려 보여 신뢰하기 어렵다."
        }
      },
      visualSignals: {
        uiSuspicious: true,
        anomalyScore: 0.93
      }
    }

    const setup = await prepareSession({
      mode: "hybrid-complex",
      snapshot: suspiciousSnapshot,
      capturedAt
    })
    const intent = await postIntent(setup, {
      text: "여기서 뭘 더 봐야 할지 애매한데, 도와줘.",
      requestId: "req-trigger-hc-ambiguous-suspicious"
    })

    expect(intent.status).toBe(200)
    const events = intent.body.events as Array<Record<string, unknown>>

    expect(hasEvent(events, "context.enrich.request")).toBe(true)
    expect(hasEvent(events, "turn.done")).toBe(false)
    expect(countAssistCalls()).toBeGreaterThan(0)
  })

  it("does not request enrich in hybrid-complex mode when hard negative rule applies and snapshot is not suspicious", async () => {
    const setup = await prepareSession({ mode: "hybrid-complex" })
    const intent = await postIntent(setup, {
      text: "차트 영역은 자세히 보지 말고 현재 텍스트만으로 답해줘.",
      requestId: "req-trigger-hc-hard-negative"
    })

    expect(intent.status).toBe(200)
    const events = intent.body.events as Array<Record<string, unknown>>
    const enrichRequest = findEvent(events, "context.enrich.request")

    expect(enrichRequest).toBeUndefined()
    expect(hasEvent(events, "projection")).toBe(true)
    expect(hasEvent(events, "turn.done")).toBe(true)
    expect(countAssistCalls()).toBe(0)
  })

  it("defaults to hybrid-complex when trigger mode is omitted", () => {
    const original = process.env.ENRICH_TRIGGER_MODE
    delete process.env.ENRICH_TRIGGER_MODE

    try {
      const runtime = new RuntimeManager()
      expect(runtime).toBeInstanceOf(RuntimeManager)
    } finally {
      if (original === undefined) {
        delete process.env.ENRICH_TRIGGER_MODE
      } else {
        process.env.ENRICH_TRIGGER_MODE = original
      }
    }
  })

  it("advertises only 3 requestKind values in assist prompt schema", async () => {
    const setup = await prepareSession({ mode: "hybrid-simple" })
    await postIntent(setup, {
      text: "지금 화면에서 추가 확인이 필요한지 판단해줘.",
      requestId: "req-trigger-assist-schema"
    })

    const assistPrompt = geminiGenerateTextMock.mock.calls
      .map(([prompt]) => String(prompt))
      .find((prompt) => prompt.includes("ENRICH_TRIGGER_ASSIST"))

    expect(assistPrompt).toBeDefined()
    expect(assistPrompt).toContain(
      '{"decision":"enrich|no-enrich","requestKind":"node-screenshot|visible-region|node-detail","reason":"string"}'
    )
    expect(assistPrompt).not.toContain("page-entity")
  })

  it("treats assist response requestKind=page-entity as invalid and avoids enrich request", async () => {
    geminiGenerateTextMock.mockImplementation(async (prompt: string) => {
      if (prompt.includes("ENRICH_TRIGGER_ASSIST")) {
        return JSON.stringify({
          decision: "enrich",
          requestKind: "page-entity",
          reason: "entity lookup"
        })
      }
      return "GENAI_TRIGGER_MODE_TEST_ANSWER"
    })

    const setup = await prepareSession({ mode: "hybrid-simple" })
    const intent = await postIntent(setup, {
      text: "지금 화면에서 추가 확인이 필요한지 판단해줘.",
      requestId: "req-trigger-assist-page-entity-kind"
    })

    expect(intent.status).toBe(200)
    const events = intent.body.events as Array<Record<string, unknown>>
    const enrichRequest = findEvent(events, "context.enrich.request")
    const requestPayload = enrichRequest?.payload as Record<string, unknown> | undefined
    const requestKind = requestPayload?.requestKind

    if (typeof requestKind === "string") {
      expect(ALLOWED_REQUEST_KINDS).toContain(requestKind as (typeof ALLOWED_REQUEST_KINDS)[number])
    }
    expect(requestKind).not.toBe("page-entity")
    expect(hasEvent(events, "context.enrich.request")).toBe(false)
    expect(hasEvent(events, "projection")).toBe(true)
    expect(hasEvent(events, "turn.done")).toBe(true)
  })

  it("fails fast when trigger mode is misconfigured", () => {
    expect(() => new RuntimeManager({ enrichTriggerMode: "invalid-mode" })).toThrow(
      /ENRICH_TRIGGER_MODE/
    )
  })
})
