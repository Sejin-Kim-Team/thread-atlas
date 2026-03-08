import express from "express"
import request from "supertest"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createWsSessionEventsRouter } from "../../src/routes/ws-session-events"
import { RuntimeManager } from "../../src/session/runtime/manager"
import {
  assertOrderedEventTypes,
  createContextUpdatePayload,
  createEnvelope,
  createSessionOpenPayload,
  createUserIntentPayload,
  createValidSnapshot,
  postWsEventWithAuth
} from "./helpers/ws-contract"

vi.mock("../../src/auth/principal", () => ({
  resolvePrincipalFromAuthorizationHeader: vi.fn(async (authorization: unknown) => {
    if (authorization === "Bearer test-token") {
      return {
        ok: true as const,
        userId: "user_enrich_subloop"
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
    // enrich 하위 루프 계약 테스트에서는 generation 품질이 아니라 이벤트 흐름을 고정한다.
    generateText: vi.fn(async () => "GENAI_ENRICH_TEST_ANSWER")
  }),
  isModelConfigError: () => false
}))

interface SessionSetup {
  client: request.SuperTest<request.Test>
  token: string
  sessionId: string
}

function createTestClient(): request.SuperTest<request.Test> {
  const runtime = new RuntimeManager()
  const app = express()
  app.use(express.json({ limit: "2mb" }))
  app.use("/ws/session/events", createWsSessionEventsRouter(runtime))
  return request(app)
}

function findEvent(
  events: Array<Record<string, unknown>>,
  type: string
): Record<string, unknown> | undefined {
  return events.find((event) => event.type === type)
}

function getEnrichRequestPayload(
  events: Array<Record<string, unknown>>
): {
  turnId: string
  requestKind: string
  targetRef: Record<string, unknown>
} {
  const enrichRequest = findEvent(events, "context.enrich.request")
  const turnId = enrichRequest?.turnId
  const payload = enrichRequest?.payload as Record<string, unknown> | undefined
  const requestKind = typeof payload?.requestKind === "string" ? payload.requestKind : ""
  const targetRef =
    payload && typeof payload.targetRef === "object" && payload.targetRef !== null
      ? (payload.targetRef as Record<string, unknown>)
      : null

  expect(typeof turnId).toBe("string")
  expect(requestKind.length).toBeGreaterThan(0)
  expect(targetRef).toBeTruthy()

  return {
    turnId: turnId as string,
    requestKind,
    targetRef: targetRef as Record<string, unknown>
  }
}

async function prepareSession(): Promise<SessionSetup> {
  const client = createTestClient()
  const token = "test-token"

  const open = await postWsEventWithAuth(
    client,
    createEnvelope("session.open", createSessionOpenPayload(), { requestId: "req-enrich-open" }),
    token
  )
  const sessionId = open.body?.payload?.sessionId as string

  await postWsEventWithAuth(
    client,
    createEnvelope("context.update", createContextUpdatePayload(128), {
      requestId: "req-enrich-context",
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
        snapshot: createValidSnapshot("2026-03-08T10:00:00.000Z")
      },
      {
        requestId: "req-enrich-snapshot",
        sessionId
      }
    ),
    token
  )

  return { client, token, sessionId }
}

async function postIntentRequiringEnrich(
  setup: SessionSetup,
  requestId: string
): Promise<request.Response> {
  return postWsEventWithAuth(
    setup.client,
    createEnvelope(
      "user.intent",
      {
        ...createUserIntentPayload(128, "2026-03-08T10:00:00.000Z"),
        text: "이 차트 영역을 더 자세히 확인해서 설명해줘."
      },
      {
        requestId,
        sessionId: setup.sessionId
      }
    ),
    setup.token
  )
}

async function postIntentRequiringEntityDetailEnrich(
  setup: SessionSetup,
  requestId: string
): Promise<request.Response> {
  return postWsEventWithAuth(
    setup.client,
    createEnvelope(
      "user.intent",
      {
        ...createUserIntentPayload(128, "2026-03-08T10:00:00.000Z"),
        text: "이 댓글 엔티티를 자세히 확인해서 분석해줘."
      },
      {
        requestId,
        sessionId: setup.sessionId
      }
    ),
    setup.token
  )
}

describe("ws enrich sub-loop contract (red)", () => {
  beforeEach(() => {
    process.env.GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT ?? "threadatlas"
    process.env.GOOGLE_CLOUD_LOCATION = process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1"
  })

  it("emits context.enrich.request when evidence gap is detected", async () => {
    const setup = await prepareSession()
    const intent = await postIntentRequiringEnrich(setup, "req-enrich-intent-1")

    expect(intent.status).toBe(200)
    const events = intent.body.events as Array<Record<string, unknown>>
    const enrichRequest = findEvent(events, "context.enrich.request")

    expect(enrichRequest).toBeDefined()
  })

  it("resumes turn after context.enrich.result(status=ok) and emits projection/turn.done", async () => {
    const setup = await prepareSession()
    const intent = await postIntentRequiringEnrich(setup, "req-enrich-intent-2")
    const events = intent.body.events as Array<Record<string, unknown>>
    const { turnId, requestKind, targetRef } = getEnrichRequestPayload(events)

    const enrichResult = await postWsEventWithAuth(
      setup.client,
      createEnvelope(
        "context.enrich.result",
        {
          requestKind,
          targetRef,
          status: "ok",
          capturedAt: "2026-03-08T10:00:01.000Z",
          detail: {
            text: "chart area text"
          }
        },
        {
          requestId: "req-enrich-result-ok",
          sessionId: setup.sessionId,
          turnId
        }
      ),
      setup.token
    )

    expect(enrichResult.status).toBe(200)
    expect(
      assertOrderedEventTypes(enrichResult.body.events as Array<{ type?: string }>, [
        "progress",
        "projection",
        "turn.done"
      ])
    ).toBe(true)
  })

  it("keeps turn in waiting-enrich state before timeout fallback (no immediate turn.done)", async () => {
    const setup = await prepareSession()
    const intent = await postIntentRequiringEnrich(setup, "req-enrich-intent-3")

    expect(intent.status).toBe(200)
    const events = intent.body.events as Array<Record<string, unknown>>
    const hasTurnDone = events.some((event) => event.type === "turn.done")
    const hasEnrichRequested = events.some((event) => event.type === "context.enrich.request")

    expect(hasEnrichRequested).toBe(true)
    expect(hasTurnDone).toBe(false)
  })

  it("falls back gracefully when context.enrich.result(status=failed) arrives", async () => {
    const setup = await prepareSession()
    const intent = await postIntentRequiringEnrich(setup, "req-enrich-intent-4")
    const events = intent.body.events as Array<Record<string, unknown>>
    const { turnId, requestKind, targetRef } = getEnrichRequestPayload(events)

    const failedResult = await postWsEventWithAuth(
      setup.client,
      createEnvelope(
        "context.enrich.result",
        {
          requestKind,
          targetRef,
          status: "failed",
          failureReason: "capture failed",
          capturedAt: "2026-03-08T10:00:02.000Z"
        },
        {
          requestId: "req-enrich-result-failed",
          sessionId: setup.sessionId,
          turnId
        }
      ),
      setup.token
    )

    expect(failedResult.status).toBe(200)
    expect(
      assertOrderedEventTypes(failedResult.body.events as Array<{ type?: string }>, [
        "progress",
        "projection",
        "turn.done"
      ])
    ).toBe(true)
  })

  it("falls back gracefully when context.enrich.result(status=unsupported) arrives", async () => {
    const setup = await prepareSession()
    const intent = await postIntentRequiringEnrich(setup, "req-enrich-intent-5")
    const events = intent.body.events as Array<Record<string, unknown>>
    const { turnId, requestKind, targetRef } = getEnrichRequestPayload(events)

    const unsupportedResult = await postWsEventWithAuth(
      setup.client,
      createEnvelope(
        "context.enrich.result",
        {
          requestKind,
          targetRef,
          status: "unsupported",
          failureReason: "not supported",
          capturedAt: "2026-03-08T10:00:03.000Z"
        },
        {
          requestId: "req-enrich-result-unsupported",
          sessionId: setup.sessionId,
          turnId
        }
      ),
      setup.token
    )

    expect(unsupportedResult.status).toBe(200)
    expect(
      assertOrderedEventTypes(unsupportedResult.body.events as Array<{ type?: string }>, [
        "progress",
        "projection",
        "turn.done"
      ])
    ).toBe(true)
  })

  it("allows at most one enrich application per turn", async () => {
    const setup = await prepareSession()
    const intent = await postIntentRequiringEnrich(setup, "req-enrich-intent-6")
    const events = intent.body.events as Array<Record<string, unknown>>
    const enrichRequest = findEvent(events, "context.enrich.request")
    const turnId = enrichRequest?.turnId as string | undefined

    expect(turnId).toBeDefined()

    await postWsEventWithAuth(
      setup.client,
      createEnvelope(
        "context.enrich.result",
        {
          requestKind: "visible-region",
          targetRef: {
            kind: "region",
            pageUrl: "https://news.ycombinator.com/item?id=43210000",
            region: "focus-node-region"
          },
          status: "ok",
          capturedAt: "2026-03-08T10:00:04.000Z"
        },
        {
          requestId: "req-enrich-result-once",
          sessionId: setup.sessionId,
          turnId
        }
      ),
      setup.token
    )

    const secondResult = await postWsEventWithAuth(
      setup.client,
      createEnvelope(
        "context.enrich.result",
        {
          requestKind: "visible-region",
          targetRef: {
            kind: "region",
            pageUrl: "https://news.ycombinator.com/item?id=43210000",
            region: "focus-node-region"
          },
          status: "ok",
          capturedAt: "2026-03-08T10:00:05.000Z"
        },
        {
          requestId: "req-enrich-result-twice",
          sessionId: setup.sessionId,
          turnId
        }
      ),
      setup.token
    )

    expect(secondResult.status).toBe(400)
    expect(secondResult.body?.payload?.code).toBe("INVALID_EVENT")
  })

  it("does not replace primary snapshot and keeps current-page-only scope", async () => {
    const setup = await prepareSession()
    const firstIntent = await postIntentRequiringEnrich(setup, "req-enrich-intent-7")
    const events = firstIntent.body.events as Array<Record<string, unknown>>
    const { turnId, requestKind, targetRef } = getEnrichRequestPayload(events)

    expect(targetRef.kind).not.toBe("cross-tab")

    const enrichResult = await postWsEventWithAuth(
      setup.client,
      createEnvelope(
        "context.enrich.result",
        {
          requestKind,
          targetRef,
          status: "ok",
          capturedAt: "2026-03-08T10:00:06.000Z",
          detail: {
            text: "enriched detail"
          }
        },
        {
          requestId: "req-enrich-result-local-only",
          sessionId: setup.sessionId,
          turnId
        }
      ),
      setup.token
    )

    expect(enrichResult.status).toBe(200)

    const secondIntent = await postWsEventWithAuth(
      setup.client,
      createEnvelope(
        "user.intent",
        {
          ...createUserIntentPayload(128, "2026-03-08T10:00:00.000Z"),
          text: "이어서 요약해줘."
        },
        {
          requestId: "req-enrich-intent-7-followup",
          sessionId: setup.sessionId
        }
      ),
      setup.token
    )

    expect(secondIntent.status).toBe(200)
    expect(secondIntent.body?.payload?.code).not.toBe("INVALID_SNAPSHOT")
  })

  it("rejects context.enrich.result when requestKind does not match active request", async () => {
    const setup = await prepareSession()
    const intent = await postIntentRequiringEnrich(setup, "req-enrich-intent-8")
    const events = intent.body.events as Array<Record<string, unknown>>
    const enrichRequest = findEvent(events, "context.enrich.request")
    const turnId = enrichRequest?.turnId as string | undefined

    expect(turnId).toBeDefined()
    const requestPayload = enrichRequest?.payload as Record<string, unknown> | undefined
    expect(requestPayload?.requestKind).toBe("visible-region")

    const mismatchedResult = await postWsEventWithAuth(
      setup.client,
      createEnvelope(
        "context.enrich.result",
        {
          requestKind: "node-detail",
          targetRef: {
            kind: "semantic-node",
            nodeId: "comment-43210091"
          },
          status: "ok",
          capturedAt: "2026-03-08T10:00:07.000Z",
          detail: {
            text: "mismatched requestKind detail"
          }
        },
        {
          requestId: "req-enrich-result-kind-mismatch",
          sessionId: setup.sessionId,
          turnId
        }
      ),
      setup.token
    )

    expect(mismatchedResult.status).toBe(400)
    expect(mismatchedResult.body?.payload?.code).toBe("INVALID_EVENT")
  })

  it("rejects context.enrich.result when targetRef escapes requested entity scope", async () => {
    const setup = await prepareSession()
    const intent = await postIntentRequiringEntityDetailEnrich(setup, "req-enrich-intent-9")
    const events = intent.body.events as Array<Record<string, unknown>>
    const enrichRequest = findEvent(events, "context.enrich.request")
    const turnId = enrichRequest?.turnId as string | undefined

    expect(turnId).toBeDefined()
    const requestPayload = enrichRequest?.payload as Record<string, unknown> | undefined
    const requestTargetRef = requestPayload?.targetRef as Record<string, unknown> | undefined
    const requestedNodeId = requestTargetRef?.nodeId as string | undefined
    const requestedPageUrl = requestTargetRef?.pageUrl as string | undefined

    expect(requestPayload?.requestKind).toBe("node-detail")
    expect(requestTargetRef?.kind).toBe("semantic-node")
    expect(requestedNodeId).toBeDefined()

    const outOfScopeResult = await postWsEventWithAuth(
      setup.client,
      createEnvelope(
        "context.enrich.result",
        {
          requestKind: "node-detail",
          targetRef: {
            kind: "semantic-node",
            pageUrl: requestedPageUrl ?? "https://news.ycombinator.com/item?id=43210000",
            nodeId: `${requestedNodeId ?? "comment-43210091"}-offscope`
          },
          status: "ok",
          capturedAt: "2026-03-08T10:00:08.000Z",
          detail: {
            text: "out-of-scope entity detail"
          }
        },
        {
          requestId: "req-enrich-result-entity-mismatch",
          sessionId: setup.sessionId,
          turnId
        }
      ),
      setup.token
    )

    expect(outOfScopeResult.status).toBe(400)
    expect(outOfScopeResult.body?.payload?.code).toBe("INVALID_EVENT")
  })

})
