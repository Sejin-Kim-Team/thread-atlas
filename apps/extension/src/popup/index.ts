import type { SemanticSnapshot } from "@threadatlas/shared"
import type { SemanticSelectionTarget } from "@threadatlas/shared/runtime"

interface PopupSnapshotState {
  tabId: number | null
  snapshot: SemanticSnapshot | null
  error: string | null
}

interface PopupSelectionState {
  tabId: number | null
  enabled: boolean
  selectedTarget: SemanticSelectionTarget | null
}

type PopupRuntimeMessage =
  | { type: "REQUEST_SEMANTIC_SNAPSHOT"; payload?: { tabId?: number; source?: "popup" } }
  | { type: "GET_LATEST_SEMANTIC_SNAPSHOT"; payload?: { tabId?: number } }
  | { type: "TOGGLE_SEMANTIC_SELECTION"; payload?: { tabId?: number } }
  | { type: "GET_SEMANTIC_SELECTION_STATE"; payload?: { tabId?: number } }

function getElement<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null
}

export function renderPopupSnapshotState(state: PopupSnapshotState): void {
  const status = getElement<HTMLDivElement>("popup-status")
  const summary = getElement<HTMLPreElement>("popup-summary")
  if (!status || !summary) {
    return
  }

  if (state.snapshot) {
    status.textContent = "Latest semantic snapshot"
    summary.textContent = JSON.stringify(
      {
        page: state.snapshot.page.title ?? state.snapshot.page.url,
        focus: state.snapshot.focus.nodeId,
        region: state.snapshot.focus.region,
        capturedAt: state.snapshot.meta.capturedAt
      },
      null,
      2
    )
    return
  }

  status.textContent = state.error ?? "No semantic snapshot captured yet."
  summary.textContent = ""
}

export function renderPopupSelectionState(state: PopupSelectionState): void {
  const button = getElement<HTMLButtonElement>("popup-selection-button")
  const status = getElement<HTMLDivElement>("popup-status")
  if (!button || !status) {
    return
  }

  button.textContent = state.enabled ? "Selection On" : "Selection Off"
  if (state.selectedTarget) {
    const baseStatus = status.textContent?.trim() || (state.enabled ? "Selection active" : "Selection inactive")
    status.textContent = `${baseStatus} · Selected: ${state.selectedTarget.displayLabel}`
  }
}

async function sendRuntimeMessage<TResponse>(message: PopupRuntimeMessage): Promise<TResponse> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: TResponse) => {
      const runtimeError = chrome.runtime.lastError
      if (runtimeError) {
        reject(new Error(runtimeError.message))
        return
      }

      resolve(response)
    })
  })
}

async function getActiveTabId(): Promise<number | null> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  return tabs[0]?.id ?? null
}

async function refreshLatestSnapshot(): Promise<PopupSnapshotState> {
  const tabId = await getActiveTabId()
  return sendRuntimeMessage<PopupSnapshotState>(
    typeof tabId === "number"
      ? {
          type: "GET_LATEST_SEMANTIC_SNAPSHOT",
          payload: { tabId }
        }
      : {
          type: "GET_LATEST_SEMANTIC_SNAPSHOT"
        }
  )
}

async function refreshSelectionState(): Promise<PopupSelectionState> {
  const tabId = await getActiveTabId()
  return sendRuntimeMessage<PopupSelectionState>(
    typeof tabId === "number"
      ? {
          type: "GET_SEMANTIC_SELECTION_STATE",
          payload: { tabId }
        }
      : {
          type: "GET_SEMANTIC_SELECTION_STATE"
        }
  )
}

export function bindPopupActions(args: {
  onCapture: () => void
  onCopy: () => void
  onOpenSidepanel: () => void
  onToggleSelection: () => void
}): void {
  getElement<HTMLButtonElement>("popup-capture-button")?.addEventListener("click", args.onCapture)
  getElement<HTMLButtonElement>("popup-copy-button")?.addEventListener("click", args.onCopy)
  getElement<HTMLButtonElement>("popup-open-sidepanel-button")?.addEventListener("click", args.onOpenSidepanel)
  getElement<HTMLButtonElement>("popup-selection-button")?.addEventListener("click", args.onToggleSelection)
}

async function captureSnapshot(): Promise<void> {
  const tabId = await getActiveTabId()
  const state = await sendRuntimeMessage<PopupSnapshotState>(
    typeof tabId === "number"
      ? {
          type: "REQUEST_SEMANTIC_SNAPSHOT",
          payload: { tabId, source: "popup" }
        }
      : {
          type: "REQUEST_SEMANTIC_SNAPSHOT",
          payload: { source: "popup" }
        }
  )

  renderPopupSnapshotState(state)
}

async function copyLatestSnapshot(): Promise<void> {
  const latest = await refreshLatestSnapshot()
  if (!latest.snapshot) {
    renderPopupSnapshotState(latest)
    return
  }

  await navigator.clipboard.writeText(JSON.stringify(latest.snapshot, null, 2))
}

async function toggleSelection(): Promise<void> {
  const tabId = await getActiveTabId()
  const state = await sendRuntimeMessage<PopupSelectionState>(
    typeof tabId === "number"
      ? {
          type: "TOGGLE_SEMANTIC_SELECTION",
          payload: { tabId }
        }
      : {
          type: "TOGGLE_SEMANTIC_SELECTION"
        }
  )
  renderPopupSelectionState(state)
}

async function openSidepanel(): Promise<void> {
  const tabId = await getActiveTabId()
  if (typeof tabId !== "number") {
    return
  }

  await chrome.sidePanel.open({ tabId })
}

async function initializePopup(): Promise<void> {
  bindPopupActions({
    onCapture: () => {
      void captureSnapshot()
    },
    onCopy: () => {
      void copyLatestSnapshot()
    },
    onOpenSidepanel: () => {
      void openSidepanel()
    },
    onToggleSelection: () => {
      void toggleSelection()
    }
  })

  const [snapshotState, selectionState] = await Promise.all([
    refreshLatestSnapshot(),
    refreshSelectionState()
  ])
  renderPopupSnapshotState(snapshotState)
  renderPopupSelectionState(selectionState)
}

if (typeof document !== "undefined" && typeof chrome !== "undefined" && chrome.tabs && chrome.runtime) {
  void initializePopup()
}
