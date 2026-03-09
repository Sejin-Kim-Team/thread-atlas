import { describe, expect, it } from "vitest"
import { RuntimeManager } from "../../src/session/runtime/manager"
import {
  createEnvelope,
  createValidSnapshot
} from "./helpers/ws-contract"

const TEST_OWNER_ID = "user_snapshot_like"

async function openSession(runtime: RuntimeManager): Promise<string> {
  const openResponse = await runtime.handle(
    createEnvelope(
      "session.open",
      {
        clientSessionId: `sidepanel-snapshot-like-${Math.random().toString(16).slice(2)}`
      },
      { requestId: "req-snapshot-like-open" }
    ),
    { principalUserId: TEST_OWNER_ID }
  )
  expect(openResponse.status).toBe(200)
  const body = openResponse.body as Record<string, unknown>
  return String(body.sessionId ?? "")
}

async function updatePrimaryTab(
  runtime: RuntimeManager,
  sessionId: string,
  tabId = 128
): Promise<void> {
  const contextResponse = await runtime.handle(
    createEnvelope("context.update", { tabId, isPrimary: true }, {
      requestId: "req-snapshot-like-context",
      sessionId
    }),
    { principalUserId: TEST_OWNER_ID }
  )
  expect(contextResponse.status).toBe(200)
}

function buildRichCommentSnapshot(capturedAt: string) {
  const base = createValidSnapshot(capturedAt)
  return {
    ...base,
    page: {
      ...base.page,
      metadata: {
        ...base.page.metadata,
        layout: "dense"
      }
    },
    meta: {
      ...base.meta,
      coverage: {
        ...base.meta.coverage,
        capturedNodeCount: 12
      }
    },
    visualSignals: {
      uiSuspicious: false,
      anomalyScore: 0.31
    }
  }
}

function buildRichInteractiveSnapshot(capturedAt: string) {
  return {
    page: {
      id: "toolbar-page",
      url: "https://example.com/feed",
      title: "Team Feed",
      kind: "generic",
      metadata: {
        surface: "toolbar",
        locale: "ko-KR"
      }
    },
    focus: {
      nodeId: "toolbar-sort-button",
      node: {
        kind: "interactive",
        id: "toolbar-sort-button",
        controlType: "button",
        label: "정렬 기준",
        role: "button",
        action: "sort",
        state: "selected",
        valuePreview: "최신순",
        metadata: {
          section: "toolbar"
        }
      },
      region: "top-toolbar"
    },
    context: [
      {
        relation: "container",
        distance: 1,
        node: {
          kind: "content",
          id: "section-controls",
          type: "metadata",
          text: "게시물 정렬 및 필터 컨트롤",
          attributes: {
            emphasis: "high"
          }
        }
      }
    ],
    meta: {
      capturedAt,
      skeletonVersion: 13,
      extractorId: "generic-runtime",
      coverage: {
        kind: "focus-section",
        rootNodeId: "section-controls",
        capturedNodeCount: 6,
        omittedNodeCount: 0,
        omittedRootCount: 0
      }
    },
    visualSignals: {
      uiSuspicious: false,
      anomalyScore: 0.12
    }
  }
}

describe("ws snapshotLike shared alignment (red)", () => {
  it("accepts rich shared snapshot shape with metadata/coverage and visualSignals", async () => {
    const runtime = new RuntimeManager({ enrichTriggerMode: "hybrid-complex" })
    const sessionId = await openSession(runtime)
    await updatePrimaryTab(runtime, sessionId)

    const capturedAt = "2026-03-08T16:10:00.000Z"
    const response = await runtime.handle(
      createEnvelope(
        "snapshot.push",
        {
          tabId: 128,
          snapshot: buildRichCommentSnapshot(capturedAt)
        },
        {
          requestId: "req-snapshot-like-rich-comment",
          sessionId
        }
      ),
      { principalUserId: TEST_OWNER_ID }
    )

    expect(response.status).toBe(200)
    const body = response.body as Record<string, unknown>
    expect(body.type).toBe("ack")
  })

  it("rejects snapshot.push when visualSignals type violates intersection contract", async () => {
    const runtime = new RuntimeManager({ enrichTriggerMode: "hybrid-complex" })
    const sessionId = await openSession(runtime)
    await updatePrimaryTab(runtime, sessionId)

    const capturedAt = "2026-03-08T16:11:00.000Z"
    const malformedVisualSignalsSnapshot = {
      ...createValidSnapshot(capturedAt),
      visualSignals: {
        uiSuspicious: "true",
        anomalyScore: "0.9"
      }
    }

    const response = await runtime.handle(
      createEnvelope(
        "snapshot.push",
        {
          tabId: 128,
          snapshot: malformedVisualSignalsSnapshot
        },
        {
          requestId: "req-snapshot-like-invalid-visual-signals",
          sessionId
        }
      ),
      { principalUserId: TEST_OWNER_ID }
    )

    expect(response.status).toBe(400)
    const body = response.body as Record<string, unknown>
    expect(body.type).toBe("error")
    const payload = body.payload as Record<string, unknown>
    expect(payload?.code).toBe("INVALID_SNAPSHOT")
  })

  it("accepts interactive union node fields at runtime boundary with coverage", async () => {
    const runtime = new RuntimeManager({ enrichTriggerMode: "hybrid-complex" })
    const sessionId = await openSession(runtime)
    await updatePrimaryTab(runtime, sessionId)

    const capturedAt = "2026-03-08T16:12:00.000Z"
    const response = await runtime.handle(
      createEnvelope(
        "snapshot.push",
        {
          tabId: 128,
          snapshot: buildRichInteractiveSnapshot(capturedAt)
        },
        {
          requestId: "req-snapshot-like-rich-interactive",
          sessionId
        }
      ),
      { principalUserId: TEST_OWNER_ID }
    )

    expect(response.status).toBe(200)
    const body = response.body as Record<string, unknown>
    expect(body.type).toBe("ack")
  })
})
