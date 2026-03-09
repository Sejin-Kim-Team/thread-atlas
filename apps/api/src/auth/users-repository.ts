import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import { ensureDatabaseMigrations } from "../db/migrate"
import { getPool } from "../db/pool"
import {
  FIND_USER_BY_ID_SQL,
  INSERT_BOOTSTRAP_IDENTITY_SQL,
  INSERT_USER_FROM_BOOTSTRAP_SQL,
  RESOLVE_USER_FROM_BOOTSTRAP_SUBJECT_SQL,
  SELECT_EXISTING_BOOTSTRAP_IDENTITY_SQL,
  UPDATE_BOOTSTRAP_IDENTITY_SQL,
  UPDATE_USER_FROM_BOOTSTRAP_PROFILE_SQL
} from "./users-repository.queries"

interface UserProfileInput {
  displayName?: string
  primaryEmail?: string
  avatarUrl?: string
}

export interface LocalUser {
  id: string
  displayName?: string
  primaryEmail?: string
  avatarUrl?: string
  createdAt: string
}

export interface UpsertUserFromBootstrapSubjectInput {
  bootstrapSubject: string
  profile?: UserProfileInput
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function assertBootstrapSubject(value: unknown): string {
  const subject = normalizeOptionalText(value)
  if (!subject) {
    throw new Error("bootstrap provider subject is required")
  }
  return subject
}

function toLocalUser(row: {
  id: string
  display_name: string | null
  primary_email: string | null
  avatar_url: string | null
  created_at: Date | string
}): LocalUser {
  const user: LocalUser = {
    id: row.id,
    createdAt: new Date(row.created_at).toISOString()
  }

  if (row.display_name) {
    user.displayName = row.display_name
  }
  if (row.primary_email) {
    user.primaryEmail = row.primary_email
  }
  if (row.avatar_url) {
    user.avatarUrl = row.avatar_url
  }

  return user
}

async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const pool = await getPool()
  const client = await pool.connect()
  try {
    // 사용자/아이덴티티 동기화는 원자적으로 처리해야 하므로 트랜잭션으로 묶는다.
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

export async function findUserById(userId: string): Promise<LocalUser | null> {
  await ensureDatabaseMigrations()

  const normalizedUserId = normalizeOptionalText(userId)
  if (!normalizedUserId) {
    return null
  }

  const result = await (await getPool()).query<{
    id: string
    display_name: string | null
    primary_email: string | null
    avatar_url: string | null
    created_at: Date | string
  }>(FIND_USER_BY_ID_SQL, [normalizedUserId])

  if (result.rows.length === 0) {
    return null
  }

  const row = result.rows[0]
  if (!row) {
    return null
  }
  return toLocalUser(row)
}

export async function upsertUserFromBootstrapSubject(
  input: UpsertUserFromBootstrapSubjectInput
): Promise<LocalUser> {
  await ensureDatabaseMigrations()

  const bootstrapSubject = assertBootstrapSubject(input.bootstrapSubject)
  const displayName = normalizeOptionalText(input.profile?.displayName)
  const primaryEmail = normalizeOptionalText(input.profile?.primaryEmail)
  const avatarUrl = normalizeOptionalText(input.profile?.avatarUrl)

  return withTransaction(async (client) => {
    // 부트스트랩 주체를 먼저 조회해 기존 로컬 사용자와 연결 여부를 판단한다.
    const existingIdentity = await client.query<{ user_id: string }>(
      SELECT_EXISTING_BOOTSTRAP_IDENTITY_SQL,
      [bootstrapSubject]
    )

    if (existingIdentity.rows.length > 0) {
      const existing = existingIdentity.rows[0]
      if (!existing) {
        throw new Error("failed to resolve existing identity binding")
      }
      const userId = existing.user_id
      await client.query(UPDATE_USER_FROM_BOOTSTRAP_PROFILE_SQL, [
        userId,
        displayName,
        primaryEmail,
        avatarUrl
      ])
      await client.query(UPDATE_BOOTSTRAP_IDENTITY_SQL, [bootstrapSubject, primaryEmail])
    } else {
      const userId = randomUUID()
      await client.query(INSERT_USER_FROM_BOOTSTRAP_SQL, [
        userId,
        displayName,
        primaryEmail,
        avatarUrl
      ])

      await client.query(INSERT_BOOTSTRAP_IDENTITY_SQL, [
        randomUUID(),
        userId,
        bootstrapSubject,
        primaryEmail,
        JSON.stringify({ bootstrapSubject })
      ])
    }

    // 최종 반환은 조인 조회 결과를 기준으로 표준 로컬 사용자 형태로 정규화한다.
    const resolved = await client.query<{
      id: string
      display_name: string | null
      primary_email: string | null
      avatar_url: string | null
      created_at: Date | string
    }>(RESOLVE_USER_FROM_BOOTSTRAP_SUBJECT_SQL, [bootstrapSubject])

    if (resolved.rows.length === 0) {
      throw new Error("failed to resolve local user binding")
    }

    const row = resolved.rows[0]
    if (!row) {
      throw new Error("failed to resolve local user binding")
    }

    return toLocalUser(row)
  })
}
