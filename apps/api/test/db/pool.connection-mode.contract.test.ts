import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const poolCtor = vi.fn<(options: Record<string, unknown>) => void>()
  const poolQuery = vi.fn()
  const poolEnd = vi.fn(async () => undefined)

  class FakePool {
    constructor(options: Record<string, unknown>) {
      poolCtor(options)
    }

    query = poolQuery
    end = poolEnd
  }

  return {
    poolCtor,
    poolQuery,
    poolEnd,
    FakePool,
    connectorGetOptions: vi.fn(async () => ({
      host: "127.0.0.1",
      port: 5432
    })),
    connectorClose: vi.fn(async () => undefined)
  }
})

vi.mock("pg", () => ({
  Pool: mocks.FakePool
}))

vi.mock("@google-cloud/cloud-sql-connector", () => ({
  Connector: class FakeConnector {
    getOptions = mocks.connectorGetOptions
    close = mocks.connectorClose
  }
}))

const ORIGINAL_ENV = { ...process.env }

function resetModeEnv(): void {
  delete process.env.DB_CONNECTION_MODE
  delete process.env.DATABASE_URL
  delete process.env.CLOUD_SQL_INSTANCE_CONNECTION_NAME
  delete process.env.DB_NAME
  delete process.env.DB_USER
  delete process.env.DB_PASSWORD
  delete process.env.DB_IAM_AUTHN
}

describe("db pool connection mode contract", () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.poolCtor.mockClear()
    mocks.poolQuery.mockClear()
    mocks.poolEnd.mockClear()
    mocks.connectorGetOptions.mockClear()
    mocks.connectorClose.mockClear()
    resetModeEnv()
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it("keeps local database-url mode regression by using DATABASE_URL connection string", async () => {
    process.env.DB_CONNECTION_MODE = "database-url"
    process.env.DATABASE_URL = "postgresql://spark:test1234@localhost:5432/thread-atlas"

    const poolModule = await import("../../src/db/pool")
    await poolModule.getPool()

    expect(mocks.poolCtor).toHaveBeenCalledTimes(1)
    expect(mocks.poolCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionString: "postgresql://spark:test1234@localhost:5432/thread-atlas"
      })
    )
  })

  it("fails fast with BOOT_CONFIG_ERROR when cloudsql-connector mode has missing required env", async () => {
    process.env.DB_CONNECTION_MODE = "cloudsql-connector"
    process.env.DATABASE_URL = "postgresql://spark:test1234@localhost:5432/thread-atlas"
    process.env.DB_USER = "spark"

    await expect(import("../../src/db/pool")).rejects.toMatchObject({
      code: "BOOT_CONFIG_ERROR"
    })
  })

  it("supports connector mode pool lifecycle and keeps pg pool interface contract", async () => {
    process.env.DB_CONNECTION_MODE = "cloudsql-connector"
    process.env.CLOUD_SQL_INSTANCE_CONNECTION_NAME = "threadatlas:us-central1:thread-atlas"
    process.env.DB_NAME = "thread-atlas"
    process.env.DB_USER = "spark"
    process.env.DB_PASSWORD = "test1234"

    const poolModule = await import("../../src/db/pool")
    mocks.poolQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ ok: true }]
    })

    await expect(poolModule.queryDbRaw("select 1")).resolves.toEqual({
      rowCount: 1,
      rows: [{ ok: true }]
    })

    await expect(poolModule.closePool()).resolves.toBeUndefined()
    await expect(poolModule.closePool()).resolves.toBeUndefined()
    expect(mocks.poolEnd).toHaveBeenCalledTimes(1)
    expect(mocks.connectorGetOptions).toHaveBeenCalledTimes(1)
    expect(mocks.connectorGetOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceConnectionName: "threadatlas:us-central1:thread-atlas",
        authType: "PASSWORD"
      })
    )
    expect(mocks.connectorClose).toHaveBeenCalledTimes(1)
  })

  it("propagates DB_IAM_AUTHN=true to connector IAM auth mode without DB_PASSWORD", async () => {
    process.env.DB_CONNECTION_MODE = "cloudsql-connector"
    process.env.CLOUD_SQL_INSTANCE_CONNECTION_NAME = "threadatlas:us-central1:thread-atlas"
    process.env.DB_NAME = "thread-atlas"
    process.env.DB_USER = "spark"
    process.env.DB_IAM_AUTHN = "true"

    const poolModule = await import("../../src/db/pool")
    await poolModule.getPool()

    expect(mocks.poolCtor).toHaveBeenCalledTimes(1)
    expect(mocks.poolCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        user: "spark",
        database: "thread-atlas"
      })
    )
    expect(mocks.poolCtor).toHaveBeenCalledWith(
      expect.not.objectContaining({
        password: expect.anything()
      })
    )
    expect(mocks.connectorGetOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceConnectionName: "threadatlas:us-central1:thread-atlas",
        authType: "IAM"
      })
    )
  })
})
