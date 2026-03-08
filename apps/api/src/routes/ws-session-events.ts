import { Router, type RequestHandler } from "express"
import { resolvePrincipalFromAuthorizationHeader } from "../auth/principal"
import { RuntimeManager } from "../session/runtime/manager"

export function createWsSessionEventsRouter(
  runtime: RuntimeManager = new RuntimeManager()
): ReturnType<typeof Router> {
  const router: ReturnType<typeof Router> = Router()

  const handleWsSessionEvents: RequestHandler = async (req, res) => {
    // 보안 경계: 이벤트 입력은 인증 주체를 검증한 뒤에만 런타임으로 전달한다.
    const principal = await resolvePrincipalFromAuthorizationHeader(req.header("authorization"))
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

    const result = await runtime.handle(req.body, { principalUserId: principal.userId })
    res.status(result.status).json(result.body)
  }

  router.post("/", handleWsSessionEvents)
  return router
}

export default createWsSessionEventsRouter
