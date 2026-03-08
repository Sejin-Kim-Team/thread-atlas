import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  release: vi.fn(),
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn()
}))

vi.mock("node:fs", () => ({
  existsSync: mocks.existsSync,
  readdirSync: mocks.readdirSync,
  readFileSync: mocks.readFileSync
}))

vi.mock("../../src/db/pool", () => ({
  getPool: () => ({
    connect: mocks.connect
  })
}))

describe("database migration runner", () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.connect.mockReset()
    mocks.query.mockReset()
    mocks.release.mockReset()
    mocks.existsSync.mockReset()
    mocks.readdirSync.mockReset()
    mocks.readFileSync.mockReset()

    mocks.connect.mockResolvedValue({
      query: mocks.query,
      release: mocks.release
    })
    mocks.existsSync.mockReturnValue(true)
    mocks.readdirSync.mockReturnValue(["001_test.sql"])
    mocks.readFileSync.mockReturnValue("select 42;")
  })

  it("retries migrations after a failed attempt", async () => {
    mocks.query.mockRejectedValueOnce(new Error("transient-db-error"))
    mocks.query.mockResolvedValue({
      rowCount: 0,
      rows: []
    })

    const { ensureDatabaseMigrations } = await import("../../src/db/migrate")

    await expect(ensureDatabaseMigrations()).rejects.toThrow("transient-db-error")
    await expect(ensureDatabaseMigrations()).resolves.toBeUndefined()

    expect(mocks.connect).toHaveBeenCalledTimes(2)
    expect(mocks.release).toHaveBeenCalledTimes(2)
  })

  it("uses one client for advisory lock, SQL execution, and unlock", async () => {
    mocks.query.mockResolvedValue({
      rowCount: 0,
      rows: []
    })

    const { ensureDatabaseMigrations } = await import("../../src/db/migrate")

    await expect(ensureDatabaseMigrations()).resolves.toBeUndefined()

    expect(mocks.connect).toHaveBeenCalledTimes(1)
    expect(mocks.query).toHaveBeenNthCalledWith(1, "select pg_advisory_lock($1)", [706034321907])
    expect(mocks.query).toHaveBeenNthCalledWith(2, "select 42;")
    expect(mocks.query).toHaveBeenNthCalledWith(3, "select pg_advisory_unlock($1)", [706034321907])
    expect(mocks.release).toHaveBeenCalledTimes(1)
  })
})
