import { describe, expect, it } from "vitest"
import { sanitizeInteractiveNode } from "../src/browser-runtime"

describe("sanitizeInteractiveNode", () => {
  it("redacts sensitive text-like inputs", () => {
    const node = sanitizeInteractiveNode({
      kind: "interactive",
      id: "interactive-1",
      controlType: "input",
      label: "API key",
      action: "unknown",
      metadata: {
        inputType: "text",
        name: "api_key",
        rawValue: "sk-secret-value"
      }
    })

    expect(node.valuePreview).toBe("[redacted]")
    expect(node.metadata).not.toHaveProperty("rawValue")
  })

  it("keeps only state for checkbox-like controls", () => {
    const node = sanitizeInteractiveNode({
      kind: "interactive",
      id: "interactive-2",
      controlType: "checkbox",
      label: "Include archived",
      state: "checked",
      metadata: {
        inputType: "checkbox",
        rawValue: "on"
      }
    })

    expect(node.valuePreview).toBeUndefined()
    expect(node.state).toBe("checked")
    expect(node.metadata).not.toHaveProperty("rawValue")
  })

  it("truncates non-sensitive previews", () => {
    const node = sanitizeInteractiveNode({
      kind: "interactive",
      id: "interactive-3",
      controlType: "input",
      label: "Search",
      action: "search",
      metadata: {
        inputType: "search",
        rawValue: "a".repeat(120)
      }
    })

    expect(node.valuePreview).toHaveLength(80)
  })
})
