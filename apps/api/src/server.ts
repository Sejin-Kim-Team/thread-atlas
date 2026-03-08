import express from "express"
import type { Express } from "express"
import analyzeRouter from "./routes/analyze"
import evaluateRouter from "./routes/evaluate"
import ingestMemoryRouter from "./routes/ingest-memory"
import tokenRouter from "./routes/token"
import { createWsSessionEventsRouter } from "./routes/ws-session-events"
import { RuntimeManager } from "./session/runtime/manager"
import { attachSessionWebSocketServer } from "./ws/session-ws-server"

function attachCanonicalWsEndpoint(app: Express, runtime: RuntimeManager): void {
  const originalListen = app.listen.bind(app)
  app.listen = ((...args: Parameters<typeof originalListen>) => {
    const server = originalListen(...args)
    attachSessionWebSocketServer(server, runtime)
    return server
  }) as typeof app.listen
}

export function createServer(): Express {
  const app = express()
  const runtime = new RuntimeManager()
  app.use(express.json({ limit: "2mb" }))

  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true })
  })

  app.use("/api/token", tokenRouter)
  app.use("/api/analyze", analyzeRouter)
  // FE 마이그레이션 완료 전까지 기존 extension 호출 경로를 유지한다.
  app.use("/api/evaluate", evaluateRouter)
  app.use("/api/ingest/memory", ingestMemoryRouter)
  app.use("/ws/session/events", createWsSessionEventsRouter(runtime))
  attachCanonicalWsEndpoint(app, runtime)

  return app
}
