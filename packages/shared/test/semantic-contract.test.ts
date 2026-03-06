import { describe, expectTypeOf, it } from "vitest"
import type {
  ContextPack,
  SemanticCategory,
  SemanticSnapshot
} from "../src"
import type { ContextProjectionFormat, ContextTaskProfile } from "../src/projection-policy"
import type {
  EnhancerContext,
  PageExtractor,
  SemanticSkeleton,
  SiteEnhancer
} from "../src/browser-runtime"
import type {
  AnyRuntimeMessage,
  SemanticSnapshotCaptureResponse
} from "../src/runtime"

describe("semantic snapshot contracts", () => {
  it("exports semantic snapshot root fields", () => {
    expectTypeOf<SemanticSnapshot>().toHaveProperty("page")
    expectTypeOf<SemanticSnapshot>().toHaveProperty("focus")
    expectTypeOf<SemanticSnapshot>().toHaveProperty("context")
    expectTypeOf<SemanticSnapshot>().toHaveProperty("meta")
    expectTypeOf<SemanticSnapshot["focus"]["node"]>().toHaveProperty("kind")
    expectTypeOf<NonNullable<SemanticSnapshot["meta"]["coverage"]>>().toMatchTypeOf<{
      kind: "focus-branch" | "focus-section"
      rootNodeId: string
      capturedNodeCount: number
      omittedNodeCount: number
      omittedRootCount: number
    }>()
  })

  it("keeps skeleton and extractor contracts aligned", () => {
    expectTypeOf<SemanticSkeleton>().toHaveProperty("version")
    expectTypeOf<SemanticCategory>().toMatchTypeOf<
      | "content.article"
      | "discussion.comment"
      | "metadata.stats"
      | "interactive.sort"
    >()
    expectTypeOf<PageExtractor>().toHaveProperty("buildSkeleton")
    expectTypeOf<PageExtractor>().toHaveProperty("describePage")
    expectTypeOf<PageExtractor>().toHaveProperty("expandRegion")
    expectTypeOf<PageExtractor>().toHaveProperty("resolveFocus")
  })

  it("exposes runtime messages and response shapes", () => {
    expectTypeOf<SemanticSnapshotCaptureResponse>().toMatchTypeOf<{
      snapshot: SemanticSnapshot | null
      error: string | null
    }>()

    expectTypeOf<AnyRuntimeMessage>().toMatchTypeOf<
      | { type: "REQUEST_SEMANTIC_SNAPSHOT" }
      | { type: "CAPTURE_SEMANTIC_SNAPSHOT" }
      | { type: "SEMANTIC_SNAPSHOT_READY" }
      | { type: "GET_LATEST_SEMANTIC_SNAPSHOT" }
      | { type: "GET_SEMANTIC_SNAPSHOT_HISTORY" }
      | { type: "TOGGLE_SEMANTIC_SELECTION" }
      | { type: "GET_SEMANTIC_SELECTION_STATE" }
      | { type: "CLEAR_SEMANTIC_SELECTION" }
    >()
  })

  it("exports context pack contracts", () => {
    expectTypeOf<ContextPack>().toHaveProperty("scope")
    expectTypeOf<ContextPack>().toHaveProperty("groups")
    expectTypeOf<ContextTaskProfile>().toEqualTypeOf<
      "branch-summary" | "reply-assist" | "claim-extraction"
    >()
    expectTypeOf<ContextProjectionFormat>().toEqualTypeOf<
      "context-pack-json" | "compact-json" | "linear-text"
    >()
  })

  it("exports enhancer contracts", () => {
    expectTypeOf<SiteEnhancer>().toHaveProperty("match")
    expectTypeOf<EnhancerContext>().toHaveProperty("url")
    expectTypeOf<EnhancerContext>().toHaveProperty("document")
  })
})
