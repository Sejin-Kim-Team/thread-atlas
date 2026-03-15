import { createChromeLocalStorage, loadExtensionConfig } from "../common/extension-config"

interface PopupState {
  showInternalConsole: boolean
  status: string
  summary: string
}

function getElement<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null
}

export function renderPopupState(state: PopupState): void {
  const status = getElement<HTMLParagraphElement>("popup-status")
  const summary = getElement<HTMLDivElement>("popup-summary")
  const internalButton = getElement<HTMLButtonElement>("popup-open-console-button")
  if (!status || !summary || !internalButton) {
    return
  }

  status.textContent = state.status
  summary.textContent = state.summary
  internalButton.classList.toggle("hidden", !state.showInternalConsole)
}

export function bindPopupActions(args: {
  onOpenSidepanel: () => void
  onOpenInternalConsole: () => void
}): void {
  getElement<HTMLButtonElement>("popup-open-sidepanel-button")?.addEventListener("click", args.onOpenSidepanel)
  getElement<HTMLButtonElement>("popup-open-console-button")?.addEventListener("click", args.onOpenInternalConsole)
}

async function getActiveTabId(): Promise<number | null> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  return tabs[0]?.id ?? null
}

async function openSidepanel(): Promise<void> {
  const tabId = await getActiveTabId()
  if (typeof tabId !== "number") {
    return
  }

  await chrome.sidePanel.open({ tabId })
}

async function openInternalConsole(): Promise<void> {
  await chrome.tabs.create({
    url: chrome.runtime.getURL("console.html"),
    active: true
  })
}

async function initializePopup(): Promise<void> {
  bindPopupActions({
    onOpenSidepanel: () => {
      void openSidepanel()
    },
    onOpenInternalConsole: () => {
      void openInternalConsole()
    }
  })

  const config = await loadExtensionConfig(createChromeLocalStorage())
  renderPopupState({
    showInternalConsole: Boolean(config.devBootstrap),
    status: "Open the assistant sidepanel to ask by voice or text.",
    summary: config.devBootstrap
      ? "Internal preview mode is available on this build."
      : "Current-page assistant is ready."
  })
}

if (typeof document !== "undefined" && typeof chrome !== "undefined" && chrome.tabs && chrome.runtime) {
  void initializePopup()
}
