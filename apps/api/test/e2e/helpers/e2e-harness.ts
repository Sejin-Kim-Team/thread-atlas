import { randomUUID } from "node:crypto"
import type { Server as HttpServer } from "node:http"
import request from "supertest"
import { WebSocket as NodeWebSocket } from "ws"
import { ensureDatabaseMigrations } from "../../../src/db/migrate"
import { closePool, queryDbRaw } from "../../../src/db/pool"
import { createHttpServer, createServer } from "../../../src/server"
import { requireEnv } from "../../helpers/env"
import {
  createContextUpdatePayload,
  createEnvelope,
  createSessionOpenPayload,
  createUserIntentPayload,
  createValidSnapshot
} from "../../ws/helpers/ws-contract"

export interface E2EHarness {
  server: HttpServer
  port: number
  http: ReturnType<typeof request>
}

export interface IssuedAppSession {
  token: string
  userId: string
}

export function ensureE2EEnvironment(): void {
  requireEnv("DATABASE_URL")
  requireEnv("AUTH_BOOTSTRAP_KEY")
  requireEnv("GOOGLE_CLOUD_PROJECT")
  requireEnv("GOOGLE_CLOUD_LOCATION")
  // 자동 E2E는 enrich 판단을 고정해 flaky한 하이브리드 모드를 피한다.
  process.env.ENRICH_TRIGGER_MODE = "rule"
}

export async function bootE2EHarness(): Promise<E2EHarness> {
  ensureE2EEnvironment()
  await ensureDatabaseMigrations()

  const server = createHttpServer(createServer())
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })

  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("e2e server port is not available")
  }

  return {
    server,
    port: address.port,
    http: request(server)
  }
}

export async function closeE2EHarness(harness: E2EHarness | null): Promise<void> {
  if (!harness) {
    await closePool()
    return
  }

  await new Promise<void>((resolve, reject) => {
    harness.server.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
  await closePool()
}

export async function resetE2EDatabase(): Promise<void> {
  await ensureDatabaseMigrations()
  // 실제 DB를 쓰는 E2E이므로 소유/메모리 관련 테이블을 매 케이스마다 초기화한다.
  await queryDbRaw(`
    truncate table
      memory_record_embeddings,
      memory_records,
      analysis_runs,
      auth_sessions,
      user_identities,
      users
    restart identity cascade
  `)
}

export async function issueDevBootstrapSession(
  harness: E2EHarness,
  bootstrapSubject: string
): Promise<IssuedAppSession> {
  const response = await harness.http
    .post("/api/token")
    .set("X-Bootstrap-Key", requireEnv("AUTH_BOOTSTRAP_KEY"))
    .send({
      grantType: "dev-bootstrap",
      bootstrapSubject
    })

  if (response.status !== 200) {
    throw new Error(`failed to issue dev-bootstrap token: ${response.status}`)
  }

  return {
    token: response.body.token as string,
    userId: response.body.user.id as string
  }
}

export function connectE2EWebSocket(port: number, token: string): Promise<NodeWebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new NodeWebSocket(`ws://127.0.0.1:${port}/ws/session?token=${token}`)
    const timer = setTimeout(() => {
      ws.close()
      reject(new Error("e2e websocket open timeout"))
    }, 10_000)

    ws.once("open", () => {
      clearTimeout(timer)
      resolve(ws)
    })

    ws.once("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

export interface WebSocketMessageCollector {
  messages: Array<Record<string, unknown>>
  waitForRequiredTypes(requiredTypes: string[], timeoutMs?: number): Promise<Array<Record<string, unknown>>>
}

export function createWebSocketMessageCollector(ws: NodeWebSocket): WebSocketMessageCollector {
  const messages: Array<Record<string, unknown>> = []

  ws.on("message", (data) => {
    try {
      messages.push(JSON.parse(data.toString()) as Record<string, unknown>)
    } catch {
      // E2E 수집기는 잘못된 JSON이 들어오더라도 원인 파악을 위해 누적만 중단하지 않는다.
    }
  })

  return {
    messages,
    waitForRequiredTypes(requiredTypes: string[], timeoutMs = 20_000) {
      return waitForRequiredTypes(messages, requiredTypes, timeoutMs)
    }
  }
}

function waitForRequiredTypes(
  collected: Array<Record<string, unknown>>,
  requiredTypes: string[],
  timeoutMs = 20_000
): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`required ws event types timed out: ${requiredTypes.join(", ")}`))
    }, timeoutMs)

    const poll = () => {
      const currentTypes = new Set(collected.map((message) => String(message.type)))
      if (requiredTypes.every((type) => currentTypes.has(type))) {
        clearTimeout(timer)
        resolve(collected)
        return
      }
      setTimeout(poll, 25)
    }

    poll()
  })
}

export function createCurrentPageIntent(text: string, capturedAt = "2026-03-08T10:00:00.000Z") {
  return createEnvelope(
    "user.intent",
    {
      ...createUserIntentPayload(128, capturedAt),
      text
    },
    {
      requestId: `req-${Math.random().toString(16).slice(2)}`
    }
  )
}

export async function openCurrentPageSession(
  ws: NodeWebSocket,
  capturedAt = "2026-03-08T10:00:00.000Z"
): Promise<void> {
  const clientSessionId = `e2e-${randomUUID()}`
  ws.send(
    JSON.stringify({
      ...createEnvelope(
        "session.open",
        {
          ...createSessionOpenPayload(),
          clientSessionId
        },
        {
          requestId: "req-e2e-session-open"
        }
      )
    })
  )
  ws.send(
    JSON.stringify({
      ...createEnvelope("context.update", createContextUpdatePayload(128), {
        requestId: "req-e2e-context-update"
      })
    })
  )
  ws.send(
    JSON.stringify({
      ...createEnvelope(
        "snapshot.push",
        {
          tabId: 128,
          snapshot: createValidSnapshot(capturedAt)
        },
        {
          requestId: "req-e2e-snapshot-push"
        }
      )
    })
  )
}
