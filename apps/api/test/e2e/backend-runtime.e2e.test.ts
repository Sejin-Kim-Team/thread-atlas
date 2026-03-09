import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import {
  bootE2EHarness,
  closeE2EHarness,
  connectE2EWebSocket,
  createWebSocketMessageCollector,
  createCurrentPageIntent,
  issueDevBootstrapSession,
  openCurrentPageSession,
  resetE2EDatabase,
  type E2EHarness,
} from "./helpers/e2e-harness"

describe.sequential("BE 자동 E2E", () => {
  let harness: E2EHarness | null = null

  beforeAll(async () => {
    harness = await bootE2EHarness()
  }, 60_000)

  beforeEach(async () => {
    await resetE2EDatabase()
  }, 60_000)

  afterAll(async () => {
    await closeE2EHarness(harness)
  }, 60_000)

  it("health/ready와 dev-bootstrap 토큰 발급이 실제 서버에서 동작한다", async () => {
    if (!harness) {
      throw new Error("e2e harness is not ready")
    }

    const health = await harness.http.get("/health")
    const ready = await harness.http.get("/ready")
    const issued = await issueDevBootstrapSession(harness, "e2e-health-user")

    expect(health.status).toBe(200)
    expect(health.body).toEqual({ ok: true })
    expect(ready.status).toBe(200)
    expect(ready.body).toEqual({
      ok: true,
      checks: {
        db: "up"
      }
    })
    expect(typeof issued.token).toBe("string")
    expect(issued.token.length).toBeGreaterThan(10)
    expect(typeof issued.userId).toBe("string")
    expect(issued.userId.length).toBeGreaterThan(0)
  })

  it("analyze와 ingest-memory가 실제 DB에 기록되고 같은 사용자 기준으로 처리된다", async () => {
    if (!harness) {
      throw new Error("e2e harness is not ready")
    }

    const session = await issueDevBootstrapSession(harness, "e2e-analyze-user")

    const analyze = await harness.http
      .post("/api/analyze")
      .set("Authorization", `Bearer ${session.token}`)
      .send({
        tabId: 128,
        mode: "seed",
        snapshot: {
          page: {
            id: "doc-1",
            url: "https://example.com/article",
            title: "Example article",
            kind: "article",
            metadata: {
              site: "example"
            }
          },
          focus: {
            nodeId: "node-1",
            node: {
              id: "node-1",
              kind: "content",
              text: "WebSocket is better for interruption and bidirectional updates."
            },
            region: "section"
          },
          context: [],
          meta: {
            capturedAt: "2026-03-08T10:00:00.000Z",
            skeletonVersion: 1,
            extractorId: "e2e"
          }
        }
      })

    expect(analyze.status).toBe(200)
    expect(typeof analyze.body.analysisId).toBe("string")
    expect(typeof analyze.body.normalizedMode).toBe("string")
    expect(Array.isArray(analyze.body.summaryCandidates)).toBe(true)

    const ingest = await harness.http
      .post("/api/ingest/memory")
      .set("Authorization", `Bearer ${session.token}`)
      .send({
        source: "analyze",
        records: [
          {
            id: randomUUID(),
            ownerUserId: session.userId,
            kind: "branch-summary",
            summary:
              "WebSocket is better for interruption and bidirectional updates in this discussion.",
            keywords: ["websocket", "interruption", "bidirectional", "updates"],
            entities: ["WebSocket"],
            provenance: {
              sourceUrl: "https://example.com/article",
              pageKind: "article",
              snapshotCapturedAt: "2026-03-08T10:00:00.000Z",
              extractorId: "e2e",
              skeletonVersion: 1
            },
            source: {
              pageId: "doc-1",
              rootNodeIds: ["node-1"],
              unitId: "branch-node-1"
            },
            navigation: {
              canonicalUrl: "https://example.com/article",
              pageTitle: "Example article",
              nodeAnchor: {
                textQuote: "WebSocket is better for interruption and bidirectional updates."
              },
              openMode: "new-tab"
            },
            evidence: {
              textSpans: [
                "WebSocket is better for interruption and bidirectional updates."
              ],
              referencedNodeIds: ["node-1"]
            },
            createdAt: "2026-03-08T10:00:01.000Z"
          }
        ]
      })

    expect(ingest.status).toBe(200)
    expect(Array.isArray(ingest.body.acceptedIds)).toBe(true)
    expect(ingest.body.acceptedIds).toHaveLength(1)
  }, 90_000)

  it("ws current-page answer와 recall-card를 실제 서버 경로에서 순서대로 반환한다", async () => {
    if (!harness) {
      throw new Error("e2e harness is not ready")
    }

    const session = await issueDevBootstrapSession(harness, "e2e-recall-user")
    const recallRecordId = randomUUID()

    const ingest = await harness.http
      .post("/api/ingest/memory")
      .set("Authorization", `Bearer ${session.token}`)
      .send({
        source: "analyze",
        records: [
          {
            id: recallRecordId,
            ownerUserId: session.userId,
            kind: "claim-evidence-summary",
            summary:
              "WebSocket interruption bidirectional updates similar past case.",
            keywords: ["websocket", "interruption", "bidirectional", "updates", "similar", "past", "case"],
            entities: ["WebSocket"],
            provenance: {
              sourceUrl: "https://news.ycombinator.com/item?id=43199999",
              pageKind: "thread",
              snapshotCapturedAt: "2026-03-08T09:30:00.000Z",
              extractorId: "e2e",
              skeletonVersion: 1
            },
            source: {
              pageId: "thread-1",
              rootNodeIds: ["comment-1"],
              unitId: "claim-1"
            },
            navigation: {
              canonicalUrl: "https://news.ycombinator.com/item?id=43199999",
              pageTitle: "Previous HN thread",
              nodeAnchor: {
                commentId: "comment-1",
                textQuote: "WebSocket is better for interruption and bidirectional updates."
              },
              openMode: "sidepanel-preview"
            },
            evidence: {
              textSpans: [
                "WebSocket interruption bidirectional updates similar past case.",
                "WebSocket is better for interruption and bidirectional updates."
              ],
              referencedNodeIds: ["comment-1"]
            },
            createdAt: "2026-03-08T09:31:00.000Z"
          }
        ]
      })

    expect(ingest.status).toBe(200)

    const ws = await connectE2EWebSocket(harness.port, session.token)
    try {
      const collector = createWebSocketMessageCollector(ws)
      await openCurrentPageSession(ws)
      ws.send(
        JSON.stringify(
          createCurrentPageIntent(
            "WebSocket interruption bidirectional updates similar past case"
          )
        )
      )

      const messages = await collector.waitForRequiredTypes(["projection", "turn.done"], 45_000)
      const projections = messages.filter((message) => message.type === "projection")
      const projectionBodyTypes = projections.map((projection) => {
        const payload = projection.payload as Record<string, unknown> | undefined
        const body = payload?.body as Record<string, unknown> | undefined
        return body?.type
      })
      const turnDone = messages.find((message) => message.type === "turn.done")
      const turnDonePayload = turnDone?.payload as Record<string, unknown> | undefined

      expect(projectionBodyTypes).toContain("answer")
      expect(projectionBodyTypes).toContain("recall-card")
      expect(turnDonePayload?.usedMemoryRecordIds).toEqual([recallRecordId])
    } finally {
      ws.close()
    }
  }, 120_000)

  it("ws enrich sub-loop가 실제 서버 경로에서 request/result/fallback 없이 완료된다", async () => {
    if (!harness) {
      throw new Error("e2e harness is not ready")
    }

    const session = await issueDevBootstrapSession(harness, "e2e-enrich-user")
    const ws = await connectE2EWebSocket(harness.port, session.token)

    try {
      const collector = createWebSocketMessageCollector(ws)
      await openCurrentPageSession(ws)
      ws.send(
        JSON.stringify(createCurrentPageIntent("이 chart 영역을 자세히 설명해줘"))
      )

      const waitingMessages = await collector.waitForRequiredTypes(["context.enrich.request"], 30_000)
      const enrichRequest = waitingMessages.find((message) => message.type === "context.enrich.request")
      const enrichPayload = enrichRequest?.payload as Record<string, unknown> | undefined
      const turnId = enrichRequest?.turnId as string | undefined

      expect(typeof turnId).toBe("string")
      expect(enrichPayload?.requestKind).toBe("visible-region")

      ws.send(
        JSON.stringify({
          type: "context.enrich.result",
          requestId: "req-e2e-enrich-result",
          sessionId: enrichRequest?.sessionId,
          turnId,
          timestamp: new Date().toISOString(),
          payload: {
            requestKind: enrichPayload?.requestKind,
            targetRef: enrichPayload?.targetRef,
            status: "ok",
            capturedAt: new Date().toISOString(),
            detail: {
              text: "The chart emphasizes interruption handling and bidirectional updates.",
              attributes: {
                role: "img",
                title: "chart area"
              }
            }
          }
        })
      )

      const completedMessages = await collector.waitForRequiredTypes(["projection", "turn.done"], 45_000)
      const projection = completedMessages.find((message) => message.type === "projection")
      const projectionPayload = projection?.payload as Record<string, unknown> | undefined
      const projectionBody = projectionPayload?.body as Record<string, unknown> | undefined

      expect(projectionBody?.type).toBe("answer")
    } finally {
      ws.close()
    }
  }, 120_000)
})
