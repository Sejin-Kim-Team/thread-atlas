import type { Pool, PoolClient } from "pg"

export type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">

// owner FK 제약을 만족하기 위해 최소 사용자 row를 보장한다.
export async function ensureOwnerUserRow(
  db: Queryable,
  ownerUserId: string
): Promise<void> {
  await db.query(
    `
      insert into users (id, display_name)
      values ($1, $2)
      on conflict (id) do nothing
    `,
    [ownerUserId, `user-${ownerUserId.slice(0, 8)}`]
  )
}

export function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

export function normalizeLimit(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback
  }
  return Math.max(1, Math.floor(value as number))
}
