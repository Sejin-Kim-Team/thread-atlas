import crypto, { randomUUID } from "node:crypto"
import { ensureDatabaseMigrations } from "../db/migrate"
import { getPool } from "../db/pool"
import {
  INSERT_AUTH_SESSION_SQL,
  REVOKE_AUTH_SESSION_SQL,
  SELECT_ACTIVE_AUTH_SESSION_SQL,
  UPDATE_AUTH_SESSION_LAST_SEEN_SQL,
  UPSERT_USER_LAST_LOGIN_SQL
} from "./auth-sessions-repository.queries"

const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24

function resolveSessionTtlSeconds(): number {
  const parsed = Number(process.env.AUTH_SESSION_TTL_SECONDS ?? "")
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed)
  }
  return DEFAULT_SESSION_TTL_SECONDS
}

function now(): Date {
  return new Date()
}

function hashSessionToken(token: string): string {
  // 원문 토큰 저장을 피하기 위해 해시값만 DB에 보관한다.
  return crypto.createHash("sha256").update(token).digest("hex")
}

function generateOpaqueToken(): string {
  // 앱 세션 토큰은 내부 정보 노출이 없는 불투명 토큰으로 발급한다.
  return crypto.randomBytes(32).toString("base64url")
}

function toIso(input: Date | string): string {
  return new Date(input).toISOString()
}

export interface IssueAuthSessionInput {
  userId: string
  clientKind?: string
  userAgent?: string
}

export interface IssueAuthSessionResult {
  token: string
  expiresAt: string
  sessionId: string
}

export type ResolveAuthSessionResult =
  | {
      ok: true
      userId: string
      sessionId: string
      expiresAt: string
    }
  | {
      ok: false
      message: string
    }

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

export async function issueAuthSession(
  input: IssueAuthSessionInput
): Promise<IssueAuthSessionResult> {
  await ensureDatabaseMigrations()

  const userId = normalizeText(input.userId)
  if (!userId) {
    throw new Error("userId is required")
  }

  const issuedAt = now()
  const expiresAt = new Date(issuedAt.getTime() + resolveSessionTtlSeconds() * 1000)
  const token = generateOpaqueToken()
  const sessionTokenHash = hashSessionToken(token)
  const sessionId = randomUUID()

  const pool = getPool()
  // 세션 발급 전 사용자 로그인 시각을 갱신해 소유권 추적 기준을 유지한다.
  await pool.query(UPSERT_USER_LAST_LOGIN_SQL, [userId])

  await pool.query(INSERT_AUTH_SESSION_SQL, [
    sessionId,
    userId,
    sessionTokenHash,
    issuedAt.toISOString(),
    expiresAt.toISOString(),
    normalizeText(input.clientKind) ?? "extension",
    normalizeText(input.userAgent)
  ])

  return {
    token,
    expiresAt: expiresAt.toISOString(),
    sessionId
  }
}

export async function resolveAuthSession(token: string): Promise<ResolveAuthSessionResult> {
  await ensureDatabaseMigrations()

  const normalizedToken = normalizeText(token)
  if (!normalizedToken) {
    return {
      ok: false,
      message: "invalid token"
    }
  }

  const sessionTokenHash = hashSessionToken(normalizedToken)
  const pool = getPool()
  const result = await pool.query<{
    id: string
    user_id: string
    expires_at: Date | string
  }>(SELECT_ACTIVE_AUTH_SESSION_SQL, [sessionTokenHash])

  if (result.rows.length === 0) {
    return {
      ok: false,
      message: "invalid token"
    }
  }

  const row = result.rows[0]
  if (!row) {
    return {
      ok: false,
      message: "invalid token"
    }
  }
  await pool.query(UPDATE_AUTH_SESSION_LAST_SEEN_SQL, [row.id])

  return {
    ok: true,
    userId: row.user_id,
    sessionId: row.id,
    expiresAt: toIso(row.expires_at)
  }
}

export async function revokeAuthSession(sessionId: string): Promise<void> {
  await ensureDatabaseMigrations()

  const normalizedSessionId = normalizeText(sessionId)
  if (!normalizedSessionId) {
    return
  }

  // 세션 폐기는 복구 불가한 보안 상태 전이이므로 폐기 시각만 갱신한다.
  await getPool().query(REVOKE_AUTH_SESSION_SQL, [normalizedSessionId])
}
