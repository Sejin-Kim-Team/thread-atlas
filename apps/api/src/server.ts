import { createServer as createHttpNodeServer, type Server as HttpServer } from "node:http"
import express from "express"
import type { Express } from "express"
import { queryDb } from "./db/pool"
import { DEFAULT_JSON_BODY_LIMIT } from "./http/json-body-limit"
import analyzeRouter from "./routes/analyze"
import evaluateRouter from "./routes/evaluate"
import ingestMemoryRouter from "./routes/ingest-memory"
import tokenRouter from "./routes/token"
import { createLogger } from "./runtime/logger"
import { createWsSessionEventsRouter } from "./routes/ws-session-events"
import { RuntimeManager } from "./session/runtime/manager"
import { attachLiveWebSocketServer } from "./ws/live-ws-server"
import { attachSessionWebSocketServer } from "./ws/session-ws-server"

type RuntimeBoundExpress = Express & {
  locals: Express["locals"] & {
    runtimeManager?: RuntimeManager
  }
}

export function createServer(): Express {
  const app = express()
  const runtime = new RuntimeManager()
  const logger = createLogger("server")
  ;(app as RuntimeBoundExpress).locals.runtimeManager = runtime
  app.use(express.json({ limit: DEFAULT_JSON_BODY_LIMIT }))

  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true })
  })

  app.get("/ready", async (_req, res) => {
    const readiness = await getReadinessStatus()
    if (readiness.status !== 200) {
      logger.warn("readiness-check-failed", {
        status: readiness.status,
        checks: readiness.body.checks
      })
    }
    res.status(readiness.status).json(readiness.body)
  })

  app.use("/api/token", tokenRouter)
  app.use("/api/analyze", analyzeRouter)
  // FE 마이그레이션 완료 전까지 기존 extension 호출 경로를 유지한다.
  app.use("/api/evaluate", evaluateRouter)
  app.use("/api/ingest/memory", ingestMemoryRouter)
  app.use("/ws/session/events", createWsSessionEventsRouter(runtime))

  return app
}

export async function getReadinessStatus(): Promise<{
  status: 200 | 503
  body:
    | { ok: true; checks: { db: "up" } }
    | { ok: false; code: "NOT_READY"; checks: { db: "down" } }
}> {
  try {
    await queryDb("select 1")
    return {
      status: 200,
      body: {
        ok: true,
        checks: {
          db: "up"
        }
      }
    }
  } catch (_error) {
    // readiness는 핵심 의존성(DB) 준비 여부만 반영한다.
    return {
      status: 503,
      body: {
        ok: false,
        code: "NOT_READY",
        checks: {
          db: "down"
        }
      }
    }
  }
}

export function createHttpServer(app: Express = createServer()): HttpServer {
  const runtime = (app as RuntimeBoundExpress).locals.runtimeManager
  if (!runtime) {
    throw new Error("runtimeManager is required to attach canonical websocket server")
  }

  // HTTP 앱과 WS transport를 분리해 supertest 경로가 실제 listen에 의존하지 않도록 한다.
  const server = createHttpNodeServer(app)
  attachSessionWebSocketServer(server, runtime)
  attachLiveWebSocketServer(server, runtime)
  return server
}
