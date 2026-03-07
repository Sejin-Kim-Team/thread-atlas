import { describe, expect, it } from "vitest"

async function loadUsersRepository() {
  try {
    return await import("../../src/auth/users-repository")
  } catch (error) {
    throw new Error("users-repository module must exist for DB-backed user distinction")
  }
}

describe("users repository contract (red)", () => {
  it("creates or updates a local user and returns canonical uuid id", async () => {
    const repo = await loadUsersRepository()
    expect(typeof repo.upsertUserFromBootstrapSubject).toBe("function")

    const result = await repo.upsertUserFromBootstrapSubject({
      bootstrapSubject: "bootstrap-alpha",
      profile: {
        displayName: "Alpha",
        primaryEmail: "alpha@example.com",
        avatarUrl: "https://example.com/a.png"
      }
    })

    expect(result).toMatchObject({
      id: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      )
    })
    expect(typeof result.createdAt).toBe("string")
  })

  it("returns null when local user id is not found", async () => {
    const repo = await loadUsersRepository()
    expect(typeof repo.findUserById).toBe("function")

    const user = await repo.findUserById("00000000-0000-0000-0000-000000000999")
    expect(user).toBeNull()
  })

  it("keeps a stable local user id for the same bootstrap subject", async () => {
    const repo = await loadUsersRepository()

    const first = await repo.upsertUserFromBootstrapSubject({
      bootstrapSubject: "stable-subject",
      profile: {
        displayName: "Stable One"
      }
    })
    const second = await repo.upsertUserFromBootstrapSubject({
      bootstrapSubject: "stable-subject",
      profile: {
        displayName: "Stable Two"
      }
    })

    expect(first.id).toBe(second.id)
  })
})
