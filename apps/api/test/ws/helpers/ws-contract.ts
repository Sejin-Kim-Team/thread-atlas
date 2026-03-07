export const WS_EVENTS_ENDPOINT = "/ws/session/events"

export function createEnvelope<TPayload>(
  type: string,
  payload: TPayload,
  overrides?: Record<string, unknown>
) {
  return {
    type,
    timestamp: "2026-03-07T14:00:00.000Z",
    payload,
    ...(overrides ?? {})
  }
}

export function createSessionOpenPayload() {
  return {
    clientSessionId: "sidepanel-7f3f2c",
    openedAt: "2026-03-07T14:00:00.000Z",
    capabilities: {
      liveAudio: true,
      liveVision: true,
      visualSummary: true
    }
  }
}

export function createContextUpdatePayload(tabId = 128) {
  return {
    tabId,
    url: "https://news.ycombinator.com/item?id=43210000",
    pageKind: "thread",
    isPrimary: true,
    title: "Ask HN: WebSocket vs SSE"
  }
}

export function createValidSnapshot(capturedAt = "2026-03-07T14:00:01.500Z") {
  return {
    page: {
      id: "hn-43210000",
      url: "https://news.ycombinator.com/item?id=43210000",
      title: "Ask HN: WebSocket vs SSE",
      kind: "thread"
    },
    focus: {
      nodeId: "comment-43210091",
      node: {
        id: "comment-43210091",
        kind: "comment",
        author: "alice",
        text: "WebSocket is better for interruption and bidirectional updates.",
        parentId: "comment-43210010",
        depth: 1
      },
      region: "comment-tree"
    },
    context: [
      {
        relation: "parent",
        distance: 1,
        node: {
          id: "comment-43210010",
          kind: "comment",
          author: "bob",
          text: "Is SSE enough?",
          depth: 0
        }
      }
    ],
    meta: {
      capturedAt,
      skeletonVersion: 12,
      extractorId: "generic+hacker-news-enhancer"
    }
  }
}

export function createInvalidSnapshotFocusMismatch() {
  const snapshot = createValidSnapshot()
  return {
    ...snapshot,
    focus: {
      ...snapshot.focus,
      nodeId: "comment-mismatch"
    }
  }
}

export function createUserIntentPayload(
  primaryTabId = 128,
  boundSnapshotCapturedAt = "2026-03-07T14:00:01.500Z"
) {
  return {
    text: "Summarize this and recall similar past case",
    primaryTabId,
    boundSnapshotCapturedAt,
    mode: "voice"
  }
}

export function createUserIntentPayloadWithMismatchedBinding(primaryTabId = 128) {
  return createUserIntentPayload(primaryTabId, "2026-03-07T14:09:59.000Z")
}

export async function postWsEvent(client: any, envelope: unknown) {
  return client.post(WS_EVENTS_ENDPOINT).send(envelope)
}

export function assertOrderedEventTypes(events: Array<{ type?: string }>, expectedOrder: string[]) {
  let cursor = -1
  for (const type of expectedOrder) {
    const next = events.findIndex((event, idx) => idx > cursor && event.type === type)
    if (next < 0) {
      return false
    }
    cursor = next
  }
  return true
}
