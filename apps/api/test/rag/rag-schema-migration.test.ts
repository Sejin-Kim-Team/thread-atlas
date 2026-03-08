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

describe("rag schema migration contract (red)", () => {
  it("creates memory_records, memory_record_embeddings, analysis_runs tables", () => {
    const sql = readSqlFile("003_rag_core.sql")

    expect(sql).toContain("create table if not exists memory_records")
    expect(sql).toContain("create table if not exists memory_record_embeddings")
    expect(sql).toContain("create table if not exists analysis_runs")
  })

  it("creates required owner/kind/vector indexes", () => {
    const sql = readSqlFile("003_rag_core.sql")

    expect(sql).toContain("idx_memory_records_owner_created")
    expect(sql).toContain("idx_memory_records_owner_kind")
    expect(sql).toContain("idx_memory_record_embeddings_vector")
    expect(sql).toContain("idx_analysis_runs_owner_created")
  })

  it("enforces owner isolation with users(id) foreign key", () => {
    const sql = readSqlFile("003_rag_core.sql")

    expect(sql).toMatch(/memory_records[\s\S]*owner_user_id uuid not null references users\(id\)/i)
    expect(sql).toMatch(/memory_record_embeddings[\s\S]*owner_user_id uuid not null references users\(id\)/i)
    expect(sql).toMatch(/analysis_runs[\s\S]*owner_user_id uuid not null references users\(id\)/i)
  })

  it("keeps embedding rows tied to canonical memory records", () => {
    const sql = readSqlFile("003_rag_core.sql")

    expect(sql).toMatch(/record_id text primary key references memory_records\(id\) on delete cascade/i)
    expect(sql).toMatch(/delete from memory_record_embeddings[\s\S]*where not exists/i)
    expect(sql).toMatch(/foreign key \(record_id\) references memory_records\(id\) on delete cascade/i)
  })
})
