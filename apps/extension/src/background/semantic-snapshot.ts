import type {
  SemanticSnapshot,
} from "@threadatlas/shared"
import type {
  SemanticSelectionStateResponse,
  SemanticSnapshotCaptureResponse,
  ServiceWorkerToContentMessage,
  ServiceWorkerToSidePanelMessage
} from "@threadatlas/shared/runtime"
import { isSemanticCaptureSupportedUrl } from "../common/semantic-url"
import type { RegionDump } from "../content/semantic/core/observability"

export const SEMANTIC_SNAPSHOT_COMMAND = "capture-snapshot"
export const SEMANTIC_SELECTION_COMMAND = "toggle-selection"
export const SEMANTIC_SNAPSHOT_CONTEXT_MENU_ID = "capture-semantic-snapshot"
export const SEMANTIC_HISTORY_LIMIT = 20

type SnapshotReadyPayload = Extract<
  ServiceWorkerToSidePanelMessage,
  { type: "SEMANTIC_SNAPSHOT_READY" }
>["payload"]

type SnapshotHistoryPayload = Extract<
  ServiceWorkerToSidePanelMessage,
  { type: "SEMANTIC_SNAPSHOT_HISTORY_UPDATED" }
>["payload"]

type SelectionStatePayload = Extract<
  ServiceWorkerToSidePanelMessage,
  { type: "SEMANTIC_SELECTION_STATE_CHANGED" }
>["payload"]

export interface SemanticRegionDumpResponse {
  tabId: number | null
  dump: RegionDump | null
  error: string | null
}

interface ContentRegionDumpResponse {
  dump: RegionDump | null
}

export interface SemanticSnapshotTabLike {
  id?: number | null | undefined
  url?: string | undefined
}

interface SemanticSnapshotBridge {
  getActiveTab(): Promise<SemanticSnapshotTabLike | null>
  getTab(tabId: number): Promise<SemanticSnapshotTabLike | null>
  sendToContentScript(
    tabId: number,
    message: ServiceWorkerToContentMessage
  ): Promise<SemanticSnapshotCaptureResponse | SemanticSelectionStateResponse | ContentRegionDumpResponse>
  openSidePanel(tabId: number): Promise<void>
  notifyRuntime(message: ServiceWorkerToSidePanelMessage): void
}

function buildReadyPayload(tabId: number | null, response: SemanticSnapshotCaptureResponse): SnapshotReadyPayload {
  return {
    tabId,
    snapshot: response.snapshot,
    error: response.error
  }
}

function buildHistoryPayload(tabId: number | null, snapshots: SemanticSnapshot[]): SnapshotHistoryPayload {
  return {
    tabId,
    snapshots
  }
}

function normalizeCaptureResponse(
  result: SemanticSnapshotCaptureResponse | null | undefined
): SemanticSnapshotCaptureResponse {
  if (result && typeof result === "object" && "snapshot" in result && "error" in result) {
    return result
  }

  return {
    snapshot: null,
    error: "Semantic snapshot capture failed."
  }
}

function normalizeSelectionResponse(
  result: SemanticSelectionStateResponse | null | undefined
): SemanticSelectionStateResponse {
  if (result && typeof result === "object" && "enabled" in result && "selectedTarget" in result) {
    return result
  }

  return {
    enabled: false,
    selectedTarget: null
  }
}

function normalizeRegionDumpResponse(
  result: ContentRegionDumpResponse | null | undefined
): ContentRegionDumpResponse {
  if (result && typeof result === "object" && "dump" in result) {
    return result
  }

  return {
    dump: null
  }
}

