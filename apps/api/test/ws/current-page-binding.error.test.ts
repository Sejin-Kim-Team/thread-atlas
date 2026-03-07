import request from "supertest"
import { describe, expect, it } from "vitest"
import { createServer } from "../../src/server"
import {
  createContextUpdatePayload,
  createEnvelope,
  createInvalidSnapshotFocusMismatch,
  createSessionOpenPayload,
  createUserIntentPayload,
  createUserIntentPayloadWithMismatchedBinding,
  createValidSnapshot,
  issueAuthToken,
  postWsEventWithAuth
} from "./helpers/ws-contract"

const app = createServer()

describe("ws current-page binding error contract", () => {
  it("returns INVALID_EVENT when user.intent misses boundSnapshotCapturedAt", async () => {
    const client = request(app)
    const token = await issueAuthToken(client)

    const open = await postWsEventWithAuth(
      client,
      createEnvelope("session.open", createSessionOpenPayload(), { requestId: "req-open-1" }),
      token
    )
    const sessionId = open.body?.payload?.sessionId

    const response = await postWsEventWithAuth(
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
      ),
      token
    )

    expect(response.status).toBe(400)
    expect(response.body.type).toBe("error")
    expect(response.body.payload.code).toBe("INVALID_EVENT")
  })

  it("returns INVALID_SNAPSHOT when user.intent.primaryTabId mismatches active primary tab", async () => {
    const client = request(app)
    const token = await issueAuthToken(client)

    const open = await postWsEventWithAuth(
      client,
      createEnvelope("session.open", createSessionOpenPayload(), { requestId: "req-open-1" }),
      token
    )
    const sessionId = open.body?.payload?.sessionId

    await postWsEventWithAuth(
      client,
      createEnvelope("context.update", createContextUpdatePayload(128), {
        requestId: "req-ctx-1",
        sessionId
      }),
      token
    )

    const response = await postWsEventWithAuth(
      client,
      createEnvelope("user.intent", createUserIntentPayload(999), {
        requestId: "req-intent-tab-mismatch",
        sessionId
      }),
      token
    )

    expect(response.status).toBe(400)
    expect(response.body.type).toBe("error")
    expect(response.body.payload.code).toBe("INVALID_SNAPSHOT")
  })

  it("returns INVALID_SNAPSHOT when snapshot.push has mismatched focus ids", async () => {
    const client = request(app)
    const token = await issueAuthToken(client)

    const open = await postWsEventWithAuth(
      client,
      createEnvelope("session.open", createSessionOpenPayload(), { requestId: "req-open-1" }),
      token
    )
    const sessionId = open.body?.payload?.sessionId

    await postWsEventWithAuth(
      client,
      createEnvelope("context.update", createContextUpdatePayload(128), {
        requestId: "req-ctx-1",
        sessionId
      }),
      token
    )

    const response = await postWsEventWithAuth(
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
      ),
      token
    )

    expect(response.status).toBe(400)
    expect(response.body.type).toBe("error")
    expect(response.body.payload.code).toBe("INVALID_SNAPSHOT")
  })

  it("returns INVALID_SNAPSHOT when snapshot.push payload is malformed", async () => {
    const client = request(app)
    const token = await issueAuthToken(client)

    const open = await postWsEventWithAuth(
      client,
      createEnvelope("session.open", createSessionOpenPayload(), { requestId: "req-open-1" }),
      token
    )
    const sessionId = open.body?.payload?.sessionId

    await postWsEventWithAuth(
      client,
      createEnvelope("context.update", createContextUpdatePayload(128), {
        requestId: "req-ctx-1",
        sessionId
      }),
      token
    )

    const response = await postWsEventWithAuth(
      client,
      createEnvelope(
        "snapshot.push",
        {
          tabId: 128,
          snapshot: {
            focus: {
              nodeId: "comment-43210091"
            }
          }
        },
        {
          requestId: "req-snapshot-malformed",
          sessionId
        }
      ),
      token
    )

    expect(response.status).toBe(400)
    expect(response.body.type).toBe("error")
    expect(response.body.payload.code).toBe("INVALID_SNAPSHOT")
  })

  it("returns INVALID_SNAPSHOT when snapshot.push.tabId is not primary tab", async () => {
    const client = request(app)
    const token = await issueAuthToken(client)

    const open = await postWsEventWithAuth(
      client,
      createEnvelope("session.open", createSessionOpenPayload(), { requestId: "req-open-non-primary" }),
      token
    )
    const sessionId = open.body?.payload?.sessionId

    await postWsEventWithAuth(
      client,
      createEnvelope("context.update", createContextUpdatePayload(128), {
        requestId: "req-ctx-primary",
        sessionId
      }),
      token
    )

    const response = await postWsEventWithAuth(
      client,
      createEnvelope(
        "snapshot.push",
        {
          tabId: 999,
          snapshot: createValidSnapshot()
        },
        {
          requestId: "req-snapshot-non-primary",
          sessionId
        }
      ),
      token
    )

    expect(response.status).toBe(400)
    expect(response.body.type).toBe("error")
    expect(response.body.payload.code).toBe("INVALID_SNAPSHOT")
  })

  it("returns INVALID_SNAPSHOT when user.intent.boundSnapshotCapturedAt mismatches latest snapshot", async () => {
    const client = request(app)
    const token = await issueAuthToken(client)

    const open = await postWsEventWithAuth(
      client,
      createEnvelope("session.open", createSessionOpenPayload(), { requestId: "req-open-1" }),
      token
    )
    const sessionId = open.body?.payload?.sessionId

    await postWsEventWithAuth(
      client,
      createEnvelope("context.update", createContextUpdatePayload(128), {
        requestId: "req-ctx-1",
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
          snapshot: createValidSnapshot()
        },
        {
          requestId: "req-snapshot-valid-for-binding",
          sessionId
        }
      ),
      token
    )

    const response = await postWsEventWithAuth(
      client,
      createEnvelope("user.intent", createUserIntentPayloadWithMismatchedBinding(128), {
        requestId: "req-intent-binding-mismatch",
        sessionId
      }),
      token
    )

    expect(response.status).toBe(400)
    expect(response.body.type).toBe("error")
    expect(response.body.payload.code).toBe("INVALID_SNAPSHOT")
  })
})
