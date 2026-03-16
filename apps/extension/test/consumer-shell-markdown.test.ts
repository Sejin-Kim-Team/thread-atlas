import { describe, expect, it } from "vitest"
import { renderAssistantMarkdownFragment } from "../src/sidepanel-user/markdown"

describe("consumer shell markdown", () => {
  it("renders basic prose markdown into safe HTML", () => {
    const fragment = renderAssistantMarkdownFragment("**Bold**\n\n- one\n- two\n\n`code`")
    const root = document.createElement("div")
    root.appendChild(fragment)

    expect(root.querySelector("strong")?.textContent).toBe("Bold")
    expect(root.querySelectorAll("li")).toHaveLength(2)
    expect(root.querySelector("code")?.textContent).toBe("code")
  })

  it("strips unsafe tags and attributes while preserving text", () => {
    const fragment = renderAssistantMarkdownFragment(
      `<script>alert(1)</script><a href="javascript:alert(1)" onclick="alert(1)">bad</a><a href="https://example.com">good</a>`
    )
    const root = document.createElement("div")
    root.appendChild(fragment)

    expect(root.querySelector("script")).toBeNull()
    expect(root.querySelector("a")?.getAttribute("href")).toBeNull()
    expect(root.querySelectorAll("a")[1]?.getAttribute("href")).toBe("https://example.com/")
    expect(root.querySelectorAll("a")[1]?.getAttribute("rel")).toBe("noreferrer noopener")
  })
})
