import type { SemanticSnapshot } from "@threadatlas/shared"
import { describe, expect, it, vi } from "vitest"
import { ConversationController } from "../src/sidepanel/conversation-controller"

const snapshot: SemanticSnapshot = {
  page: {
    id: "page-1",
    url: "https://example.com/docs",
    title: "Docs page",
    kind: "article"
  },
  focus: {
    nodeId: "node-1",
    node: {
      kind: "content",
      id: "node-1",
      type: "paragraph",
      text: "Current page summary"
    },
    region: "region-1"
  },
  context: [],
  meta: {
    capturedAt: "2026-03-16T00:00:00.000Z",
    skeletonVersion: 1,
    extractorId: "test"
  }
}

describe("ConversationController", () => {
  it("routes page audio chunks into the runtime transport only while a voice turn is active", async () => {
    const appendAudioChunk = vi.fn()
    const audioInput = {
      supported: true,
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      cancel: vi.fn(),
      dispose: vi.fn(),
      onChunkBase64: undefined as ((chunkBase64: string) => void) | undefined,
      onError: undefined as ((error: Error) => void) | undefined,
      onStateChange: undefined as ((state: "idle" | "listening" | "processing" | "unsupported" | "error", detail?: string) => void) | undefined
    }
    const controller = new ConversationController({
      apiBaseUrl: "http://localhost:8080",
      authClient: { issueToken: vi.fn() },
      getActiveTabId: () => 17,
      sendToContentScript: vi.fn(),
      ttsEnabled: false,
      audioInput,
      audioOutput: {
        supported: true,
        playChunk: vi.fn(),
        stop: vi.fn(),
        dispose: vi.fn()
      },
      transport: {
        sendTextTurn: vi.fn(),
        startVoiceTurn: vi.fn(),
        appendAudioChunk,
        commitAudio: vi.fn(),
        interrupt: vi.fn(),
        close: vi.fn()
      },
      handlers: {}
    })

    audioInput.onChunkBase64?.("ignored-before-start")
    await controller.startVoiceTurn({
      activeTabId: 17,
      snapshot
    })
    audioInput.onChunkBase64?.("voice-chunk")
    await controller.finishVoiceTurn()
    audioInput.onChunkBase64?.("ignored-after-finish")

    expect(appendAudioChunk).toHaveBeenCalledWith("voice-chunk")
    expect(appendAudioChunk).toHaveBeenCalledTimes(1)
    expect(controller.inputSupported).toBe(true)
  })

  it("stops page capture before committing audio", async () => {
    const order: string[] = []
    const audioInput = {
      supported: true,
      start: vi.fn(async () => {
        order.push("input.start")
      }),
      stop: vi.fn(async () => {
        order.push("input.stop")
      }),
      cancel: vi.fn(async () => {
        order.push("input.cancel")
      }),
      dispose: vi.fn(),
      onChunkBase64: undefined as ((chunkBase64: string) => void) | undefined,
      onError: undefined as ((error: Error) => void) | undefined,
      onStateChange: undefined as ((state: "idle" | "listening" | "processing" | "unsupported" | "error", detail?: string) => void) | undefined
    }
    const transport = {
      sendTextTurn: vi.fn(),
      startVoiceTurn: vi.fn(async () => {
        order.push("transport.startVoiceTurn")
      }),
      appendAudioChunk: vi.fn(),
      commitAudio: vi.fn(() => {
        order.push("transport.commitAudio")
      }),
      interrupt: vi.fn(async () => {
        order.push("transport.interrupt")
      }),
      close: vi.fn(async () => {
        order.push("transport.close")
      })
    }
    const controller = new ConversationController({
      apiBaseUrl: "http://localhost:8080",
      authClient: { issueToken: vi.fn() },
      getActiveTabId: () => 17,
      sendToContentScript: vi.fn(),
      ttsEnabled: false,
      audioInput,
      audioOutput: {
        supported: true,
        playChunk: vi.fn(),
        stop: vi.fn(),
        dispose: vi.fn()
      },
      transport,
      handlers: {}
    })

    await controller.startVoiceTurn({
      activeTabId: 17,
      snapshot
    })
    await controller.finishVoiceTurn()

    expect(order).toEqual([
      "transport.startVoiceTurn",
      "input.start",
      "input.stop",
      "transport.commitAudio"
    ])
  })
})
