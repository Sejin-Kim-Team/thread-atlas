export function requireEnv(name: "AUTH_BOOTSTRAP_KEY" | "DATABASE_URL"): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} must be set for test execution`)
  }
  return value
}
