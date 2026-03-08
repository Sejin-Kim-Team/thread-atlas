import { Router, type RequestHandler } from "express"
import { resolvePrincipalFromAuthorizationHeader } from "../auth/principal"
import { isEmbeddingProviderError } from "../rag/vertex-embedding-adapter"
import {
  ingestMemoryRecords,
  validateIngestRequest
} from "../session/memory/ingest-records"

const router: ReturnType<typeof Router> = Router()

const handleIngestMemory: RequestHandler = async (req, res) => {
  // 보안 경계: 메모리 적재는 인증 주체 기준으로만 허용한다.
  const principal = await resolvePrincipalFromAuthorizationHeader(req.header("authorization"))
  if (!principal.ok) {
    res.status(401).json({
      code: "UNAUTHORIZED",
      message: principal.message
    })
    return
  }

  if (!validateIngestRequest(req.body)) {
    res.status(400).json({
      code: "INVALID_RECORD",
      message: "invalid ingest memory request"
    })
    return
  }

  const hasOwnerMismatch = req.body.records.some(
    (record: { ownerUserId?: string }) =>
      typeof record.ownerUserId === "string" && record.ownerUserId !== principal.userId
  )
  if (hasOwnerMismatch) {
    // 소유권 불일치 레코드는 인증 주체 경계를 넘는 쓰기이므로 즉시 거부한다.
    res.status(403).json({
      code: "FORBIDDEN",
      message: "ownerUserId does not match principal"
    })
    return
  }

  try {
    const response = await ingestMemoryRecords(req.body, principal.userId)
    res.status(200).json(response)
  } catch (error) {
    if (isEmbeddingProviderError(error)) {
      res.status(500).json({
        code: error.code,
        message: error.message
      })
      return
    }

    res.status(500).json({
      code: "INGEST_MEMORY_FAILED",
      message: "ingest memory failed"
    })
  }
}

router.post("/", handleIngestMemory)

export default router
