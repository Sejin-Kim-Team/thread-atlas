import type {
  FocusOptions,
  FocusTarget,
  FocusMultipleOptions,
  NavigateOptions,
  PresentContent,
  Projection,
  RespondMode
} from "../types/projection"

export function respond(text: string, mode: RespondMode = "answer"): Projection {
  return { type: "respond", payload: { text, mode } }
}

export function focus(commentId: string, options?: FocusOptions): Projection {
  if (options) {
    return { type: "focus", payload: { commentId, options } }
  }
  return { type: "focus", payload: { commentId } }
}

export function focusMultiple(
  targets: FocusTarget[],
  options?: FocusMultipleOptions
): Projection {
  if (options) {
    return { type: "focusMultiple", payload: { targets, options } }
  }
  return { type: "focusMultiple", payload: { targets } }
}

export function navigate(url: string, options?: NavigateOptions): Projection {
  if (options) {
    return { type: "navigate", payload: { url, options } }
  }
  return { type: "navigate", payload: { url } }
}

export function present(
  target: "sidebar" | "overlay" | "inline",
  content: PresentContent,
  persistent = false
): Projection {
  return {
    type: "present",
    payload: {
      target,
      content,
      options: { persistent }
    }
  }
}

export function notify(
  message: string,
  level: "status" | "info" | "success" | "error" = "info"
): Projection {
  return {
    type: "notify",
    payload: { message, level }
  }
}

export function copy(text: string): Projection {
  return { type: "copy", payload: { text } }
}
