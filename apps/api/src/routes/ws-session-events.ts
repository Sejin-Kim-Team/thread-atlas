import { Router, type RequestHandler } from "express"
import { resolvePrincipalFromAuthorizationHeader } from "../auth/principal"
import { RuntimeManager } from "../session/runtime/manager"

const router: ReturnType<typeof Router> = Router()
const runtime = new RuntimeManager()

const handleWsSessionEvents: RequestHandler = (req, res) => {
  const principal = resolvePrincipalFromAuthorizationHeader(req.header("authorization"))
  if (!principal.ok) {
    res.status(401).json({
      type: "error",
      payload: {
        code: "UNAUTHORIZED",
        message: principal.message
      }
    })
    return
  }

  const result = runtime.handle(req.body, { principalUserId: principal.userId })
  res.status(result.status).json(result.body)
}

router.post("/", handleWsSessionEvents)

export default router
