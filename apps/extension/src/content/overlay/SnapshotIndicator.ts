function ensureIndicatorElement(
  document: Document,
  id: string,
  styles: Record<string, string>
): HTMLDivElement {
  const existing = document.getElementById(id) as HTMLDivElement | null
  if (existing) {
    return existing
  }

  const element = document.createElement("div")
  element.id = id
  Object.assign(element.style, styles)
  document.documentElement.appendChild(element)
  return element
}

export class SnapshotIndicator {
  private readonly flashElement: HTMLDivElement
  private readonly toastElement: HTMLDivElement
  private hideTimer: number | null = null

  constructor(
    private readonly document: Document,
    private readonly window: Window
  ) {
    this.flashElement = ensureIndicatorElement(document, "threadatlas-snapshot-flash", {
      position: "fixed",
      pointerEvents: "none",
      zIndex: "2147483647",
      borderRadius: "12px",
      border: "2px solid rgba(34, 197, 94, 0.95)",
      boxShadow: "0 0 0 8px rgba(34, 197, 94, 0.18)",
      opacity: "0",
      transition: "opacity 0.2s linear",
      display: "none"
    })

    this.toastElement = ensureIndicatorElement(document, "threadatlas-snapshot-toast", {
      position: "fixed",
      top: "12px",
      right: "12px",
      pointerEvents: "none",
      zIndex: "2147483647",
      padding: "10px 12px",
      borderRadius: "10px",
      background: "rgba(15, 23, 42, 0.92)",
      color: "#f8fafc",
      fontFamily: "system-ui, sans-serif",
      fontSize: "12px",
      lineHeight: "1.5",
      opacity: "0",
      transition: "opacity 0.2s linear"
    })
  }

  showCapture(regionElement: Element | null, category: string | null, copiedToClipboard: boolean): void {
    if (regionElement) {
      const rect = regionElement.getBoundingClientRect()
      this.flashElement.style.display = "block"
      this.flashElement.style.top = `${rect.top}px`
      this.flashElement.style.left = `${rect.left}px`
      this.flashElement.style.width = `${rect.width}px`
      this.flashElement.style.height = `${rect.height}px`
      this.flashElement.style.opacity = "1"

      this.window.setTimeout(() => {
        this.flashElement.style.opacity = "0"
        this.window.setTimeout(() => {
          this.flashElement.style.display = "none"
        }, 200)
      }, 16)
    }

    this.toastElement.textContent = copiedToClipboard
      ? `Snapshot captured (${category ?? "semantic.region"}) and copied`
      : `Snapshot captured (${category ?? "semantic.region"})`
    this.toastElement.style.opacity = "1"

    if (this.hideTimer !== null) {
      this.window.clearTimeout(this.hideTimer)
    }

    this.hideTimer = this.window.setTimeout(() => {
      this.toastElement.style.opacity = "0"
      this.hideTimer = null
    }, 2000)
  }

  showMessage(message: string): void {
    this.toastElement.textContent = message
    this.toastElement.style.opacity = "1"

    if (this.hideTimer !== null) {
      this.window.clearTimeout(this.hideTimer)
    }

    this.hideTimer = this.window.setTimeout(() => {
      this.toastElement.style.opacity = "0"
      this.hideTimer = null
    }, 2000)
  }

  dispose(): void {
    this.flashElement.remove()
    this.toastElement.remove()
    if (this.hideTimer !== null) {
      this.window.clearTimeout(this.hideTimer)
      this.hideTimer = null
    }
  }
}
