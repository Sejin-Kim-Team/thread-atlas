import { describe, expect, it } from "vitest"

async function loadIdentitiesRepository() {
  try {
    return await import("../../src/auth/user-identities-repository")
  } catch (error) {
    throw new Error("user-identities-repository module must exist for provider subject binding")
  }
}

describe("user identities repository contract (red)", () => {
  it("upserts google identity and binds it to a local user id", async () => {
    const repo = await loadIdentitiesRepository()
    expect(typeof repo.upsertGoogleIdentity).toBe("function")

    const result = await repo.upsertGoogleIdentity({
      providerSubject: "google-sub-123",
      email: "alpha@example.com",
      emailVerified: true,
      profile: {
        displayName: "Alpha"
      },
      rawClaims: {
        sub: "google-sub-123"
      }
    })

    expect(result).toMatchObject({
      userId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      ),
      provider: "google",
      providerSubject: "google-sub-123"
    })
  })

  it("keeps the same local user binding for the same provider subject", async () => {
    const repo = await loadIdentitiesRepository()

    const first = await repo.upsertGoogleIdentity({
      providerSubject: "google-sub-stable",
      email: "stable@example.com"
    })
    const second = await repo.upsertGoogleIdentity({
      providerSubject: "google-sub-stable",
      email: "stable-updated@example.com"
    })

    expect(first.userId).toBe(second.userId)
  })

  it("rejects empty provider subject", async () => {
    const repo = await loadIdentitiesRepository()
    await expect(
      repo.upsertGoogleIdentity({
        providerSubject: ""
      })
    ).rejects.toThrow(/provider subject/i)
  })
})
