import path from "node:path"
import dotenv from "dotenv"
import { BootConfigError, shutdown, validateBootConfig } from "./runtime/boot"

// apps/api 실행은 루트/패키지 경로 어디서 시작해도 동일한 .env를 읽어야 한다.
dotenv.config({
  path: path.resolve(__dirname, "..", ".env")
})

const port = Number(process.env.PORT ?? 8080)

let shuttingDown = false

function start(): void {
  try {
    validateBootConfig()
  } catch (error) {
    if (error instanceof BootConfigError) {
      // eslint-disable-next-line no-console
      console.error(`[${error.code}] ${error.message}`)
      process.exit(1)
      return
    }
    throw error
  }

  // 부트 검증 이후에만 런타임 의존 모듈을 로드해 fail-fast 계약을 보장한다.
  const { createServer, createHttpServer } = require("./server") as typeof import("./server")
  const { closePool } = require("./db/pool") as typeof import("./db/pool")

  const app = createServer()
  const server = createHttpServer(app).listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`threadatlas-api listening on :${port}`)
  })

  process.on("SIGTERM", () => {
    if (shuttingDown) {
      return
    }
    shuttingDown = true
    void shutdown(server, "SIGTERM", closePool)
  })
  process.on("SIGINT", () => {
    if (shuttingDown) {
      return
    }
    shuttingDown = true
    void shutdown(server, "SIGINT", closePool)
  })
}

start()
