import { resolveAuthSession } from "./auth-sessions-repository"

export async function resolvePrincipalFromAuthorizationHeader(
  authorizationHeader: unknown
): Promise<
  | {
      ok: true
      userId: string
    }
  | {
      ok: false
      message: string
    }
> {
  if (typeof authorizationHeader !== "string") {
    return {
      ok: false,
      message: "authorization header is required"
    }
  }

  const [scheme, token] = authorizationHeader.split(" ")
  if (scheme !== "Bearer" || !token) {
    return {
      ok: false,
      message: "invalid authorization format"
    }
  }

  let resolved: Awaited<ReturnType<typeof resolveAuthSession>>
  try {
    // 토큰 내부값 해석 대신 세션 해시 조회로 인증 주체를 복원한다.
    resolved = await resolveAuthSession(token)
  } catch (error) {
    return {
      ok: false,
      message: "token resolution failed"
    }
  }
  if (!resolved.ok) {
    return {
      ok: false,
      message: resolved.message
    }
  }

  return {
    ok: true,
    userId: resolved.userId
  }
}
