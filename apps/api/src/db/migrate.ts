import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { queryDbRaw } from "./pool"

const MIGRATION_DIR_CANDIDATES = [
  path.resolve(process.cwd(), "apps/api/src/db/migrations"),
  path.resolve(process.cwd(), "src/db/migrations"),
  path.resolve(__dirname, "migrations")
]

function resolveMigrationsDir(): string | null {
  for (const candidate of MIGRATION_DIR_CANDIDATES) {
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

let migratePromise: Promise<void> | null = null

async function runMigrations(): Promise<void> {
  const migrationsDir = resolveMigrationsDir()
  if (!migrationsDir) {
    return
  }

  await queryDbRaw("select pg_advisory_lock($1)", [706034321907])
  try {
    const files = readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .sort((a, b) => a.localeCompare(b))

    for (const fileName of files) {
      const migrationPath = path.join(migrationsDir, fileName)
      const sql = readFileSync(migrationPath, "utf8")
      if (!sql.trim()) {
        continue
      }
      await queryDbRaw(sql)
    }
  } finally {
    await queryDbRaw("select pg_advisory_unlock($1)", [706034321907])
  }
}

export async function ensureDatabaseMigrations(): Promise<void> {
  if (!migratePromise) {
    migratePromise = runMigrations()
  }
  return migratePromise
}
