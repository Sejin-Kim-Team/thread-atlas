import { Router, type RequestHandler } from "express"
import { resolvePrincipalFromAuthorizationHeader } from "../auth/principal"
import {
  ingestMemoryRecords,
  validateIngestRequest
} from "../session/memory/ingest-records"

const router: ReturnType<typeof Router> = Router()

const handleIngestMemory: RequestHandler = (req, res) => {
  const principal = resolvePrincipalFromAuthorizationHeader(req.header("authorization"))
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
    res.status(403).json({
      code: "FORBIDDEN",
      message: "ownerUserId does not match principal"
    })
    return
  }

  const response = ingestMemoryRecords(req.body, principal.userId)
  res.status(200).json(response)
}

router.post("/", handleIngestMemory)

export default router
