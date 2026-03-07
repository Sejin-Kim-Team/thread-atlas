import { describe, expect, it } from "vitest"

async function loadAuthSessionsRepository() {
  try {
    return await import("../../src/auth/auth-sessions-repository")
  } catch (error) {
    throw new Error("auth-sessions-repository module must exist for DB-backed session ownership")
  }
}

describe("auth sessions repository contract (red)", () => {
  it("issues a session with token hash only and returns opaque token", async () => {
    const repo = await loadAuthSessionsRepository()
    expect(typeof repo.issueAuthSession).toBe("function")

    const issued = await repo.issueAuthSession({
      userId: "00000000-0000-0000-0000-000000000111",
      clientKind: "extension"
    })

    expect(issued).toMatchObject({
      token: expect.any(String),
      expiresAt: expect.any(Number),
      sessionId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      )
    })
    expect(issued).not.toHaveProperty("sessionTokenHash")
  })

  it("resolves bearer token to local users.id principal", async () => {
    const repo = await loadAuthSessionsRepository()
    expect(typeof repo.resolveAuthSession).toBe("function")

    const issued = await repo.issueAuthSession({
      userId: "00000000-0000-0000-0000-000000000222",
      clientKind: "extension"
    })

    const resolved = await repo.resolveAuthSession(issued.token)
    expect(resolved).toMatchObject({
      ok: true,
      userId: "00000000-0000-0000-0000-000000000222"
    })
  })

  it("rejects revoked session token", async () => {
    const repo = await loadAuthSessionsRepository()
    expect(typeof repo.revokeAuthSession).toBe("function")

    const issued = await repo.issueAuthSession({
      userId: "00000000-0000-0000-0000-000000000333",
      clientKind: "extension"
    })
    await repo.revokeAuthSession(issued.sessionId)

    const resolved = await repo.resolveAuthSession(issued.token)
    expect(resolved).toMatchObject({
      ok: false
    })
  })
})
