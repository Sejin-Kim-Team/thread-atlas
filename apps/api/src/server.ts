import express from "express"
import type { Express } from "express"
import analyzeRouter from "./routes/analyze"
import evaluateRouter from "./routes/evaluate"
import ingestMemoryRouter from "./routes/ingest-memory"
import tokenRouter from "./routes/token"
import { createWsSessionEventsRouter } from "./routes/ws-session-events"

export function createServer(): Express {
  const app = express()
  app.use(express.json({ limit: "2mb" }))

  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true })
  })

  app.use("/api/token", tokenRouter)
  app.use("/api/analyze", analyzeRouter)
  // FE 마이그레이션 완료 전까지 기존 extension 호출 경로를 유지한다.
  app.use("/api/evaluate", evaluateRouter)
  app.use("/api/ingest/memory", ingestMemoryRouter)
  app.use("/ws/session/events", createWsSessionEventsRouter())

  return app
}
