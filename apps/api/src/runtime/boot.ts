import { resolveDatabaseConfig } from "../db/config"

type ShutdownOptions = {
  timeoutMs?: number
  exit?: (code: number) => void
  logger?: Pick<typeof console, "log" | "error">
}

export class BootConfigError extends Error {
  readonly code = "BOOT_CONFIG_ERROR"
}

export function validateBootConfig(): void {
  resolveDatabaseConfig()
}

export async function shutdown(
  server: import("http").Server,
  signal: NodeJS.Signals,
  closePoolFn: () => Promise<void>,
  options: ShutdownOptions = {}
): Promise<void> {
  const logger = options.logger ?? console
  const exit = options.exit ?? ((code: number) => process.exit(code))

  // Cloud Run 종료 시그널 수신 후에는 신규 요청 수락을 중지하고 리소스를 정리한다.
  logger.log(`received ${signal}, starting graceful shutdown`)

  const closeServer = new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })

  const timeoutMs = options.timeoutMs ?? 15_000
  const withTimeout = new Promise<void>((_, reject) => {
    setTimeout(() => reject(new Error("GRACEFUL_SHUTDOWN_TIMEOUT")), timeoutMs)
  })

  try {
    await Promise.race([Promise.all([closeServer, closePoolFn()]).then(() => undefined), withTimeout])
    logger.log("graceful shutdown complete")
    exit(0)
  } catch (error) {
    logger.error("graceful shutdown failed", error)
    exit(1)
  }
}
