export interface PageTextSelectionPayload {
  hasSelection: boolean
  textPreview: string
  timestamp: number
}

function normalizeSelectionText(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

function toPreview(text: string, maxLength = 140): string {
  const normalized = normalizeSelectionText(text)
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`
}

export class PageTextSelectionBridge {
  private debounceTimer: number | null = null
  private lastSignature: string | null = null

  constructor(
    private readonly document: Document,
    private readonly window: Window,
    private readonly onSelection: (payload: PageTextSelectionPayload) => void,
    private readonly debounceMs = 120
  ) {}

  initialize(): void {
    this.document.addEventListener("selectionchange", this.handleSelectionChange)
  }

  dispose(): void {
    this.document.removeEventListener("selectionchange", this.handleSelectionChange)
    if (this.debounceTimer !== null) {
      this.window.clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
  }

  clearSelection(): void {
    const selection = this.window.getSelection()
    selection?.removeAllRanges()
    this.lastSignature = null
  }

  private readonly handleSelectionChange = (): void => {
    if (this.debounceTimer !== null) {
      this.window.clearTimeout(this.debounceTimer)
    }
    this.debounceTimer = this.window.setTimeout(() => {
      this.debounceTimer = null
      this.emitSelection()
    }, this.debounceMs)
  }

  private emitSelection(): void {
    const selection = this.window.getSelection()
    if (!selection || selection.isCollapsed) {
      this.lastSignature = null
      return
    }

    const text = normalizeSelectionText(selection.toString())
    if (!text) {
      this.lastSignature = null
      return
    }

    const signature = `${text}:${selection.anchorOffset}:${selection.focusOffset}`
    if (signature === this.lastSignature) {
      return
    }

    this.lastSignature = signature
    this.onSelection({
      hasSelection: true,
      textPreview: toPreview(text),
      timestamp: Date.now()
    })
  }
}
