import type { SemanticSelectionTarget } from "@threadatlas/shared/runtime"
import { normalizeText } from "../semantic/text"

interface OverlayHandles {
  hoverCurrent: HTMLDivElement
  hoverParent: HTMLDivElement
  hoverLabel: HTMLDivElement
  selectedCurrent: HTMLDivElement
  selectedParent: HTMLDivElement
  selectedLabel: HTMLDivElement
}

interface HighlightTarget {
  currentElement: HTMLElement
  currentKey: string
  parentElement: HTMLElement | null
  parentKey: string | null
  autoSuppressed: boolean
  selectionTarget: SemanticSelectionTarget
}

function createBox(document: Document, style: Partial<CSSStyleDeclaration>): HTMLDivElement {
  const element = document.createElement("div")
  element.setAttribute("data-threadatlas-overlay", "true")
  document.documentElement.appendChild(element)
  Object.assign(element.style, {
    position: "fixed",
    pointerEvents: "none",
    display: "none",
    transition: "all 0.05s linear"
  })
  Object.assign(element.style, style)
  return element
}

function createLabel(document: Document, style: Partial<CSSStyleDeclaration>): HTMLDivElement {
  return createBox(document, {
    padding: "2px 6px",
    borderRadius: "999px",
    color: "#f8fafc",
    fontSize: "11px",
    fontFamily: "system-ui, sans-serif",
    lineHeight: "1.4",
    width: "auto",
    height: "auto",
    ...style
  })
}

function createOverlay(document: Document): OverlayHandles {
  return {
    hoverCurrent: createBox(document, {
      zIndex: "2147483647",
      border: "1px solid rgba(59, 130, 246, 0.5)",
      background: "rgba(59, 130, 246, 0.08)"
    }),
    hoverParent: createBox(document, {
      zIndex: "2147483646",
      border: "1px solid rgba(34, 197, 94, 0.4)",
      background: "rgba(34, 197, 94, 0.06)"
    }),
    hoverLabel: createLabel(document, {
      zIndex: "2147483647",
      background: "rgba(15, 23, 42, 0.82)"
    }),
    selectedCurrent: createBox(document, {
      zIndex: "2147483645",
      border: "2px solid rgba(249, 115, 22, 0.9)",
      background: "rgba(249, 115, 22, 0.08)"
    }),
    selectedParent: createBox(document, {
      zIndex: "2147483644",
      border: "1px solid rgba(245, 158, 11, 0.55)",
      background: "rgba(245, 158, 11, 0.06)"
    }),
    selectedLabel: createLabel(document, {
      zIndex: "2147483645",
      background: "rgba(124, 45, 18, 0.92)"
    })
  }
}

function applyRect(element: HTMLElement, rect: DOMRect): void {
  if (rect.width <= 0 || rect.height <= 0) {
    element.style.display = "none"
    return
  }

  element.style.display = "block"
  element.style.top = `${rect.top}px`
  element.style.left = `${rect.left}px`
  element.style.width = `${rect.width}px`
  element.style.height = `${rect.height}px`
}

function applyLabel(element: HTMLElement, rect: DOMRect, text: string): void {
  element.textContent = text
  element.style.display = "block"
  element.style.top = `${Math.max(0, rect.top - 22)}px`
  element.style.left = `${rect.left}px`
}

function hideElements(elements: HTMLElement[]): void {
  for (const element of elements) {
    element.style.display = "none"
  }
}

function summarizeText(value: string): string {
  return normalizeText(value).slice(0, 140)
}

function applySuppressedAppearance(handles: OverlayHandles, suppressed: boolean): void {
  handles.hoverCurrent.style.opacity = suppressed ? "0.45" : "1"
  handles.hoverParent.style.opacity = suppressed ? "0.35" : "1"
  handles.hoverLabel.style.opacity = suppressed ? "0.7" : "1"
}

