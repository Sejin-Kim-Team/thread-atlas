import request from "supertest"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { createServer } from "../../src/server"
import { requireEnv } from "../helpers/env"
import {
  createContextUpdatePayload,
  createEnvelope,
  createSessionOpenPayload,
  createUserIntentPayload,
  createValidSnapshot,
  postWsEventWithAuth
} from "./helpers/ws-contract"

const retrieveMemoryCandidatesMock = vi.fn()

vi.mock("../../src/rag/retrieval-service", () => ({
  retrieveMemoryCandidates: retrieveMemoryCandidatesMock
}))

vi.mock("../../src/services/gemini", () => ({
  createGeminiClient: () => ({
    // recall-runtime 테스트는 answer/recall 순서와 카드 조건이 목적이라 generation 호출은 고정 응답으로 격리한다.
    generateText: vi.fn(async () => "GENAI_RECALL_TEST_ANSWER")
  }),
  isModelConfigError: () => false
}))

const app = createServer()
let requestSeq = 0
let sharedToken = ""
let sharedOwnerUserId = ""

type EnvelopeEvent = {
  type?: string
  payload?: Record<string, unknown>
}

function nextRequestId(prefix: string) {
  requestSeq += 1
  return `${prefix}-${requestSeq}`
}

async function openSessionAndBindSnapshot(token: string) {
  const client = request(app)
  const open = await postWsEventWithAuth(
    client,
    createEnvelope("session.open", createSessionOpenPayload(), {
      requestId: nextRequestId("req-open-recall")
    }),
    token
  )
  expect(open.status).toBe(200)
  const sessionId = open.body?.payload?.sessionId as string

  const context = await postWsEventWithAuth(
    client,
    createEnvelope("context.update", createContextUpdatePayload(128), {
      requestId: nextRequestId("req-ctx-recall"),
      sessionId
    }),
    token
  )
  expect(context.status).toBe(200)

  const snapshot = await postWsEventWithAuth(
    client,
    createEnvelope(
      "snapshot.push",
      {
        tabId: 128,
        snapshot: createValidSnapshot()
      },
      {
        requestId: nextRequestId("req-snapshot-recall"),
        sessionId
      }
    ),
    token
  )
  expect(snapshot.status).toBe(200)

  return {
    client,
    sessionId
  }
}

function getProjectionBodyTypes(events: EnvelopeEvent[]): string[] {
  return events
    .filter((event) => event.type === "projection")
    .map((event) => {
      const body = event.payload?.body as Record<string, unknown> | undefined
      return typeof body?.type === "string" ? body.type : "unknown"
    })
}

function findRecallCard(events: EnvelopeEvent[]) {
  return events.find((event) => {
    if (event.type !== "projection") {
      return false
    }
    const body = event.payload?.body as Record<string, unknown> | undefined
    return body?.type === "recall-card"
  })
}

