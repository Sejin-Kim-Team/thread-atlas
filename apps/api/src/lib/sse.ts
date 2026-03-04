import type { Response } from "express"
import type {
  EvaluateDonePayload,
  EvaluateErrorPayload,
  Projection
} from "@threadatlas/shared"

export class SseWriter {
  private closed = false

  constructor(private readonly res: Response) {
    this.res.setHeader("Content-Type", "text/event-stream")
    this.res.setHeader("Cache-Control", "no-cache")
    this.res.setHeader("Connection", "keep-alive")
    this.res.flushHeaders()
  }

  projection(projection: Projection): void {
    this.write("projection", projection)
  }

  done(payload: EvaluateDonePayload): void {
    this.write("done", payload)
  }

  error(payload: EvaluateErrorPayload): void {
    this.write("error", payload)
  }

  close(): void {
    if (this.closed) {
      return
    }
    this.closed = true
    this.res.end()
  }

  private write(event: string, data: unknown): void {
    if (this.closed) {
      return
    }
    this.res.write(`event: ${event}\n`)
    this.res.write(`data: ${JSON.stringify(data)}\n\n`)
  }
}
