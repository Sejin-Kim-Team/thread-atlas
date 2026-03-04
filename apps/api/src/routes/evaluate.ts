import { Router, type RequestHandler } from "express"
import type { EvaluateRequest } from "@threadatlas/shared"
import { runAgentLoop } from "../agent/loop"
import { SseWriter } from "../lib/sse"

const router: ReturnType<typeof Router> = Router()

const handleEvaluate: RequestHandler = async (req, res) => {
  const body = req.body as EvaluateRequest
  const writer = new SseWriter(res)

  try {
    if (!body?.stateSnapshot) {
      writer.error({ code: "INTERNAL_ERROR", message: "stateSnapshot is required" })
      return
    }

    if (body.conversationContext) {
      await runAgentLoop({
        stateSnapshot: body.stateSnapshot,
        conversationContext: body.conversationContext,
        sseWriter: writer
      })
    } else {
      await runAgentLoop({
        stateSnapshot: body.stateSnapshot,
        sseWriter: writer
      })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unexpected error"
    writer.error({
      code: "INTERNAL_ERROR",
      message
    })
  } finally {
    writer.close()
  }
}

router.post("/", handleEvaluate)

export default router
