import type { CaptureSource, ResolveFocusInput } from "@threadatlas/shared/browser-runtime"

export class BrowserCapture {
  private lastHoveredElement: Element | null = null
  private contextMenuTarget: Element | null = null
  private selectedElement: Element | null = null

  constructor(
    private readonly document: Document,
    private readonly window: Window
  ) {}

  initialize(): void {
    this.document.addEventListener("mousemove", this.handleMouseMove, { passive: true })
    this.document.addEventListener("contextmenu", this.handleContextMenu)
  }

  dispose(): void {
    this.document.removeEventListener("mousemove", this.handleMouseMove)
    this.document.removeEventListener("contextmenu", this.handleContextMenu)
  }

  setSelectedElement(element: Element | null): void {
    this.selectedElement = element
  }

  clearSelectedElement(): void {
    this.selectedElement = null
  }

  buildResolveFocusInput(source: CaptureSource): ResolveFocusInput {
    return {
      source,
      scopeKind: this.selectedElement ? "selection" : "page",
      activeElement: this.selectedElement ?? this.document.activeElement,
      selection: this.window.getSelection(),
      triggerTarget:
        source === "context-menu"
          ? this.contextMenuTarget ??
            this.selectedElement ??
            this.lastHoveredElement ??
            this.document.activeElement
          : this.selectedElement ?? this.lastHoveredElement ?? this.document.activeElement,
      selectedElement: this.selectedElement,
      lastHoveredElement: this.lastHoveredElement
    }
  }

  private readonly handleMouseMove = (event: MouseEvent): void => {
    const target = event.target
    if (!(target instanceof Element)) {
      return
    }

    this.lastHoveredElement = target
  }

  private readonly handleContextMenu = (event: MouseEvent): void => {
    const target = event.target
    this.contextMenuTarget = target instanceof Element ? target : null
  }
}
