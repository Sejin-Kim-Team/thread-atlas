import { afterEach, describe, expect, it, vi } from "vitest"

async function loadVertexEmbeddingAdapterModule() {
  return import("../../src/rag/vertex-embedding-adapter")
}

describe("vertex embedding adapter contract (red)", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("exports canonical model/dims contract for Vertex embeddings", async () => {
    const module = await loadVertexEmbeddingAdapterModule()

    expect(module.CANONICAL_VERTEX_EMBEDDING_MODEL).toBe("gemini-embedding-001")
    expect(module.CANONICAL_VERTEX_EMBEDDING_DIMS).toBe(768)
    expect(typeof module.embedTextWithVertex).toBe("function")
  })

  it("throws explicit config error when GOOGLE_CLOUD_PROJECT is missing", async () => {
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "")
    vi.stubEnv("GOOGLE_CLOUD_LOCATION", "us-central1")
    const module = await loadVertexEmbeddingAdapterModule()

    await expect(module.embedTextWithVertex("hello")).rejects.toMatchObject({
      code: "EMBEDDING_PROVIDER_CONFIG_MISSING"
    })
  })

  it("throws explicit config error when GOOGLE_CLOUD_LOCATION is missing", async () => {
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "thread-atlas")
    vi.stubEnv("GOOGLE_CLOUD_LOCATION", "")
    const module = await loadVertexEmbeddingAdapterModule()

    await expect(module.embedTextWithVertex("hello")).rejects.toMatchObject({
      code: "EMBEDDING_PROVIDER_CONFIG_MISSING"
    })
  })
})
