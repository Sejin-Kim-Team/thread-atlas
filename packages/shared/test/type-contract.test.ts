import { describe, expectTypeOf, it } from "vitest"
import type { Projection, StateSnapshot } from "../src"

describe("type contracts", () => {
  it("projection payloads keep their shapes", () => {
    expectTypeOf<Extract<Projection, { type: "respond" }>["payload"]>().toMatchTypeOf<{
      text: string
      mode: "answer" | "suggest" | "clarify"
    }>()

    expectTypeOf<Extract<Projection, { type: "focus" }>["payload"]>().toMatchTypeOf<{
      commentId: string
      options?: {
        style?: "primary" | "secondary" | "warning"
      }
    }>()
  })

  it("state snapshot contains required root fields", () => {
    expectTypeOf<StateSnapshot>().toHaveProperty("intent")
    expectTypeOf<StateSnapshot>().toHaveProperty("page")
    expectTypeOf<StateSnapshot>().toHaveProperty("user")
    expectTypeOf<StateSnapshot>().toHaveProperty("viewport")
    expectTypeOf<StateSnapshot>().toHaveProperty("sourceArticle")
    expectTypeOf<StateSnapshot>().toHaveProperty("semantics")
    expectTypeOf<StateSnapshot>().toHaveProperty("conversationContext")
  })
})
