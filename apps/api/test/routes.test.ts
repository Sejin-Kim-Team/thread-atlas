import request from "supertest"
import { describe, expect, it } from "vitest"
import { createServer } from "../src/server"

const app = createServer()

const sampleSnapshot = {
  intent: {
    type: "UserSpeech",
    transcript: "요약해줘",
    intentType: "briefing_request"
  },
  page: {
    url: "https://news.ycombinator.com/item?id=39900001",
    title: "Sample thread",
    content: {
      threadDoc: null,
      structure: {
        headings: [],
        landmarks: [],
        commentCount: 1,
        nestingDepth: 0
      },
      visibleComments: []
    }
  },
  user: {
    speech: "요약해줘",
    selection: null,
    focus: null
  },
  viewport: null,
  sourceArticle: null,
  semantics: {
    topic: "AI agents",
    claims: [],
    keyComments: [],
    generatedAt: Date.now()
  },
  conversationContext: null
}

describe("api routes", () => {
  it("POST /api/token returns stub token", async () => {
    const response = await request(app).post("/api/token").send({ userId: "user_sungwoo" })

    expect(response.status).toBe(200)
    expect(response.body.token).toBe("stub-token")
    expect(typeof response.body.expiresAt).toBe("number")
  })

  it("POST /api/analyze returns minimal semantics", async () => {
    const response = await request(app)
      .post("/api/analyze")
      .send({
        userId: "user_sungwoo",
        articleUrl: null,
        threadDoc: {
          url: "https://news.ycombinator.com/item?id=39900001",
          title: "Why AI Agents Need World Models",
          submitter: "alice",
          score: 42,
          comments: [
            {
              id: "39900123",
              author: "bob",
              text: "Agents should keep an explicit world model.",
              depth: 0,
              score: null,
              parentId: null,
              timestamp: Date.now()
            }
          ]
        }
      })

    expect(response.status).toBe(200)
    expect(response.body.cached).toBe(false)
    expect(response.body.threadSemantics.topic).toBe("Why AI Agents Need World Models")
    expect(Array.isArray(response.body.threadSemantics.claims)).toBe(true)
  })

  it("POST /api/evaluate streams projection then done", async () => {
    const response = await request(app)
      .post("/api/evaluate")
      .send({
        stateSnapshot: sampleSnapshot,
        conversationContext: null
      })

    expect(response.status).toBe(200)
    const body = response.text

    const projectionIdx = body.indexOf("event: projection")
    const doneIdx = body.indexOf("event: done")

    expect(projectionIdx).toBeGreaterThanOrEqual(0)
    expect(doneIdx).toBeGreaterThan(projectionIdx)
    expect(body).toContain('"type":"respond"')
  })
})
