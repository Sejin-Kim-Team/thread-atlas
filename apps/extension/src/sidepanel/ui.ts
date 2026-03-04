import type { PresentContent } from "@threadatlas/shared"

export type Phase = "initializing" | "ready" | "conversing" | "dormant" | "error"

const PHASE_COLORS: Record<Phase, string> = {
  initializing: "#eab308",
  ready: "#16a34a",
  conversing: "#2563eb",
  dormant: "#64748b",
  error: "#dc2626"
}

const PHASE_LABELS: Record<Phase, string> = {
  initializing: "analyzing",
  ready: "ready",
  conversing: "conversing",
  dormant: "dormant",
  error: "error"
}

export function updatePhaseIndicator(phase: Phase): void {
  const dot = document.getElementById("status-dot")
  const label = document.getElementById("status-label")
  if (!dot || !label) {
    return
  }

  dot.style.background = PHASE_COLORS[phase]
  label.textContent = PHASE_LABELS[phase]
}

export function renderPresent(content: PresentContent): void {
  const root = document.getElementById("present-root")
  if (!root) {
    return
  }

  root.innerHTML = ""
  const title = document.createElement("h3")
  title.textContent = content.title
  title.style.margin = "0 0 8px"
  title.style.fontSize = "14px"
  root.appendChild(title)

  const list = document.createElement("ul")
  list.style.margin = "0"
  list.style.paddingLeft = "16px"

  for (const item of content.items) {
    const li = document.createElement("li")
    li.textContent = `${item.source}: ${item.summary}`
    list.appendChild(li)
  }
  root.appendChild(list)
}

export function showNotify(message: string, _level: "status" | "info" | "success" | "error"): void {
  const root = document.getElementById("notify-root")
  if (!root) {
    return
  }

  root.textContent = message
  root.style.display = "block"

  window.setTimeout(() => {
    root.style.display = "none"
  }, 3000)
}

export function showSuggestChips(
  options: string[],
  onSelect: (value: string) => void
): void {
  const root = document.getElementById("suggest-root")
  if (!root) {
    return
  }

  root.innerHTML = ""

  for (const option of options) {
    const button = document.createElement("button")
    button.className = "chip"
    button.textContent = option
    button.type = "button"
    button.addEventListener("click", () => onSelect(option))
    root.appendChild(button)
  }
}
