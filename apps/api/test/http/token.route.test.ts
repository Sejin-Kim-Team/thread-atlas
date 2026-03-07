import request from "supertest"
import { describe, expect, it } from "vitest"
import { createServer } from "../../src/server"

describe("POST /api/token", () => {
  it("returns token response contract", async () => {
    const app = createServer()
    const now = Math.floor(Date.now() / 1000)
    const response = await request(app).post("/api/token").send({ userId: "user_sungwoo" })

    expect(response.status).toBe(200)
    expect(typeof response.body.token).toBe("string")
    expect(typeof response.body.expiresAt).toBe("number")
    expect(response.body.expiresAt).toBeGreaterThan(now)
  })
})
