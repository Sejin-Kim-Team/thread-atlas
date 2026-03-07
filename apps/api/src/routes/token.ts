import { Router, type RequestHandler } from "express"
import type { TokenRequest, TokenResponse } from "@threadatlas/shared"
import { issuePrincipalToken } from "../auth/principal"

const router: ReturnType<typeof Router> = Router()

const handleToken: RequestHandler = (req, res) => {
  const body = req.body as TokenRequest
  const issued = issuePrincipalToken(body?.userId)
  if (!issued.ok) {
    res.status(400).json({
      code: "INVALID_EVENT",
      message: issued.message
    })
    return
  }

  const response: TokenResponse = {
    token: issued.token,
    expiresAt: issued.expiresAt
  }

  res.status(200).json(response)
}

router.post("/", handleToken)

export default router
