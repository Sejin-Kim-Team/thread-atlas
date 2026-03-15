import { beforeEach, describe, expect, it, vi } from "vitest"
import { bindPopupActions, renderPopupState } from "../src/popup/index"

describe("popup ui", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <p id="popup-status"></p>
      <div id="popup-summary"></div>
      <button id="popup-open-sidepanel-button" type="button">Open Assistant</button>
      <button id="popup-open-console-button" class="hidden" type="button">Open Internal Console</button>
    `
  })

  it("renders consumer popup copy and dev-only console launcher", () => {
    renderPopupState({
      showInternalConsole: false,
      status: "Open the assistant sidepanel to ask by voice or text.",
      summary: "Current-page assistant is ready."
    })

    expect(document.getElementById("popup-status")?.textContent).toContain("assistant sidepanel")
    expect(document.getElementById("popup-summary")?.textContent).toContain("Current-page assistant")
    expect(document.getElementById("popup-open-console-button")?.classList.contains("hidden")).toBe(true)

    renderPopupState({
      showInternalConsole: true,
      status: "Open the assistant sidepanel to ask by voice or text.",
      summary: "Internal preview mode is available on this build."
    })

    expect(document.getElementById("popup-open-console-button")?.classList.contains("hidden")).toBe(false)
  })

  it("binds assistant and internal console actions", () => {
    const onOpenSidepanel = vi.fn()
    const onOpenInternalConsole = vi.fn()

    bindPopupActions({
      onOpenSidepanel,
      onOpenInternalConsole
    })

    ;(document.getElementById("popup-open-sidepanel-button") as HTMLButtonElement).click()
    ;(document.getElementById("popup-open-console-button") as HTMLButtonElement).click()

    expect(onOpenSidepanel).toHaveBeenCalledTimes(1)
    expect(onOpenInternalConsole).toHaveBeenCalledTimes(1)
  })
})
