import request from "supertest"
import { describe, expect, it } from "vitest"
import { createServer } from "../../src/server"
import {
  createContextUpdatePayload,
  createEnvelope,
  createSessionOpenPayload,
  issueAuthToken,
  postWsEvent
} from "./helpers/ws-contract"

describe("WS auth principal contract (red)", () => {
  it("rejects /ws/session/events when Authorization header is missing", async () => {
    const app = createServer()
    const client = request(app)

    const response = await postWsEvent(
      client,
      createEnvelope("session.open", createSessionOpenPayload(), { requestId: "req-open-auth-1" })
    )

    expect(response.status).toBe(401)
    expect(response.body).toMatchObject({
      type: "error",
      payload: {
        code: "UNAUTHORIZED"
      }
    })
  })

  it("rejects /ws/session/events when Authorization token is invalid", async () => {
    const app = createServer()

    const response = await request(app)
      .post("/ws/session/events")
      .set("Authorization", "Bearer invalid-token")
      .send(createEnvelope("session.open", createSessionOpenPayload(), { requestId: "req-open-auth-2" }))

    expect(response.status).toBe(401)
    expect(response.body).toMatchObject({
      type: "error",
      payload: {
        code: "UNAUTHORIZED"
      }
    })
  })

  it("rejects ws session reuse when principal differs even if clientSessionId is same", async () => {
    const app = createServer()
    const client = request(app)
    const sameClientSessionId = "sidepanel-shared-client-001"

    const tokenAlpha = await issueAuthToken(client, "user_alpha")
    const tokenBeta = await issueAuthToken(client, "user_beta")

    const openAlpha = await client
      .post("/ws/session/events")
      .set("Authorization", `Bearer ${tokenAlpha}`)
      .send(
        createEnvelope(
          "session.open",
          createSessionOpenPayload(),
          {
            requestId: "req-open-auth-principal-alpha",
            payload: {
              clientSessionId: sameClientSessionId
            }
          }
        )
      )

    const openBeta = await client
      .post("/ws/session/events")
      .set("Authorization", `Bearer ${tokenBeta}`)
      .send(
        createEnvelope(
          "session.open",
          createSessionOpenPayload(),
          {
            requestId: "req-open-auth-principal-beta",
            payload: {
              clientSessionId: sameClientSessionId
            }
          }
        )
      )

    expect(openAlpha.status).toBe(200)
    expect(openBeta.status).toBe(401)
    expect(openAlpha.body.type).toBe("session.ready")
    expect(typeof openAlpha.body.payload?.sessionId).toBe("string")
    expect(openBeta.body).toMatchObject({
      type: "error",
      payload: {
        code: "UNAUTHORIZED"
      }
    })
  })

  it("rejects event handling when session owner principal differs", async () => {
    const app = createServer()
    const client = request(app)
    const tokenAlpha = await issueAuthToken(client, "user_alpha")
    const tokenBeta = await issueAuthToken(client, "user_beta")

    const openAlpha = await client
      .post("/ws/session/events")
      .set("Authorization", `Bearer ${tokenAlpha}`)
      .send(createEnvelope("session.open", createSessionOpenPayload(), { requestId: "req-open-auth-3" }))

    const sessionId = openAlpha.body.payload?.sessionId as string
    expect(openAlpha.status).toBe(200)
    expect(typeof sessionId).toBe("string")

    const hijackAttempt = await client
      .post("/ws/session/events")
      .set("Authorization", `Bearer ${tokenBeta}`)
      .send(createEnvelope("context.update", createContextUpdatePayload(), {
        requestId: "req-open-auth-4",
        sessionId
      }))

    expect(hijackAttempt.status).toBe(401)
    expect(hijackAttempt.body).toMatchObject({
      type: "error",
      payload: {
        code: "UNAUTHORIZED"
      }
    })
  })
})
