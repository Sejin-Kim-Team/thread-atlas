import request from "supertest"
import { describe, expect, it } from "vitest"
import { createServer } from "../../src/server"
import {
  assertOrderedEventTypes,
  createContextUpdatePayload,
  createEnvelope,
  createSessionOpenPayload,
  createUserIntentPayload,
  createValidSnapshot,
  postWsEvent
} from "./helpers/ws-contract"

const app = createServer()

describe("ws current-page turn flow", () => {
  it("follows open -> context.update -> snapshot.push -> user.intent and returns progress/projection/turn.done", async () => {
    const client = request(app)

    const open = await postWsEvent(
      client,
      createEnvelope("session.open", createSessionOpenPayload(), { requestId: "req-open-1" })
    )

    const sessionId = open.body?.payload?.sessionId

    const context = await postWsEvent(
      client,
      createEnvelope("context.update", createContextUpdatePayload(), {
        requestId: "req-ctx-1",
        sessionId
      })
    )

    const snapshot = await postWsEvent(
      client,
      createEnvelope(
        "snapshot.push",
        {
          tabId: 128,
          snapshot: createValidSnapshot()
        },
        {
          requestId: "req-snapshot-1",
          sessionId
        }
      )
    )

    const intent = await postWsEvent(
      client,
      createEnvelope("user.intent", createUserIntentPayload(), {
        requestId: "req-intent-1",
        sessionId
      })
    )

    expect(open.status).toBe(200)
    expect(context.status).toBe(200)
    expect(snapshot.status).toBe(200)
    expect(intent.status).toBe(200)
    expect(Array.isArray(intent.body.events)).toBe(true)
    expect(
      assertOrderedEventTypes(intent.body.events as Array<{ type?: string }>, [
        "progress",
        "projection",
        "turn.done"
      ])
    ).toBe(true)
  })

  it("keeps referencedTabIds in turn.done within current-page scope", async () => {
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
          requestId: "req-snapshot-1",
          sessionId
        }
      )
    )

    const intent = await postWsEvent(
      client,
      createEnvelope("user.intent", createUserIntentPayload(128), {
        requestId: "req-intent-1",
        sessionId
      })
    )

    expect(intent.status).toBe(200)
    const doneEvent = (intent.body.events as Array<{ type?: string; payload?: unknown }>).find(
      (event) => event.type === "turn.done"
    ) as { payload?: { referencedTabIds?: number[] } } | undefined

    expect(doneEvent).toBeDefined()
    expect(Array.isArray(doneEvent?.payload?.referencedTabIds)).toBe(true)
    expect(doneEvent?.payload?.referencedTabIds).toEqual([128])
  })

  it("does not rely on TURN_CONFLICT for follow-up intents", async () => {
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
          requestId: "req-snapshot-1",
          sessionId
        }
      )
    )

    await postWsEvent(
      client,
      createEnvelope("user.intent", createUserIntentPayload(128), {
        requestId: "req-intent-1",
        sessionId
      })
    )

    const followUp = await postWsEvent(
      client,
      createEnvelope("user.intent", createUserIntentPayload(128), {
        requestId: "req-intent-2",
        sessionId
      })
    )

    expect(followUp.status).toBe(200)
    expect(followUp.body.type).not.toBe("error")
    expect(followUp.body.payload?.code).not.toBe("TURN_CONFLICT")
  })
})
