import request from "supertest"
import { describe, expect, it } from "vitest"
import { createServer } from "../../src/server"

describe("POST /api/evaluate (legacy compatibility)", () => {
  it("is mounted and returns SSE stream contract", async () => {
    const app = createServer()
    const response = await request(app).post("/api/evaluate").send({})

    expect(response.status).toBe(200)
    expect(response.headers["content-type"]).toContain("text/event-stream")
    expect(response.text).toContain("event: error")
  })
})
