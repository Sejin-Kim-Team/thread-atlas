import request from "supertest"
import { describe, expect, it } from "vitest"
import { createServer } from "../../src/server"
import { requireEnv } from "../helpers/env"
import {
  createContextUpdatePayload,
  createEnvelope,
  createSessionOpenPayload,
  postWsEvent
} from "./helpers/ws-contract"

const BOOTSTRAP_KEY = requireEnv("AUTH_BOOTSTRAP_KEY")
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function issueTransitionToken(
  client: request.SuperTest<request.Test>,
  bootstrapSubject: string
): Promise<{ token: string; userId: string }> {
  const response = await client
    .post("/api/token")
    .set("X-Bootstrap-Key", BOOTSTRAP_KEY)
    .send({
      grantType: "dev-bootstrap",
      bootstrapSubject
    })

  expect(response.status).toBe(200)
  expect(response.body.user?.id).toMatch(UUID_V4_REGEX)
  return {
    token: response.body.token as string,
    userId: response.body.user.id as string
  }
}

describe("WS auth principal contract (red)", () => {
  it("opens session with app token issued from dev-bootstrap grant", async () => {
    const app = createServer()
    const client = request(app)
    const issued = await issueTransitionToken(client, "google-sub-ws-alpha")

    const response = await client
      .post("/ws/session/events")
      .set("Authorization", `Bearer ${issued.token}`)
      .send(createEnvelope("session.open", createSessionOpenPayload(), { requestId: "req-open-auth-0" }))

    expect(response.status).toBe(200)
    expect(response.body.type).toBe("session.ready")
  })

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

    const alpha = await issueTransitionToken(client, "google-sub-ws-beta")
    const beta = await issueTransitionToken(client, "google-sub-ws-gamma")

    const openAlpha = await client
      .post("/ws/session/events")
      .set("Authorization", `Bearer ${alpha.token}`)
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
      .set("Authorization", `Bearer ${beta.token}`)
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
    const alpha = await issueTransitionToken(client, "google-sub-ws-delta")
    const beta = await issueTransitionToken(client, "google-sub-ws-epsilon")

    const openAlpha = await client
      .post("/ws/session/events")
      .set("Authorization", `Bearer ${alpha.token}`)
      .send(createEnvelope("session.open", createSessionOpenPayload(), { requestId: "req-open-auth-3" }))

    const sessionId = openAlpha.body.payload?.sessionId as string
    expect(openAlpha.status).toBe(200)
    expect(typeof sessionId).toBe("string")

    const hijackAttempt = await client
      .post("/ws/session/events")
      .set("Authorization", `Bearer ${beta.token}`)
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

  it("issues different app tokens for same bootstrapSubject while keeping same local user id", async () => {
    const app = createServer()
    const client = request(app)

    const first = await issueTransitionToken(client, "google-sub-ws-zeta")
    const second = await issueTransitionToken(client, "google-sub-ws-zeta")

    expect(first.userId).toMatch(UUID_V4_REGEX)
    expect(second.userId).toMatch(UUID_V4_REGEX)
    expect(first.userId).toBe(second.userId)
    expect(first.token).not.toBe(second.token)
  })
})
