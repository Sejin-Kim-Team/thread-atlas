export type RespondMode = "answer" | "clarify" | "suggest"

export interface FocusOptions {
  label?: string
  style?: "primary" | "secondary" | "warning"
  duration?: number
  scroll?: boolean
}

export interface FocusTarget {
  commentId: string
  label?: string
  style?: "primary" | "secondary" | "warning"
}

export interface FocusMultipleOptions {
  scrollTo?: string
  duration?: number
}

export interface NavigateOptions {
  newTab?: boolean
  activate?: boolean
}

export interface PresentItem {
  source: string
  summary: string
  url?: string
  relevance?: string
  timestamp?: string
}

export interface PresentContent {
  title: string
  items: PresentItem[]
}

export type Projection =
  | { type: "respond"; payload: { text: string; mode: RespondMode } }
  | { type: "focus"; payload: { commentId: string; options?: FocusOptions } }
  | {
      type: "focusMultiple"
      payload: { targets: FocusTarget[]; options?: FocusMultipleOptions }
    }
  | {
      type: "navigate"
      payload: { url: string; options?: NavigateOptions }
    }
  | {
      type: "present"
      payload: {
        target: "sidebar" | "overlay" | "inline"
        content: PresentContent
        options?: { persistent?: boolean }
      }
    }
  | {
      type: "notify"
      payload: { message: string; level: "status" | "info" | "success" | "error" }
    }
  | { type: "copy"; payload: { text: string } }
