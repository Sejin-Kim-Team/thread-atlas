import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import { ensureDatabaseMigrations } from "../db/migrate"
import { getPool } from "../db/pool"
import {
  INSERT_GOOGLE_IDENTITY_SQL,
  INSERT_USER_FOR_GOOGLE_IDENTITY_SQL,
  LOCK_GOOGLE_IDENTITY_SUBJECT_SQL,
  SELECT_EXISTING_GOOGLE_IDENTITY_SQL,
  UPDATE_GOOGLE_IDENTITY_SQL,
  UPDATE_USER_FROM_GOOGLE_IDENTITY_SQL
} from "./user-identities-repository.queries"

interface GoogleIdentityProfileInput {
  displayName?: string
  primaryEmail?: string
  avatarUrl?: string
}

export interface UpsertGoogleIdentityInput {
  providerSubject: string
  email?: string
  emailVerified?: boolean
  profile?: GoogleIdentityProfileInput
  rawClaims?: Record<string, unknown>
}

export interface UpsertGoogleIdentityResult {
  userId: string
  provider: "google"
  providerSubject: string
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function assertProviderSubject(value: unknown): string {
  const providerSubject = normalizeOptionalText(value)
  if (!providerSubject) {
    throw new Error("provider subject is required")
  }
  return providerSubject
}

async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const pool = getPool()
  const client = await pool.connect()
  try {
    // 사용자와 아이덴티티 업데이트를 동일 트랜잭션으로 보장한다.
    await client.query("begin")
    const result = await fn(client)
    await client.query("commit")
    return result
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}

export async function upsertGoogleIdentity(
  input: UpsertGoogleIdentityInput
): Promise<UpsertGoogleIdentityResult> {
  await ensureDatabaseMigrations()

  const providerSubject = assertProviderSubject(input.providerSubject)
  const email = normalizeOptionalText(input.email ?? input.profile?.primaryEmail)
  const displayName = normalizeOptionalText(input.profile?.displayName)
  const avatarUrl = normalizeOptionalText(input.profile?.avatarUrl)
  const emailVerified = input.emailVerified ?? false
  const rawClaims = input.rawClaims ?? { sub: providerSubject }

  return withTransaction(async (client) => {
    // 동일 Google sub 로그인은 한 트랜잭션씩만 처리해 중복 바인딩 경쟁 조건을 막는다.
    await client.query(LOCK_GOOGLE_IDENTITY_SUBJECT_SQL, [`google:${providerSubject}`])

    // 제공자와 주체 식별자 조합이 이미 연결된 사용자가 있는지 먼저 확인한다.
    const existingIdentity = await client.query<{ user_id: string }>(
      SELECT_EXISTING_GOOGLE_IDENTITY_SQL,
      [providerSubject]
    )

    let userId = existingIdentity.rows[0]?.user_id
    if (!userId) {
      userId = randomUUID()
      await client.query(INSERT_USER_FOR_GOOGLE_IDENTITY_SQL, [
        userId,
        displayName,
        email,
        avatarUrl
      ])

      await client.query(INSERT_GOOGLE_IDENTITY_SQL, [
        randomUUID(),
        userId,
        providerSubject,
        email,
        emailVerified,
        JSON.stringify(rawClaims)
      ])
    } else {
      await client.query(UPDATE_USER_FROM_GOOGLE_IDENTITY_SQL, [
        userId,
        displayName,
        email,
        avatarUrl
      ])

      await client.query(UPDATE_GOOGLE_IDENTITY_SQL, [
        providerSubject,
        email,
        input.emailVerified,
        JSON.stringify(rawClaims)
      ])
    }

    return {
      userId,
      provider: "google",
      providerSubject
    }
  })
}
