import { spawn } from "node:child_process"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { requireEnv } from "../helpers/env"

type ChildResult = {
  code: number | null
  signal: NodeJS.Signals | null
  output: string
}

function runApiIndex(env: Record<string, string>, timeoutMs: number): Promise<ChildResult> {
  const cwd = path.resolve(__dirname, "..", "..")
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
      cwd,
      env: {
        ...process.env,
        ...env
      },
      stdio: ["ignore", "pipe", "pipe"]
    })

    let output = ""
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error("index.ts child process timed out"))
    }, timeoutMs)

    child.stdout.on("data", (chunk) => {
      output += chunk.toString()
    })
    child.stderr.on("data", (chunk) => {
      output += chunk.toString()
    })

    child.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })

    child.on("close", (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal, output })
    })
  })
}

describe("deploy hardening runtime contract", () => {
  it("returns readiness payload from readiness status helper", async () => {
    const dbUrl = requireEnv("DATABASE_URL")
    process.env.DATABASE_URL = dbUrl

    const { getReadinessStatus } = await import("../../src/server")
    const readiness = await getReadinessStatus()

    expect(readiness).toEqual({
      status: 200,
      body: {
        ok: true,
        checks: {
          db: "up"
        }
      }
    })
  })

  it("fails fast with BOOT_CONFIG_ERROR when DATABASE_URL is missing", async () => {
    const result = await runApiIndex(
      {
        PORT: "0",
        DATABASE_URL: "",
        AUTH_BOOTSTRAP_KEY: "bootstrap-test-key",
        ENRICH_TRIGGER_MODE: "rule"
      },
      4000
    )

    expect(result.code).toBe(1)
    expect(result.output).toContain("BOOT_CONFIG_ERROR")
    expect(result.output).toContain("DATABASE_URL")
  })

  it("shuts down gracefully on SIGTERM with exit code 0", async () => {
    const close = vi.fn<(callback: (error?: Error | null) => void) => void>((callback) => callback(null))
    const closePool = vi.fn(async () => undefined)
    const log = vi.fn()
    const error = vi.fn()
    const exit = vi.fn()

    const { shutdown } = await import("../../src/runtime/boot")
    await shutdown(
      {
        close
      } as unknown as import("http").Server,
      "SIGTERM",
      closePool,
      {
        timeoutMs: 100,
        exit,
        logger: { log, error }
      }
    )

    expect(close).toHaveBeenCalledTimes(1)
    expect(closePool).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith("received SIGTERM, starting graceful shutdown")
    expect(log).toHaveBeenCalledWith("graceful shutdown complete")
    expect(exit).toHaveBeenCalledWith(0)
  })

  it("exposes idempotent closePool cleanup", async () => {
    const poolModule = (await import("../../src/db/pool")) as {
      closePool?: () => Promise<void>
    }

    expect(typeof poolModule.closePool).toBe("function")
    await poolModule.closePool?.()
    await poolModule.closePool?.()
  })
})
