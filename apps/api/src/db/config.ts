import { BootConfigError } from "../runtime/boot"

export type DbConnectionMode = "database-url" | "cloudsql-connector"

export type DatabaseUrlConfig = {
  mode: "database-url"
  databaseUrl: string
}

export type CloudSqlConnectorConfig = {
  mode: "cloudsql-connector"
  instanceConnectionName: string
  database: string
  user: string
  password?: string
  iamAuthn: boolean
}

export type DatabaseConfig = DatabaseUrlConfig | CloudSqlConnectorConfig

function normalizeEnv(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

export function resolveDbConnectionMode(): DbConnectionMode {
  const mode = normalizeEnv(process.env.DB_CONNECTION_MODE) ?? "database-url"
  if (mode === "database-url" || mode === "cloudsql-connector") {
    return mode
  }
  throw new BootConfigError("DB_CONNECTION_MODE must be database-url or cloudsql-connector")
}

export function resolveDatabaseConfig(): DatabaseConfig {
  const mode = resolveDbConnectionMode()

  if (mode === "database-url") {
    const databaseUrl = normalizeEnv(process.env.DATABASE_URL)
    if (!databaseUrl) {
      throw new BootConfigError("DATABASE_URL is required")
    }

    return {
      mode,
      databaseUrl
    }
  }

  const instanceConnectionName = normalizeEnv(process.env.CLOUD_SQL_INSTANCE_CONNECTION_NAME)
  if (!instanceConnectionName) {
    throw new BootConfigError("CLOUD_SQL_INSTANCE_CONNECTION_NAME is required")
  }

  const database = normalizeEnv(process.env.DB_NAME)
  if (!database) {
    throw new BootConfigError("DB_NAME is required")
  }

  const user = normalizeEnv(process.env.DB_USER)
  if (!user) {
    throw new BootConfigError("DB_USER is required")
  }

  const iamAuthn = normalizeEnv(process.env.DB_IAM_AUTHN) === "true"
  const password = normalizeEnv(process.env.DB_PASSWORD)

  if (!iamAuthn && !password) {
    throw new BootConfigError("DB_PASSWORD is required when DB_IAM_AUTHN is not true")
  }

  const config: CloudSqlConnectorConfig = {
    mode,
    instanceConnectionName,
    database,
    user,
    iamAuthn
  }

  if (password) {
    config.password = password
  }

  return config
}
