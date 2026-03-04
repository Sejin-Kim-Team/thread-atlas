import type { Projection } from "@threadatlas/shared"

export interface ProjectionHandlers {
  respond: (payload: Extract<Projection, { type: "respond" }>["payload"]) => void
  focus: (projection: Extract<Projection, { type: "focus" | "focusMultiple" }>) => void
  navigate: (payload: Extract<Projection, { type: "navigate" }>["payload"]) => void
  present: (payload: Extract<Projection, { type: "present" }>["payload"]) => void
  notify: (payload: Extract<Projection, { type: "notify" }>["payload"]) => void
  copy: (payload: Extract<Projection, { type: "copy" }>["payload"]) => void
}

export function routeProjection(projection: Projection, handlers: ProjectionHandlers): void {
  switch (projection.type) {
    case "respond":
      handlers.respond(projection.payload)
      return
    case "focus":
    case "focusMultiple":
      handlers.focus(projection)
      return
    case "navigate":
      handlers.navigate(projection.payload)
      return
    case "present":
      handlers.present(projection.payload)
      return
    case "notify":
      handlers.notify(projection.payload)
      return
    case "copy":
      handlers.copy(projection.payload)
      return
    default:
      return
  }
}
