import { Router, type RequestHandler } from "express"
import { resolvePrincipalFromAuthorizationHeader } from "../auth/principal"
import { isEmbeddingProviderError } from "../rag/vertex-embedding-adapter"
import { createLogger } from "../runtime/logger"
import {
  ingestMemoryRecords,
  validateIngestRequest
} from "../session/memory/ingest-records"

const router: ReturnType<typeof Router> = Router()
const logger = createLogger("routes/ingest-memory")

const handleIngestMemory: RequestHandler = async (req, res) => {
  // 보안 경계: 메모리 적재는 인증 주체 기준으로만 허용한다.
  const principal = await resolvePrincipalFromAuthorizationHeader(req.header("authorization"))
  if (!principal.ok) {
    logger.warn("ingest-memory-unauthorized", {
      message: principal.message
    })
    res.status(401).json({
      code: "UNAUTHORIZED",
      message: principal.message
    })
    return
  }

  if (!validateIngestRequest(req.body)) {
    logger.warn("ingest-memory-invalid-request", {
      userId: principal.userId
    })
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
    logger.warn("ingest-memory-owner-mismatch", {
      userId: principal.userId,
      recordCount: Array.isArray(req.body.records) ? req.body.records.length : 0
    })
    res.status(403).json({
      code: "FORBIDDEN",
      message: "ownerUserId does not match principal"
    })
    return
  }

  try {
    logger.info("ingest-memory-started", {
      userId: principal.userId,
      source: typeof req.body.source === "string" ? req.body.source : "unknown",
      recordCount: Array.isArray(req.body.records) ? req.body.records.length : 0
    })
    const response = await ingestMemoryRecords(req.body, principal.userId)
    logger.info("ingest-memory-completed", {
      userId: principal.userId,
      acceptedCount: response.acceptedIds.length,
      rejectedCount: response.rejected.length
    })
    res.status(200).json(response)
  } catch (error) {
    if (isEmbeddingProviderError(error)) {
      logger.error("ingest-memory-embedding-failed", {
        userId: principal.userId,
        code: error.code,
        status: error.status,
        message: error.message
      })
      res.status(500).json({
        code: error.code,
        message: error.message
      })
      return
    }

    logger.error("ingest-memory-failed", {
      userId: principal.userId,
      error
    })
    res.status(500).json({
      code: "INGEST_MEMORY_FAILED",
      message: "ingest memory failed"
    })
  }
}

router.post("/", handleIngestMemory)

export default router