function resolveHighlightTarget(document: Document, leaf: Element | null): HighlightTarget | null {
  const currentElement = leaf?.closest("[data-semantic-node-id]") as HTMLElement | null
  if (!currentElement) {
    return null
  }

  const regionId = currentElement.getAttribute("data-semantic-region") ?? "semantic-region"
  const nodeId = currentElement.getAttribute("data-semantic-node-id")
  if (!nodeId) {
    return null
  }

  const primitive =
    (currentElement.getAttribute("data-semantic-primitive") as SemanticSelectionTarget["primitive"] | null) ??
    "authored-block"
  const scopeRootId = currentElement.getAttribute("data-semantic-scope-root-id")
  const parentElement =
    scopeRootId && scopeRootId !== nodeId
      ? (document.querySelector(
          `[data-semantic-region="${regionId}"][data-semantic-node-id="${scopeRootId}"]`
        ) as HTMLElement | null)
      : null
  const selectionElement =
    primitive === "interactive-block" && parentElement
      ? parentElement
      : currentElement
  const selectionNodeId =
    primitive === "interactive-block" && scopeRootId
      ? scopeRootId
      : nodeId
  const displayLabel =
    selectionElement.getAttribute("data-semantic-display-label") ??
    selectionElement.getAttribute("data-semantic-category") ??
    "Semantic item"

  return {
    currentElement,
    currentKey: `${regionId}:${nodeId}`,
    parentElement,
    parentKey: parentElement?.getAttribute("data-semantic-node-id") ?? null,
    autoSuppressed: currentElement.getAttribute("data-semantic-auto-suppressed") === "true",
    selectionTarget: {
      regionId,
      primitive,
      category:
        (selectionElement.getAttribute("data-semantic-category") as SemanticSelectionTarget["category"] | null) ??
        "content.article",
      nodeKind:
        (selectionElement.getAttribute("data-semantic-node-kind") as SemanticSelectionTarget["nodeKind"] | null) ??
        "content",
      nodeId: selectionNodeId,
      rootNodeId: scopeRootId,
      scopeRootId,
      label: displayLabel,
      displayLabel,
      text: summarizeText(
        selectionElement.getAttribute("data-semantic-text-preview") ?? selectionElement.textContent ?? ""
      ),
      ...(selectionElement.getAttribute("data-semantic-subtype")
        ? { subtype: selectionElement.getAttribute("data-semantic-subtype")! }
        : {})
    }
  }
}

export class RegionHighlighter {
  private readonly overlays: OverlayHandles
  private enabled = false
  private pendingTimer: number | null = null
  private lastPoint = { x: 0, y: 0 }
  private hasPointerPosition = false
  private lastCurrentKey: string | null = null
  private lastParentKey: string | null = null
  private selectedTarget: HighlightTarget | null = null
  private onSelect: ((target: SemanticSelectionTarget | null, element: Element | null) => void) | null = null

  constructor(
    private readonly document: Document,
    private readonly window: Window
  ) {
    this.overlays = createOverlay(document)
  }

  setSelectionHandler(handler: (target: SemanticSelectionTarget | null, element: Element | null) => void): void {
    this.onSelect = handler
  }

  enable(): boolean {
    if (this.enabled) {
      return this.enabled
    }

    this.enabled = true
    this.document.addEventListener("mousemove", this.handleMouseMove, { passive: true })
    this.document.addEventListener("click", this.handleClick, true)
    this.window.addEventListener("scroll", this.handleViewportChange, { passive: true, capture: true })
    this.window.addEventListener("resize", this.handleViewportChange)
    return this.enabled
  }

  disable(): boolean {
    if (!this.enabled) {
      return this.enabled
    }

    this.enabled = false
    this.document.removeEventListener("mousemove", this.handleMouseMove)
    this.document.removeEventListener("click", this.handleClick, true)
    this.window.removeEventListener("scroll", this.handleViewportChange, true)
    this.window.removeEventListener("resize", this.handleViewportChange)
    this.clearSelection()
    this.hideHover()
    return this.enabled
  }

