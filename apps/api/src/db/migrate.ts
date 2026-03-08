import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { getPool } from "./pool"

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

  const client = await (await getPool()).connect()
  let lockAcquired = false
  try {
    await client.query("select pg_advisory_lock($1)", [706034321907])
    lockAcquired = true

    const files = readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .sort((a, b) => a.localeCompare(b))

    for (const fileName of files) {
      const migrationPath = path.join(migrationsDir, fileName)
      const sql = readFileSync(migrationPath, "utf8")
      if (!sql.trim()) {
        continue
      }
      await client.query(sql)
    }
  } finally {
    try {
      if (lockAcquired) {
        await client.query("select pg_advisory_unlock($1)", [706034321907])
      }
    } finally {
      client.release()
    }
  }
}

export async function ensureDatabaseMigrations(): Promise<void> {
  if (!migratePromise) {
    migratePromise = runMigrations().catch((error) => {
      migratePromise = null
      throw error
    })
  }
  return migratePromise
}
