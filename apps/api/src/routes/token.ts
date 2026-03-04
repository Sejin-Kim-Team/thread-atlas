import { Router, type RequestHandler } from "express"
import type { TokenRequest, TokenResponse } from "@threadatlas/shared"

const router: ReturnType<typeof Router> = Router()

const handleToken: RequestHandler = (req, res) => {
  const _body = req.body as TokenRequest
  const nowSeconds = Math.floor(Date.now() / 1000)

  const response: TokenResponse = {
    token: "stub-token",
    expiresAt: nowSeconds + 600
  }

  res.status(200).json(response)
}

router.post("/", handleToken)

export default router
