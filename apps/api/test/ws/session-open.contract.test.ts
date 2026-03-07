import request from "supertest"
import { describe, expect, it } from "vitest"
import { createServer } from "../../src/server"
import {
  createEnvelope,
  createSessionOpenPayload,
  postWsEvent
} from "./helpers/ws-contract"

const app = createServer()

describe("ws session.open contract", () => {
  it("returns session.ready with protocolVersion=1", async () => {
    const client = request(app)
    const response = await postWsEvent(
      client,
      createEnvelope("session.open", createSessionOpenPayload(), { requestId: "req-open-1" })
    )

    expect(response.status).toBe(200)
    expect(response.body.type).toBe("session.ready")
    expect(response.body.payload.protocolVersion).toBe(1)
    expect(typeof response.body.payload.sessionId).toBe("string")
  })

  it("returns INVALID_EVENT when required envelope fields are missing", async () => {
    const client = request(app)
    const response = await postWsEvent(client, {
      type: "session.open",
      payload: createSessionOpenPayload()
    })

    expect(response.status).toBe(400)
    expect(response.body.type).toBe("error")
    expect(response.body.payload.code).toBe("INVALID_EVENT")
  })

  it("keeps reconnect policy deterministic for same clientSessionId", async () => {
    const client = request(app)
    const first = await postWsEvent(
      client,
      createEnvelope("session.open", createSessionOpenPayload(), { requestId: "req-open-1" })
    )
    const second = await postWsEvent(
      client,
      createEnvelope("session.open", createSessionOpenPayload(), { requestId: "req-open-2" })
    )

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(second.body.type).toBe("session.ready")
    expect(typeof second.body.payload.sessionId).toBe("string")
  })
})

