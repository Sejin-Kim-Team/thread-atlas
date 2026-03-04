import { Router, type RequestHandler } from "express"
import type {
  AnalyzeRequest,
  AnalyzeResponse,
  KeyComment,
  ThreadSemantics
} from "@threadatlas/shared"

const router: ReturnType<typeof Router> = Router()

const handleAnalyze: RequestHandler = (req, res) => {
  const body = req.body as AnalyzeRequest
  const comments = body.threadDoc.comments.slice(0, 3)

  const claims = comments.map((comment, idx) => ({
    id: `claim_${idx + 1}`,
    statement: comment.text.slice(0, 120) || `Claim derived from comment ${comment.id}`,
    stance: "neutral" as const,
    evidence: [comment.text.slice(0, 80)],
    supportingComments: [comment.id],
    counters: []
  }))

  const keyComments: KeyComment[] = comments.map((comment, idx) => ({
    commentId: comment.id,
    role: idx === 0 ? "defines_argument" : idx === 1 ? "provides_evidence" : "summarizes",
    claimId: `claim_${idx + 1}`
  }))

  const semantics: ThreadSemantics = {
    topic: body.threadDoc.title || "Untitled thread",
    claims,
    keyComments,
    generatedAt: Date.now()
  }

  const response: AnalyzeResponse = {
    threadSemantics: semantics,
    cached: false
  }

  res.status(200).json(response)
}

router.post("/", handleAnalyze)

export default router
