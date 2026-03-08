import request from "supertest"
import { describe, expect, it } from "vitest"
import { listAnalysisRunsByOwner } from "../../src/rag/analysis-runs-repository"
import { createServer } from "../../src/server"
import { buildAnalyzeRequest } from "../http/helpers/payloads"
import {
  buildGoogleIdTokenGrantRequest,
  googleIdTokenFixtures
} from "../helpers/google-id-token-fixtures"
import {
  createContextUpdatePayload,
  createEnvelope,
  createSessionOpenPayload
} from "./helpers/ws-contract"

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function issueGoogleAppToken(
  client: request.SuperTest<request.Test>,
  idToken: string
): Promise<{ token: string; userId: string }> {
  const response = await client
    .post("/api/token")
    .send(buildGoogleIdTokenGrantRequest(idToken))

  expect(response.status).toBe(200)
  expect(response.body.user?.id).toMatch(UUID_V4_REGEX)

  return {
    token: response.body.token as string,
    userId: response.body.user.id as string
  }
}

describe("google grant token principal parity across HTTP/WS (red)", () => {
  it("treats same google-granted app token as same principal in HTTP and WS paths", async () => {
    const app = createServer()
    const client = request(app)
    const issued = await issueGoogleAppToken(client, googleIdTokenFixtures.validPrimary)

    const analyze = await client
      .post("/api/analyze")
      .set("Authorization", `Bearer ${issued.token}`)
      .send(buildAnalyzeRequest("seed"))

    expect(analyze.status).toBe(200)
    expect(typeof analyze.body.analysisId).toBe("string")

    const runs = await listAnalysisRunsByOwner({
      ownerUserId: issued.userId,
      mode: "seed",
      limit: 20
    })
    expect(runs.some((run) => run.id === analyze.body.analysisId)).toBe(true)

    const open = await client
      .post("/ws/session/events")
      .set("Authorization", `Bearer ${issued.token}`)
      .send(
        createEnvelope("session.open", createSessionOpenPayload(), {
          requestId: "req-google-parity-open-1"
        })
      )

    expect(open.status).toBe(200)
    expect(open.body.type).toBe("session.ready")
    expect(typeof open.body.payload?.sessionId).toBe("string")

    const contextUpdate = await client
      .post("/ws/session/events")
      .set("Authorization", `Bearer ${issued.token}`)
      .send(
        createEnvelope("context.update", createContextUpdatePayload(128), {
          requestId: "req-google-parity-context-1",
          sessionId: open.body.payload.sessionId as string
        })
      )

    expect(contextUpdate.status).toBe(200)
  })

  it("keeps stable principal ownership across relogin tokens from same google sub", async () => {
    const app = createServer()
    const client = request(app)
    const first = await issueGoogleAppToken(client, googleIdTokenFixtures.validPrimary)
    const second = await issueGoogleAppToken(client, googleIdTokenFixtures.validReloginSameSub)
    const sharedClientSessionId = "sidepanel-google-parity-relogin-001"

    expect(first.userId).toBe(second.userId)
    expect(first.token).not.toBe(second.token)

    const openFirst = await client
      .post("/ws/session/events")
      .set("Authorization", `Bearer ${first.token}`)
      .send(
        createEnvelope(
          "session.open",
          {
            ...createSessionOpenPayload(),
            clientSessionId: sharedClientSessionId
          },
          {
            requestId: "req-google-parity-open-2"
          }
        )
      )

    expect(openFirst.status).toBe(200)
    expect(openFirst.body.type).toBe("session.ready")
    expect(typeof openFirst.body.payload?.sessionId).toBe("string")

    const contextUpdateWithReloginToken = await client
      .post("/ws/session/events")
      .set("Authorization", `Bearer ${second.token}`)
      .send(
        createEnvelope("context.update", createContextUpdatePayload(129), {
          requestId: "req-google-parity-context-2",
          sessionId: openFirst.body.payload.sessionId as string
        })
      )

    expect(contextUpdateWithReloginToken.status).toBe(200)

    const analyze = await client
      .post("/api/analyze")
      .set("Authorization", `Bearer ${second.token}`)
      .send(buildAnalyzeRequest("seed"))

    expect(analyze.status).toBe(200)
  })
})