describe("ws recall runtime bridge (red)", () => {
  beforeAll(async () => {
    const client = request(app)
    const response = await client
      .post("/api/token")
      .set("X-Bootstrap-Key", requireEnv("AUTH_BOOTSTRAP_KEY"))
      .send({
        grantType: "dev-bootstrap",
        bootstrapSubject: "google-sub-owner-recall-runtime"
      })
    expect(response.status).toBe(200)
    sharedToken = response.body.token as string
    sharedOwnerUserId = response.body.user.id as string
    expect(typeof sharedToken).toBe("string")
    expect(sharedToken.length).toBeGreaterThan(10)
    expect(typeof sharedOwnerUserId).toBe("string")
    expect(sharedOwnerUserId.length).toBeGreaterThan(0)
  })

  beforeEach(() => {
    retrieveMemoryCandidatesMock.mockReset()
  })

  it("emits recall-card projection after current-page answer when recall candidate exists", async () => {
    retrieveMemoryCandidatesMock.mockResolvedValue([
      {
        recordId: "90d48649-ab08-4bf0-88fd-95f4038dc7d8",
        ownerUserId: sharedOwnerUserId,
        summary: "Previously seen similar branch about interruption handling.",
        kind: "branch-summary",
        canonicalUrl: "https://news.ycombinator.com/item?id=43199999",
        pageTitle: "Show HN: Live Voice Browser Assistant",
        nodeAnchor: {
          commentId: "comment-43199977",
          textQuote: "interruption and bidirectional updates"
        },
        openMode: "new-tab",
        similarityScore: 0.94
      }
    ])

    const setup = await openSessionAndBindSnapshot(sharedToken)
    const response = await postWsEventWithAuth(
      setup.client,
      createEnvelope("user.intent", createUserIntentPayload(128), {
        requestId: nextRequestId("req-intent-recall"),
        sessionId: setup.sessionId
      }),
      sharedToken
    )

    expect(response.status).toBe(200)
    const events = response.body.events as EnvelopeEvent[]
    const projectionTypes = getProjectionBodyTypes(events)
    expect(projectionTypes).toEqual(["answer", "recall-card"])
  })

  it("does not emit recall-card when no-hit or low-confidence", async () => {
    retrieveMemoryCandidatesMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          recordId: "45f72f42-e92f-4694-9591-2ad5ca767428",
          ownerUserId: sharedOwnerUserId,
          summary: "low confidence candidate should not be exposed",
          kind: "section-summary",
          canonicalUrl: "https://example.com/low-confidence",
          similarityScore: 0.31
        }
      ])

    const setup = await openSessionAndBindSnapshot(sharedToken)
    const noHitResponse = await postWsEventWithAuth(
      setup.client,
      createEnvelope("user.intent", createUserIntentPayload(128), {
        requestId: nextRequestId("req-intent-recall"),
        sessionId: setup.sessionId
      }),
      sharedToken
    )
    const lowConfidenceResponse = await postWsEventWithAuth(
      setup.client,
      createEnvelope("user.intent", createUserIntentPayload(128), {
        requestId: nextRequestId("req-intent-recall"),
        sessionId: setup.sessionId
      }),
      sharedToken
    )

    expect(noHitResponse.status).toBe(200)
    expect(lowConfidenceResponse.status).toBe(200)
    const noHitEvents = noHitResponse.body.events as EnvelopeEvent[]
    const lowConfidenceEvents = lowConfidenceResponse.body.events as EnvelopeEvent[]
    expect(findRecallCard(noHitEvents)).toBeUndefined()
    expect(findRecallCard(lowConfidenceEvents)).toBeUndefined()
    expect(retrieveMemoryCandidatesMock).toHaveBeenCalledTimes(2)
  })

  it("records turn.done.usedMemoryRecordIds when recall-card is emitted", async () => {
    retrieveMemoryCandidatesMock.mockResolvedValue([
      {
        recordId: "9b8f8f0a-fb8c-438e-9a67-f4bbf179cf20",
        ownerUserId: sharedOwnerUserId,
        summary: "Similar section summary",
        kind: "section-summary",
        canonicalUrl: "https://example.com/docs/ws",
        similarityScore: 0.88
      }
    ])

    const setup = await openSessionAndBindSnapshot(sharedToken)
    const response = await postWsEventWithAuth(
      setup.client,
      createEnvelope("user.intent", createUserIntentPayload(128), {
        requestId: nextRequestId("req-intent-recall"),
        sessionId: setup.sessionId
      }),
      sharedToken
    )

    expect(response.status).toBe(200)
    const events = response.body.events as EnvelopeEvent[]
    const done = events.find((event) => event.type === "turn.done")
    expect(done?.payload?.usedMemoryRecordIds).toEqual(["9b8f8f0a-fb8c-438e-9a67-f4bbf179cf20"])
  })

  it("enforces owner isolation by excluding foreign-owner memory from recall candidates", async () => {
    retrieveMemoryCandidatesMock.mockResolvedValue([
      {
        recordId: "56f168fc-10bb-4f85-ad58-1375f8d7c853",
        ownerUserId: "other-user",
        summary: "Foreign memory candidate",
        kind: "claim-evidence-summary",
        canonicalUrl: "https://foreign.example/thread",
        similarityScore: 0.97
      }
    ])

    const setup = await openSessionAndBindSnapshot(sharedToken)
    const response = await postWsEventWithAuth(
      setup.client,
      createEnvelope("user.intent", createUserIntentPayload(128), {
        requestId: nextRequestId("req-intent-recall"),
        sessionId: setup.sessionId
      }),
      sharedToken
    )

    expect(response.status).toBe(200)
    const events = response.body.events as EnvelopeEvent[]
    expect(findRecallCard(events)).toBeUndefined()
    expect(retrieveMemoryCandidatesMock).toHaveBeenCalledTimes(1)
  })

  it("keeps answer precedence even when recall-card is emitted", async () => {
    retrieveMemoryCandidatesMock.mockResolvedValue([
      {
        recordId: "7ebd757f-2bd8-42d7-94d0-1e4ca1f4eb2a",
        ownerUserId: sharedOwnerUserId,
        summary: "Recall candidate for precedence check",
        kind: "branch-summary",
        canonicalUrl: "https://news.ycombinator.com/item?id=43199990",
        similarityScore: 0.9
      }
    ])

    const setup = await openSessionAndBindSnapshot(sharedToken)
    const response = await postWsEventWithAuth(
      setup.client,
      createEnvelope("user.intent", createUserIntentPayload(128), {
        requestId: nextRequestId("req-intent-recall"),
        sessionId: setup.sessionId
      }),
      sharedToken
    )

    expect(response.status).toBe(200)
    const events = response.body.events as EnvelopeEvent[]
    const projections = events.filter((event) => event.type === "projection")
    const firstBody = projections[0]?.payload?.body as Record<string, unknown> | undefined
    const secondBody = projections[1]?.payload?.body as Record<string, unknown> | undefined
    expect(firstBody?.type).toBe("answer")
    expect(secondBody?.type).toBe("recall-card")
  })

  it("passes through navigation metadata in recall-card", async () => {
    retrieveMemoryCandidatesMock.mockResolvedValue([
      {
        recordId: "e1710350-9918-4747-ac61-bcf4ac00f845",
        ownerUserId: sharedOwnerUserId,
        summary: "Recall candidate with navigation metadata",
        kind: "claim-evidence-summary",
        canonicalUrl: "https://news.ycombinator.com/item?id=43199888",
        nodeAnchor: {
          commentId: "comment-43199888",
          textQuote: "websocket handles interruption better"
        },
        openMode: "sidepanel-preview",
        similarityScore: 0.93
      }
    ])

    const setup = await openSessionAndBindSnapshot(sharedToken)
    const response = await postWsEventWithAuth(
      setup.client,
      createEnvelope("user.intent", createUserIntentPayload(128), {
        requestId: nextRequestId("req-intent-recall"),
        sessionId: setup.sessionId
      }),
      sharedToken
    )

    expect(response.status).toBe(200)
    const events = response.body.events as EnvelopeEvent[]
    const recallCard = findRecallCard(events)
    const recallBody = recallCard?.payload?.body as Record<string, unknown> | undefined
    const navigation = recallBody?.navigation as Record<string, unknown> | undefined
    expect(navigation?.canonicalUrl).toBe("https://news.ycombinator.com/item?id=43199888")
    expect(navigation?.nodeAnchor).toEqual({
      commentId: "comment-43199888",
      textQuote: "websocket handles interruption better"
    })
    expect(navigation?.openMode).toBe("sidepanel-preview")
  })
})
