import request from "supertest"
import { describe, expect, it } from "vitest"
import { createServer } from "../../src/server"
import {
  createContextUpdatePayload,
  createEnvelope,
  createInvalidSnapshotFocusMismatch,
  createSessionOpenPayload,
  createUserIntentPayload,
  createValidSnapshot,
  createUserIntentPayloadWithMismatchedBinding,
  postWsEvent
} from "./helpers/ws-contract"

const app = createServer()

describe("ws current-page binding error contract", () => {
  it("returns INVALID_EVENT when user.intent misses boundSnapshotCapturedAt", async () => {
    const client = request(app)

    const open = await postWsEvent(
      client,
      createEnvelope("session.open", createSessionOpenPayload(), { requestId: "req-open-1" })
    )
    const sessionId = open.body?.payload?.sessionId

    const response = await postWsEvent(
      client,
      createEnvelope(
        "user.intent",
        {
          text: "Explain this",
          primaryTabId: 128,
          mode: "text"
        },
        {
          requestId: "req-intent-invalid-1",
          sessionId
        }
      )
    )

    expect(response.status).toBe(400)
    expect(response.body.type).toBe("error")
    expect(response.body.payload.code).toBe("INVALID_EVENT")
  })

  it("returns INVALID_SNAPSHOT when user.intent.primaryTabId mismatches active primary tab", async () => {
    const client = request(app)

    const open = await postWsEvent(
      client,
      createEnvelope("session.open", createSessionOpenPayload(), { requestId: "req-open-1" })
    )
    const sessionId = open.body?.payload?.sessionId

    await postWsEvent(
      client,
      createEnvelope("context.update", createContextUpdatePayload(128), {
        requestId: "req-ctx-1",
        sessionId
      })
    )

    const response = await postWsEvent(
      client,
      createEnvelope("user.intent", createUserIntentPayload(999), {
        requestId: "req-intent-tab-mismatch",
        sessionId
      })
    )

    expect(response.status).toBe(400)
    expect(response.body.type).toBe("error")
    expect(response.body.payload.code).toBe("INVALID_SNAPSHOT")
  })

  it("returns INVALID_SNAPSHOT when snapshot.push has mismatched focus ids", async () => {
    const client = request(app)

    const open = await postWsEvent(
      client,
      createEnvelope("session.open", createSessionOpenPayload(), { requestId: "req-open-1" })
    )
    const sessionId = open.body?.payload?.sessionId

    const response = await postWsEvent(
      client,
      createEnvelope(
        "snapshot.push",
        {
          tabId: 128,
          snapshot: createInvalidSnapshotFocusMismatch()
        },
        {
          requestId: "req-snapshot-invalid-focus",
          sessionId
        }
      )
    )

    expect(response.status).toBe(400)
    expect(response.body.type).toBe("error")
    expect(response.body.payload.code).toBe("INVALID_SNAPSHOT")
  })

  it("returns INVALID_SNAPSHOT when user.intent.boundSnapshotCapturedAt mismatches latest snapshot", async () => {
    const client = request(app)

    const open = await postWsEvent(
      client,
      createEnvelope("session.open", createSessionOpenPayload(), { requestId: "req-open-1" })
    )
    const sessionId = open.body?.payload?.sessionId

    await postWsEvent(
      client,
      createEnvelope("context.update", createContextUpdatePayload(128), {
        requestId: "req-ctx-1",
        sessionId
      })
    )

    await postWsEvent(
      client,
      createEnvelope(
        "snapshot.push",
        {
          tabId: 128,
          snapshot: createValidSnapshot()
        },
        {
          requestId: "req-snapshot-valid-for-binding",
          sessionId
        }
      )
    )

    const response = await postWsEvent(
      client,
      createEnvelope("user.intent", createUserIntentPayloadWithMismatchedBinding(128), {
        requestId: "req-intent-binding-mismatch",
        sessionId
      })
    )

    expect(response.status).toBe(400)
    expect(response.body.type).toBe("error")
    expect(response.body.payload.code).toBe("INVALID_SNAPSHOT")
  })
})
