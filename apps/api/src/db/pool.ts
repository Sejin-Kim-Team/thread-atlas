import { Pool, type QueryResult, type QueryResultRow } from "pg"

const configuredDatabaseUrl = process.env.DATABASE_URL?.trim()
if (!configuredDatabaseUrl) {
  // 보안 경계: 기본 자격정보 대체값 없이 환경변수로만 DB 접속을 허용한다.
  throw new Error("DATABASE_URL is required")
}
const DATABASE_URL: string = configuredDatabaseUrl

let pool: Pool | null = null
let ensureMigrationsPromise: Promise<void> | null = null
let closePoolPromise: Promise<void> | null = null

function getDatabaseUrl(): string {
  return DATABASE_URL
}

export function getPool(): Pool {
  if (pool) {
    return pool
  }

  pool = new Pool({
    connectionString: getDatabaseUrl()
  })
  return pool
}

export async function queryDb<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[]
): Promise<QueryResult<T>> {
  if (!ensureMigrationsPromise) {
    // queryDb 호출 지점에서는 스키마 선행 적용을 1회 보장한다.
    ensureMigrationsPromise = import("./migrate")
      .then(({ ensureDatabaseMigrations }) => ensureDatabaseMigrations())
      .catch((error) => {
        ensureMigrationsPromise = null
        throw error
      })
  }
  await ensureMigrationsPromise
  return queryDbRaw<T>(text, values)
}

export async function queryDbRaw<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[]
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, values)
}

export async function closePool(): Promise<void> {
  if (!pool) {
    return
  }

  if (closePoolPromise) {
    await closePoolPromise
    return
  }

  // 종료 경로에서는 pool.end를 한 번만 호출해 중복 신호에서도 안전하게 정리한다.
  const target = pool
  closePoolPromise = target.end().finally(() => {
    pool = null
    ensureMigrationsPromise = null
    closePoolPromise = null
  })

  await closePoolPromise
}
