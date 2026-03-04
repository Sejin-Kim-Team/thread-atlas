import express from "express"
import type { Express } from "express"
import analyzeRouter from "./routes/analyze"
import evaluateRouter from "./routes/evaluate"
import tokenRouter from "./routes/token"

export function createServer(): Express {
  const app = express()
  app.use(express.json({ limit: "2mb" }))

  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true })
  })

  app.use("/api/token", tokenRouter)
  app.use("/api/analyze", analyzeRouter)
  app.use("/api/evaluate", evaluateRouter)

  return app
}