export function createSemanticSnapshotCoordinator(bridge: SemanticSnapshotBridge) {
  const latestSnapshots = new Map<number, SemanticSnapshotCaptureResponse>()
  const snapshotHistory = new Map<number, SemanticSnapshot[]>()
  const selectionState = new Map<number, SemanticSelectionStateResponse>()

  async function captureForTab(
    tabId: number | null,
    source: "command" | "context-menu" | "popup" | "sidepanel",
    options: { openPanel?: boolean } = {}
  ): Promise<SnapshotReadyPayload> {
    const { openPanel = true } = options

    if (tabId === null) {
      const payload = buildReadyPayload(null, {
        snapshot: null,
        error: "No active tab available for semantic snapshot capture."
      })
      bridge.notifyRuntime({ type: "SEMANTIC_SNAPSHOT_READY", payload })
      return payload
    }

    const tab = await bridge.getTab(tabId)
    if (!tab || !isSemanticCaptureSupportedUrl(tab.url)) {
      const payload = buildReadyPayload(tabId, {
        snapshot: null,
        error: "Semantic snapshots are only supported on standard web pages."
      })
      latestSnapshots.set(tabId, {
        snapshot: null,
        error: payload.error
      })
      if (openPanel) {
        await bridge.openSidePanel(tabId)
      }
      bridge.notifyRuntime({ type: "SEMANTIC_SNAPSHOT_READY", payload })
      return payload
    }

    let result: SemanticSnapshotCaptureResponse
    try {
      result = normalizeCaptureResponse(
        (await bridge.sendToContentScript(tabId, {
          type: "CAPTURE_SEMANTIC_SNAPSHOT",
          payload: { source }
        })) as SemanticSnapshotCaptureResponse | null
      )
    } catch (error) {
      result = {
        snapshot: null,
        error: error instanceof Error ? error.message : "Semantic snapshot capture failed."
      }
    }

    latestSnapshots.set(tabId, result)

    if (result.snapshot) {
      const existing = snapshotHistory.get(tabId) ?? []
      const nextHistory = [result.snapshot, ...existing].slice(0, SEMANTIC_HISTORY_LIMIT)
      snapshotHistory.set(tabId, nextHistory)
      bridge.notifyRuntime({
        type: "SEMANTIC_SNAPSHOT_HISTORY_UPDATED",
        payload: buildHistoryPayload(tabId, nextHistory)
      })
    }

    if (openPanel) {
      await bridge.openSidePanel(tabId)
    }

    const payload = buildReadyPayload(tabId, result)
    bridge.notifyRuntime({ type: "SEMANTIC_SNAPSHOT_READY", payload })
    return payload
  }

  async function captureActiveTab(
    preferredTabId?: number,
    source: "command" | "context-menu" | "popup" | "sidepanel" = "command",
    options: { openPanel?: boolean } = {}
  ): Promise<SnapshotReadyPayload> {
    if (typeof preferredTabId === "number") {
      return captureForTab(preferredTabId, source, options)
    }

    const activeTab = await bridge.getActiveTab()
    return captureForTab(activeTab?.id ?? null, source, options)
  }

  async function getLatest(preferredTabId?: number): Promise<SnapshotReadyPayload> {
    let tabId = preferredTabId ?? null
    if (tabId === null) {
      tabId = (await bridge.getActiveTab())?.id ?? null
    }

    if (tabId === null) {
      return {
        tabId: null,
        snapshot: null,
        error: null
      }
    }

    const cached = latestSnapshots.get(tabId)
    return {
      tabId,
      snapshot: cached?.snapshot ?? null,
      error: cached?.error ?? null
    }
  }

  async function getHistory(preferredTabId?: number): Promise<SnapshotHistoryPayload> {
    let tabId = preferredTabId ?? null
    if (tabId === null) {
      tabId = (await bridge.getActiveTab())?.id ?? null
    }

    return buildHistoryPayload(tabId, tabId === null ? [] : snapshotHistory.get(tabId) ?? [])
  }

  async function toggleSelectionMode(preferredTabId?: number): Promise<SelectionStatePayload> {
    let tabId = preferredTabId ?? null
    if (tabId === null) {
      tabId = (await bridge.getActiveTab())?.id ?? null
    }

    if (tabId === null) {
      const payload = { tabId: null, enabled: false, selectedTarget: null }
      bridge.notifyRuntime({ type: "SEMANTIC_SELECTION_STATE_CHANGED", payload })
      return payload
    }

    const response = normalizeSelectionResponse(
      (await bridge.sendToContentScript(tabId, {
        type: "TOGGLE_SEMANTIC_SELECTION"
      })) as SemanticSelectionStateResponse | null
    )

    selectionState.set(tabId, response)
    const payload = { tabId, enabled: response.enabled, selectedTarget: response.selectedTarget }
    bridge.notifyRuntime({ type: "SEMANTIC_SELECTION_STATE_CHANGED", payload })
    return payload
  }

  async function getSelectionState(preferredTabId?: number): Promise<SelectionStatePayload> {
    let tabId = preferredTabId ?? null
    if (tabId === null) {
      tabId = (await bridge.getActiveTab())?.id ?? null
    }

    if (tabId === null) {
      return { tabId: null, enabled: false, selectedTarget: null }
    }

    if (selectionState.has(tabId)) {
      const cached = selectionState.get(tabId)
      return {
        tabId,
        enabled: cached?.enabled ?? false,
        selectedTarget: cached?.selectedTarget ?? null
      }
    }

    const response = normalizeSelectionResponse(
      (await bridge.sendToContentScript(tabId, {
        type: "GET_SEMANTIC_SELECTION_STATE"
      })) as SemanticSelectionStateResponse | null
    )

    selectionState.set(tabId, response)
    return {
      tabId,
      enabled: response.enabled,
      selectedTarget: response.selectedTarget
    }
  }

  async function clearSelection(preferredTabId?: number): Promise<SelectionStatePayload> {
    let tabId = preferredTabId ?? null
    if (tabId === null) {
      tabId = (await bridge.getActiveTab())?.id ?? null
    }

    if (tabId === null) {
      const payload = { tabId: null, enabled: false, selectedTarget: null }
      bridge.notifyRuntime({ type: "SEMANTIC_SELECTION_STATE_CHANGED", payload })
      return payload
    }

    const response = normalizeSelectionResponse(
      (await bridge.sendToContentScript(tabId, {
        type: "CLEAR_SEMANTIC_SELECTION"
      })) as SemanticSelectionStateResponse | null
    )

    selectionState.set(tabId, response)
    const payload = { tabId, enabled: response.enabled, selectedTarget: response.selectedTarget }
    bridge.notifyRuntime({ type: "SEMANTIC_SELECTION_STATE_CHANGED", payload })
    return payload
  }

  async function getRegionDump(preferredTabId?: number): Promise<SemanticRegionDumpResponse> {
    let tabId = preferredTabId ?? null
    if (tabId === null) {
      tabId = (await bridge.getActiveTab())?.id ?? null
    }

    if (tabId === null) {
      return {
        tabId: null,
        dump: null,
        error: "No active tab available for semantic region dump."
      }
    }

    const tab = await bridge.getTab(tabId)
    if (!tab || !isSemanticCaptureSupportedUrl(tab.url)) {
      return {
        tabId,
        dump: null,
        error: "Semantic region dumps are only supported on standard web pages."
      }
    }

    try {
      const response = normalizeRegionDumpResponse(
        (await bridge.sendToContentScript(tabId, {
          type: "GET_SEMANTIC_REGION_DUMP"
        })) as ContentRegionDumpResponse | null
      )

      return {
        tabId,
        dump: response.dump,
        error: response.dump ? null : "Semantic region dump unavailable on this page."
      }
    } catch (error) {
      return {
        tabId,
        dump: null,
        error: error instanceof Error ? error.message : "Semantic region dump lookup failed."
      }
    }
  }

  function syncSelectionState(
    tabId: number | null,
    response: SemanticSelectionStateResponse,
    capture?: SemanticSnapshotCaptureResponse
  ): SelectionStatePayload {
    if (tabId === null) {
      return { tabId: null, enabled: response.enabled, selectedTarget: response.selectedTarget }
    }

    selectionState.set(tabId, response)
    if (capture) {
      latestSnapshots.set(tabId, capture)

      if (capture.snapshot) {
        const existing = snapshotHistory.get(tabId) ?? []
        const nextHistory = [capture.snapshot, ...existing].slice(0, SEMANTIC_HISTORY_LIMIT)
        snapshotHistory.set(tabId, nextHistory)
        bridge.notifyRuntime({
          type: "SEMANTIC_SNAPSHOT_HISTORY_UPDATED",
          payload: buildHistoryPayload(tabId, nextHistory)
        })
      }

      bridge.notifyRuntime({
        type: "SEMANTIC_SNAPSHOT_READY",
        payload: buildReadyPayload(tabId, capture)
      })
    }

    const payload = { tabId, enabled: response.enabled, selectedTarget: response.selectedTarget }
    bridge.notifyRuntime({ type: "SEMANTIC_SELECTION_STATE_CHANGED", payload })
    return payload
  }

  return {
    captureActiveTab,
    captureForTab,
    getLatest,
    getHistory,
    toggleSelectionMode,
    getSelectionState,
    getRegionDump,
    clearSelection,
    syncSelectionState
  }
}
