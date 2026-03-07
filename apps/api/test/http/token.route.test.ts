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
    expect(response.body.userId).toBeUndefined()
  })

  it("rejects token issue when stable user id is missing", async () => {
    const app = createServer()
    const response = await request(app).post("/api/token").send({})

    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({
      code: "INVALID_EVENT"
    })
  })

  it("rejects token issue when stable user id is blank", async () => {
    const app = createServer()
    const response = await request(app).post("/api/token").send({ userId: "   " })

    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({
      code: "INVALID_EVENT"
    })
  })
})
