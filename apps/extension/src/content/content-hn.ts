import type {
  FocusedElement,
  PageStructure,
  Projection,
  SensorData,
  SidePanelToContentMessage,
  ThreadDoc,
  VisibleComment
} from "@threadatlas/shared"
import {
  parseThreadDocFromDocument,
  parseVisibleComments,
  selectionFromWindow
} from "./content-hn-utils"

let lastHoveredCommentId: string | null = null

function detectHNPageType(): "hn_thread" | "hn_other" {
  const url = window.location.href
  if (/news\.ycombinator\.com\/item\?id=\d+/.test(url)) {
    return "hn_thread"
  }
  return "hn_other"
}

export function parseThreadDoc(): ThreadDoc {
  return parseThreadDocFromDocument(document, window.location.href)
}

export function extractArticleUrl(): string | null {
  const titleLink = document.querySelector(".titleline a") as HTMLAnchorElement | null
  if (!titleLink) {
    return null
  }

  if (titleLink.href.includes("news.ycombinator.com")) {
    return null
  }

  return titleLink.href
}

export function getVisibleComments(): VisibleComment[] {
  const rows = Array.from(document.querySelectorAll("tr.athing.comtr"))
  return parseVisibleComments(rows, window.innerHeight, (row) => row.getBoundingClientRect())
}

export function getFocusedComment(): FocusedElement | null {
  if (!lastHoveredCommentId) {
    return null
  }

  const row = document.getElementById(lastHoveredCommentId)
  if (!row) {
    return null
  }

  return {
    commentId: lastHoveredCommentId,
    text: (row.querySelector(".commtext")?.textContent ?? "").slice(0, 150),
    source: "hover"
  }
}

export function getPageStructure(): PageStructure {
  const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6")).map((heading) => ({
    level: Number.parseInt(heading.tagName.slice(1), 10),
    text: heading.textContent?.trim() ?? ""
  }))

  const landmarks = Array.from(document.querySelectorAll("[role]")).map((element) => ({
    role: element.getAttribute("role") ?? "",
    label: element.getAttribute("aria-label") ?? ""
  }))

  const rows = Array.from(document.querySelectorAll("tr.athing.comtr"))
  const nestingDepth = rows.reduce((maxDepth, row) => {
    const raw = row.querySelector(".ind")?.getAttribute("indent")
    const depth = Number.parseInt(raw ?? "0", 10)
    return Number.isFinite(depth) ? Math.max(maxDepth, depth) : maxDepth
  }, 0)

  return {
    headings,
    landmarks,
    commentCount: rows.length,
    nestingDepth
  }
}

function clearHighlightStyles(): void {
  for (const row of document.querySelectorAll("tr.athing.comtr")) {
    row.classList.remove("ta-highlight-primary", "ta-highlight-secondary", "ta-highlight-warning", "ta-dimmed")
    row.querySelectorAll(".ta-badge").forEach((badge: Element) => badge.remove())
  }
}

function applyBadge(target: HTMLElement, label: string): void {
  const existing = target.querySelector(".ta-badge")
  if (existing) {
    existing.remove()
  }

  const badge = document.createElement("span")
  badge.className = "ta-badge"
  badge.textContent = label
  const commtext = target.querySelector(".commtext")
  commtext?.appendChild(badge)
}

function styleClass(style: "primary" | "secondary" | "warning" | undefined): string {
  switch (style) {
    case "secondary":
      return "ta-highlight-secondary"
    case "warning":
      return "ta-highlight-warning"
    default:
      return "ta-highlight-primary"
  }
}

function executeFocus(projection: Extract<Projection, { type: "focus" }>): void {
  const target = document.getElementById(projection.payload.commentId)
  if (!target) {
    return
  }

  clearHighlightStyles()
  target.classList.add(styleClass(projection.payload.options?.style))

  if (projection.payload.options?.label) {
    applyBadge(target, projection.payload.options.label)
  }

  if (projection.payload.options?.scroll !== false) {
    target.scrollIntoView({ behavior: "smooth", block: "center" })
  }
}

function executeFocusMultiple(projection: Extract<Projection, { type: "focusMultiple" }>): void {
  clearHighlightStyles()
  const allRows = Array.from(document.querySelectorAll("tr.athing.comtr"))
  const selected = new Set(projection.payload.targets.map((target) => target.commentId))

  for (const row of allRows) {
    const id = row.getAttribute("id") ?? ""
    if (!selected.has(id)) {
      row.classList.add("ta-dimmed")
    }
  }

  for (const target of projection.payload.targets) {
    const row = document.getElementById(target.commentId)
    if (!row) {
      continue
    }

    row.classList.add(styleClass(target.style))
    if (target.label) {
      applyBadge(row, target.label)
    }
  }

  const firstTarget = projection.payload.options?.scrollTo ?? projection.payload.targets[0]?.commentId
  if (firstTarget) {
    document.getElementById(firstTarget)?.scrollIntoView({ behavior: "smooth", block: "center" })
  }
}

function collectSensors(): SensorData {
  return {
    visibleComments: getVisibleComments(),
    focus: getFocusedComment(),
    selection: selectionFromWindow(window.getSelection()),
    structure: getPageStructure(),
    threadDoc: parseThreadDoc(),
    articleUrl: extractArticleUrl()
  }
}

function executeProjection(projection: Projection): void {
  switch (projection.type) {
    case "focus":
      executeFocus(projection)
      break
    case "focusMultiple":
      executeFocusMultiple(projection)
      break
    default:
      break
  }
}

function registerListeners(): void {
  document.addEventListener("mousemove", (event) => {
    const target = event.target
    if (!(target instanceof Element)) {
      return
    }

    const row = target.closest("tr.athing.comtr")
    lastHoveredCommentId = row?.getAttribute("id") ?? null
  })

  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg: SidePanelToContentMessage, _sender, sendResponse) => {
      switch (msg.type) {
        case "COLLECT_SENSORS":
          sendResponse(collectSensors())
          break
        case "GET_THREAD_DOC":
          sendResponse({
            threadDoc: parseThreadDoc(),
            articleUrl: extractArticleUrl()
          })
          break
        case "EXECUTE_PROJECTION":
          executeProjection(msg.projection)
          sendResponse({ ok: true })
          break
        default:
          sendResponse({ ok: false })
      }
      return true
    })
  }
}

if (detectHNPageType() === "hn_thread") {
  registerListeners()
}