  toggle(): boolean {
    return this.enabled ? this.disable() : this.enable()
  }

  isEnabled(): boolean {
    return this.enabled
  }

  getSelectedTarget(): SemanticSelectionTarget | null {
    return this.selectedTarget?.selectionTarget ?? null
  }

  clearSelection(): void {
    this.selectedTarget = null
    hideElements([
      this.overlays.selectedCurrent,
      this.overlays.selectedParent,
      this.overlays.selectedLabel
    ])
    this.onSelect?.(null, null)
  }

  dispose(): void {
    this.disable()
    for (const element of Object.values(this.overlays)) {
      element.remove()
    }
  }

  private readonly handleMouseMove = (event: MouseEvent): void => {
    if (!this.enabled) {
      return
    }

    this.lastPoint = { x: event.clientX, y: event.clientY }
    this.hasPointerPosition = true
    if (this.pendingTimer !== null) {
      return
    }

    this.pendingTimer = this.window.setTimeout(() => {
      this.pendingTimer = null
      this.updateHoverAtPoint(this.lastPoint.x, this.lastPoint.y)
    }, 50)
  }

  private readonly handleClick = (event: MouseEvent): void => {
    if (!this.enabled) {
      return
    }

    const target = resolveHighlightTarget(this.document, event.target instanceof Element ? event.target : null)
    if (!target) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    this.selectedTarget = target
    this.renderSelected(target)
    this.onSelect?.(target.selectionTarget, target.currentElement)
  }

  private readonly handleViewportChange = (): void => {
    if (!this.enabled) {
      return
    }

    if (this.selectedTarget?.currentElement?.isConnected) {
      const refreshedSelection = resolveHighlightTarget(this.document, this.selectedTarget.currentElement)
      if (refreshedSelection) {
        this.selectedTarget = refreshedSelection
        this.renderSelected(refreshedSelection)
      } else {
        this.clearSelection()
      }
    } else if (this.selectedTarget) {
      this.clearSelection()
    }

    if (this.hasPointerPosition) {
      this.updateHoverAtPoint(this.lastPoint.x, this.lastPoint.y, { force: true })
    }
  }

  private updateHoverAtPoint(x: number, y: number, options: { force?: boolean } = {}): void {
    const leaf = this.document.elementFromPoint(x, y)
    const target = resolveHighlightTarget(this.document, leaf)

    if (!options.force && target?.currentKey === this.lastCurrentKey && target?.parentKey === this.lastParentKey) {
      return
    }

    this.lastCurrentKey = target?.currentKey ?? null
    this.lastParentKey = target?.parentKey ?? null

    if (!target) {
      this.hideHover()
      return
    }

    if (target.parentElement && target.parentKey !== target.currentKey) {
      applyRect(this.overlays.hoverParent, target.parentElement.getBoundingClientRect())
    } else {
      this.overlays.hoverParent.style.display = "none"
    }

    applySuppressedAppearance(this.overlays, target.autoSuppressed)
    const rect = target.currentElement.getBoundingClientRect()
    applyRect(this.overlays.hoverCurrent, rect)
    applyLabel(this.overlays.hoverLabel, rect, target.selectionTarget.displayLabel)
  }

  private renderSelected(target: HighlightTarget): void {
    applySuppressedAppearance(this.overlays, false)
    if (target.parentElement && target.parentKey !== target.currentKey) {
      applyRect(this.overlays.selectedParent, target.parentElement.getBoundingClientRect())
    } else {
      this.overlays.selectedParent.style.display = "none"
    }

    const rect = target.currentElement.getBoundingClientRect()
    applyRect(this.overlays.selectedCurrent, rect)
    applyLabel(this.overlays.selectedLabel, rect, `selected · ${target.selectionTarget.displayLabel}`)
  }

  private hideHover(): void {
    this.lastCurrentKey = null
    this.lastParentKey = null
    hideElements([
      this.overlays.hoverCurrent,
      this.overlays.hoverParent,
      this.overlays.hoverLabel
    ])
  }
}
