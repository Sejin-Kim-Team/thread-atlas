import { Connector } from "@google-cloud/cloud-sql-connector"
import { Pool, type QueryResult, type QueryResultRow } from "pg"
import { resolveDatabaseConfig } from "./config"

const databaseConfig = resolveDatabaseConfig()

let pool: Pool | null = null
let poolPromise: Promise<Pool> | null = null
let ensureMigrationsPromise: Promise<void> | null = null
let closePoolPromise: Promise<void> | null = null
let connector: Connector | null = null

async function createPool(): Promise<Pool> {
  const config = databaseConfig

  if (config.mode === "database-url") {
    return new Pool({
      connectionString: config.databaseUrl
    })
  }

  const nextConnector = new Connector()
  const connectorOptions = await nextConnector.getOptions({
    instanceConnectionName: config.instanceConnectionName,
    authType: config.iamAuthn ? "IAM" : "PASSWORD"
  })

  connector = nextConnector
  return new Pool({
    ...connectorOptions,
    user: config.user,
    password: config.password,
    database: config.database
  })
}

export async function getPool(): Promise<Pool> {
  if (pool) {
    return pool
  }

  if (!poolPromise) {
    poolPromise = createPool()
      .then((createdPool) => {
        pool = createdPool
        return createdPool
      })
      .catch(async (error) => {
        poolPromise = null
        if (connector) {
          await Promise.resolve(connector.close())
          connector = null
        }
        throw error
      })
  }

  return poolPromise
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
  return (await getPool()).query<T>(text, values)
}

export async function closePool(): Promise<void> {
  if (!pool && !poolPromise && !connector) {
    return
  }

  if (closePoolPromise) {
    await closePoolPromise
    return
  }

  // 종료 경로에서는 pool.end를 한 번만 호출해 중복 신호에서도 안전하게 정리한다.
  closePoolPromise = (async () => {
    const target = pool ?? (await poolPromise)
    if (!target) {
      return
    }
    await target.end()
    if (connector) {
      await Promise.resolve(connector.close())
    }
  })().finally(() => {
    pool = null
    poolPromise = null
    connector = null
    ensureMigrationsPromise = null
    closePoolPromise = null
  })

  await closePoolPromise
}
