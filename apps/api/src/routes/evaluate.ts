import { Router, type RequestHandler } from "express"
import type { EvaluateRequest } from "@threadatlas/shared"
import { runAgentLoop } from "../agent/loop"
import { SseWriter } from "../lib/sse"

const router: ReturnType<typeof Router> = Router()

const handleEvaluate: RequestHandler = async (req, res) => {
  // FE 마이그레이션이 끝날 때까지 유지하는 legacy 호환 경로다.
  // 해커톤 이후 canonical runtime 은 `/ws/runtime` 이며, 이 경로에는 신규 기능을 추가하지 않는다.
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
