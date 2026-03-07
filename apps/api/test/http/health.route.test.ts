import request from "supertest"
import { describe, expect, it } from "vitest"
import { createServer } from "../../src/server"

describe("GET /health", () => {
  it("returns 200 with ok=true", async () => {
    const app = createServer()
    const response = await request(app).get("/health")

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ ok: true })
  })
})

