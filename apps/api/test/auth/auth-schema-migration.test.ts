import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function readSqlFile(fileName: string): string {
  const candidates = [
    path.resolve(process.cwd(), "apps/api/src/db/migrations", fileName),
    path.resolve(process.cwd(), "src/db/migrations", fileName)
  ]
  const migrationPath = candidates.find((candidate) => existsSync(candidate))
  expect(Boolean(migrationPath)).toBe(true)
  return readFileSync(migrationPath as string, "utf8")
}

describe("auth schema migration contract (red)", () => {
  it("contains users, user_identities, auth_sessions tables", () => {
    const sql = readSqlFile("001_auth_core.sql")

    expect(sql).toContain("create table if not exists users")
    expect(sql).toContain("create table if not exists user_identities")
    expect(sql).toContain("create table if not exists auth_sessions")
  })

  it("stores auth session token as hash only", () => {
    const sql = readSqlFile("001_auth_core.sql")

    expect(sql).toContain("session_token_hash")
    expect(sql).not.toContain("session_token text")
  })

  it("enforces memory owner foreign key to local users.id", () => {
    const sql = readSqlFile("002_memory_owner_fk.sql")

    expect(sql).toContain("owner_user_id uuid")
    expect(sql).toMatch(/references\s+users\s*\(id\)/i)
  })
})
