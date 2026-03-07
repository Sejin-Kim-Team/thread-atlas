import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SemanticCaptureSession } from "../src/content/semantic/session"

function buildThreadMarkup(): string {
  return `
    <table>
      <tbody>
        <tr>
          <td>
            <a href="https://example.com/article">Thread Title</a>
          </td>
        </tr>
        <tr>
          <td>
            <span class="subtext">123 points by submitter 1 hour ago</span>
          </td>
        </tr>
        <tr id="c1">
          <td indent="0"></td>
          <td>
            <a class="hnuser">alice</a>
            <span class="age">3 hours ago</span>
            <div class="commtext">parent comment</div>
          </td>
        </tr>
        <tr id="c2">
          <td indent="1"></td>
          <td>
            <a class="hnuser">bob</a>
            <span class="age">2 hours ago</span>
            <div class="commtext">focused child comment</div>
          </td>
        </tr>
        <tr id="c3">
          <td indent="2"></td>
          <td>
            <a class="hnuser">dave</a>
            <span class="age">just now</span>
            <div class="commtext">child comment</div>
          </td>
        </tr>
        <tr id="c4">
          <td indent="1"></td>
          <td>
            <a class="hnuser">carol</a>
            <span class="age">1 hour ago</span>
            <div class="commtext">sibling comment</div>
          </td>
        </tr>
      </tbody>
    </table>
  `
}

function buildArticleMarkup(): string {
  return `
    <main>
      <article>
        <h1>Article Title</h1>
        <p>Intro paragraph with enough text to make readability keep the article content around.</p>
        <h2>Section One</h2>
        <p>Focused paragraph with enough substance to remain inside the selected section for the semantic snapshot.</p>
        <p>Peer paragraph that should stay in the same section context.</p>
        <h2>Section Two</h2>
        <p>Other section paragraph that should be omitted from the focused section context.</p>
      </article>
    </main>
  `
}

function buildGridMarkup(): string {
  return `
    <section class="results-grid">
      <article class="result-card">
        <a href="https://example.com/r1">Result One</a>
        <p>First result summary with enough text to be meaningful.</p>
      </article>
      <article class="result-card">
        <a href="https://example.com/r2">Result Two</a>
        <p>Second result summary with enough text to be meaningful.</p>
      </article>
      <article class="result-card">
        <a href="https://example.com/r3">Result Three</a>
        <p>Third result summary with enough text to be meaningful.</p>
      </article>
    </section>
  `
}

function buildFrontPageMarkup(): string {
  return `
    <table class="itemlist">
      <tbody>
        <tr class="athing" id="story-1">
          <td><span class="titleline"><a href="https://example.com/story-1">Story One</a></span></td>
        </tr>
        <tr id="meta-1">
          <td><span class="subtext">111 points by alice 1 hour ago <a href="https://news.ycombinator.com/item?id=1">42 comments</a></span></td>
        </tr>
        <tr class="spacer"><td></td></tr>
        <tr class="athing" id="story-2">
          <td><span class="titleline"><a href="https://example.com/story-2">Story Two</a></span></td>
        </tr>
        <tr id="meta-2">
          <td><span class="subtext">98 points by bob 2 hours ago <a href="https://news.ycombinator.com/item?id=2">18 comments</a></span></td>
        </tr>
        <tr class="spacer"><td></td></tr>
        <tr class="athing jobs" id="story-3">
          <td><span class="titleline"><a href="https://example.com/job-3">Jobs: Builder</a></span></td>
        </tr>
      </tbody>
    </table>
  `
}

function buildProseListNegativeMarkup(): string {
  return `
    <main>
      <article>
        <h1>Semantic Systems Reading Notes</h1>
        <p>This article body should remain an authored block even when it contains a short supporting reading list.</p>
        <p>The list below is supporting prose and should not become a repeated card or feed region.</p>
        <ul class="related-reading">
          <li><a href="/guide/one">Assembly heuristics overview</a></li>
          <li><a href="/guide/two">How layout role suppression works</a></li>
          <li><a href="/guide/three">When to keep a navigation cluster</a></li>
          <li><a href="/guide/four">Designing stable regression fixtures</a></li>
        </ul>
        <p>After the list, the authored article should continue normally.</p>
      </article>
    </main>
  `
}

function buildDocsLayoutMarkup(): string {
  return `
    <header>
      <nav aria-label="Global">
        <a href="/home">Home</a>
        <a href="/docs">Docs</a>
      </nav>
      <form role="search" aria-label="Docs search">
        <label for="layout-q">Search docs</label>
        <input id="layout-q" type="search" name="query" value="vector index" placeholder="Search docs" />
        <button type="submit">Search</button>
      </form>
    </header>
    <div class="docs-shell">
      <aside>
        <nav aria-label="Sections">
          <a href="/docs/intro">Intro</a>
          <a href="/docs/guide">Guide</a>
          <a href="/docs/api">API</a>
        </nav>
      </aside>
      <main>
        <article>
          <h1>Docs Landing</h1>
          <p>This article body has enough text to be recognized as the main content region for the page.</p>
          <p>Additional supporting prose keeps readability and authored block detection stable in the test fixture.</p>
        </article>
      </main>
    </div>
    <footer>
      <nav aria-label="Footer">
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
        <a href="/security">Security</a>
      </nav>
    </footer>
  `
}

function buildSameOriginGridMarkup(): string {
  return `
    <section class="results-grid">
      <article class="result-card">
        <a href="/docs/guide-1">Guide One</a>
        <p>First guide summary with enough text to be meaningful.</p>
      </article>
      <article class="result-card">
        <a href="/docs/guide-2">Guide Two</a>
        <p>Second guide summary with enough text to be meaningful.</p>
      </article>
      <article class="result-card">
        <a href="/docs/guide-3">Guide Three</a>
        <p>Third guide summary with enough text to be meaningful.</p>
      </article>
    </section>
  `
}

function buildInteractiveMarkup(): string {
  return `
    <form role="search" aria-label="Docs search">
      <label for="q">Search docs</label>
      <input id="q" type="search" name="query" value="rate limiter" placeholder="Search docs" />
      <button type="submit">Search</button>
    </form>
  `
}

function selectText(selector: string, start = 0, end = 6): void {
  const target = document.querySelector(selector)?.firstChild
  expect(target).toBeTruthy()

  const range = document.createRange()
  range.setStart(target as Text, start)
  range.setEnd(target as Text, end)

  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function getRepeatedRegionId(session: SemanticCaptureSession): string {
  const repeatedRegion = session.getSkeleton()?.regions.find((region) => region.primitive === "repeated-item")
  expect(repeatedRegion?.id).toBeTruthy()
  return repeatedRegion!.id
}

describe("SemanticCaptureSession", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "https://news.ycombinator.com/item?id=123")
    document.body.innerHTML = buildThreadMarkup()
  })

  afterEach(() => {
    window.getSelection()?.removeAllRanges()
    vi.useRealTimers()
  })

  it("captures selection-focused repeated-item branches", () => {
    const session = new SemanticCaptureSession(document, window)
    session.initialize()
    selectText("#c2 .commtext")

    const result = session.captureSnapshot()

    expect(result.error).toBeNull()
    expect(result.snapshot?.meta.extractorId).toBe("generic-semantic")
    expect(result.snapshot?.focus.nodeId).toBe("repeated-item-1-item-2")
    expect(result.snapshot?.focus.node).toMatchObject({
      parentId: "repeated-item-1-item-1",
      depth: 1
    })
    expect(new Set(result.snapshot?.context.map((slice) => slice.relation))).toEqual(
      new Set(["parent", "child", "sibling"])
    )
    expect(result.snapshot?.meta.coverage).toEqual({
      kind: "focus-branch",
      rootNodeId: "repeated-item-1-item-1",
      capturedNodeCount: 4,
      omittedNodeCount: 0,
      omittedRootCount: 0
    })

    session.dispose()
  })

  it("uses hovered element fallback when no selection exists", () => {
    const session = new SemanticCaptureSession(document, window)
    session.initialize()
    const hovered = document.querySelector("#c3 .commtext")
    expect(hovered).toBeTruthy()

    const result = session.captureSnapshot({
      source: "command",
      activeElement: document.body,
      selection: window.getSelection(),
      triggerTarget: null,
      selectedElement: null,
      lastHoveredElement: hovered ?? null
    })

    expect(result.error).toBeNull()
    expect(result.snapshot?.focus.nodeId).toBe("repeated-item-1-item-3")
    expect(result.snapshot?.meta.coverage?.kind).toBe("focus-branch")

    session.dispose()
  })

  it("prefers explicitly selected semantic elements over hover targets", () => {
    const session = new SemanticCaptureSession(document, window)
    session.initialize()
    const selectedElement = document.querySelector("#c2 .commtext")
    const hoveredElement = document.querySelector("#c3 .commtext")
    expect(selectedElement).toBeTruthy()
    expect(hoveredElement).toBeTruthy()

    const result = session.captureSnapshot({
      source: "command",
      activeElement: document.body,
      selection: window.getSelection(),
      triggerTarget: document.body,
      selectedElement: selectedElement ?? null,
      lastHoveredElement: hoveredElement ?? null
    })

    expect(result.error).toBeNull()
    expect(result.snapshot?.focus.nodeId).toBe("repeated-item-1-item-2")

    session.dispose()
  })

  it("captures only the focused thread subtree for top-level repeated items", () => {
    const session = new SemanticCaptureSession(document, window)
    session.initialize()
    const topLevel = document.querySelector("#c1 .commtext")
    expect(topLevel).toBeTruthy()

    const result = session.captureSnapshot({
      source: "command",
      activeElement: document.body,
      selection: window.getSelection(),
      triggerTarget: topLevel ?? null,
      selectedElement: null,
      lastHoveredElement: topLevel ?? null
    })

    expect(result.error).toBeNull()
    expect(result.snapshot?.focus.nodeId).toBe("repeated-item-1-item-1")
    expect(result.snapshot?.context).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relation: "child",
          distance: 1,
          node: expect.objectContaining({ id: "repeated-item-1-item-2" })
        }),
        expect.objectContaining({
          relation: "child",
          distance: 1,
          node: expect.objectContaining({ id: "repeated-item-1-item-4" })
        }),
        expect.objectContaining({
          relation: "child",
          distance: 2,
          node: expect.objectContaining({ id: "repeated-item-1-item-3" })
        })
      ])
    )

    session.dispose()
  })

  it("marks repeated-item regions stale on mutation and refreshes on next capture", async () => {
    vi.useFakeTimers()
    const session = new SemanticCaptureSession(document, window)
    session.initialize()

    const child = document.querySelector("#c2 .commtext")
    session.captureSnapshot({
      source: "command",
      activeElement: document.body,
      selection: window.getSelection(),
      triggerTarget: child ?? null,
      selectedElement: null,
      lastHoveredElement: child ?? null
    })

    const repeatedRegionId = getRepeatedRegionId(session)
    expect(session.getRegionState(repeatedRegionId)).toBe("fresh")

    const tbody = document.querySelector("tbody")
    expect(tbody).toBeTruthy()

    const row = document.createElement("tr")
    row.id = "c5"
    row.innerHTML = `
      <td indent="1"></td>
      <td>
        <a class="hnuser">eve</a>
        <span class="age">moments ago</span>
        <div class="commtext">new sibling</div>
      </td>
    `
    tbody?.appendChild(row)

    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(301)

    expect(session.getRegionState(repeatedRegionId)).toBe("stale")

    const result = session.captureSnapshot({
      source: "command",
      activeElement: document.body,
      selection: window.getSelection(),
      triggerTarget: child ?? null,
      selectedElement: null,
      lastHoveredElement: child ?? null
    })

    expect(result.error).toBeNull()
    expect(session.getRegionState(repeatedRegionId)).toBe("fresh")

    session.dispose()
  })

  it("captures focus sections for authored blocks with section coverage", () => {
    window.history.replaceState({}, "", "/docs/article")
    document.body.innerHTML = buildArticleMarkup()

    const session = new SemanticCaptureSession(document, window)
    session.initialize()
    const paragraph = document.querySelectorAll("p")[1]
    expect(paragraph).toBeTruthy()

    const result = session.captureSnapshot({
      source: "sidepanel",
      activeElement: paragraph ?? document.body,
      selection: window.getSelection(),
      triggerTarget: paragraph ?? null,
      selectedElement: null,
      lastHoveredElement: paragraph ?? null
    })

    expect(result.error).toBeNull()
    expect(result.snapshot?.page.kind).toBe("article")
    expect(result.snapshot?.meta.coverage).toMatchObject({
      kind: "focus-section",
      rootNodeId: expect.stringContaining("authored-block-1"),
      omittedRootCount: 0
    })

    session.dispose()
  })

  it("captures div-based repeated cards as a focus section", () => {
    window.history.replaceState({}, "", "/search")
    document.body.innerHTML = buildGridMarkup()

    const session = new SemanticCaptureSession(document, window)
    session.initialize()
    const card = document.querySelectorAll(".result-card")[1]
    expect(card).toBeTruthy()

    const result = session.captureSnapshot({
      source: "popup",
      activeElement: card ?? document.body,
      selection: window.getSelection(),
      triggerTarget: card ?? null,
      selectedElement: card ?? null,
      lastHoveredElement: card ?? null
    })

    expect(result.error).toBeNull()
    expect(result.snapshot?.focus.region).toBe("repeated-item-1")
    expect(result.snapshot?.focus.nodeId).toBe("repeated-item-1-item-2")
    expect(result.snapshot?.context).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relation: "sibling",
          node: expect.objectContaining({ id: "repeated-item-1-item-1" })
        }),
        expect.objectContaining({
          relation: "sibling",
          node: expect.objectContaining({ id: "repeated-item-1-item-3" })
        })
      ])
    )
    expect(result.snapshot?.meta.coverage).toMatchObject({
      kind: "focus-section",
      rootNodeId: "repeated-item-1-scope-root",
      capturedNodeCount: 3
    })

    session.dispose()
  })

  it("captures interactive clusters with a cluster root and sibling controls", () => {
    window.history.replaceState({}, "", "/docs")
    document.body.innerHTML = buildInteractiveMarkup()

    const session = new SemanticCaptureSession(document, window)
    session.initialize()
    const input = document.querySelector("#q")
    expect(input).toBeTruthy()

    const result = session.captureSnapshot({
      source: "sidepanel",
      activeElement: input ?? document.body,
      selection: window.getSelection(),
      triggerTarget: input ?? null,
      selectedElement: input ?? null,
      lastHoveredElement: input ?? null
    })

    expect(result.error).toBeNull()
    expect(result.snapshot?.focus.region).toBe("interactive-block-1")
    expect(result.snapshot?.focus.node).toMatchObject({
      kind: "interactive",
      controlType: "group",
      label: "Docs search",
      action: "search",
      metadata: expect.objectContaining({
        controlCount: "2",
        subtype: "search"
      })
    })
    expect(result.snapshot?.context).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relation: "child",
          node: expect.objectContaining({ controlType: "input", action: "search" })
        }),
        expect.objectContaining({
          relation: "child",
          node: expect.objectContaining({ controlType: "button" })
        })
      ])
    )
    expect(result.snapshot?.meta.coverage).toEqual({
      kind: "focus-section",
      rootNodeId: "interactive-block-1-cluster",
      capturedNodeCount: 3,
      omittedNodeCount: 0,
      omittedRootCount: 0
    })

    session.dispose()
  })

  it("refines hn selection targets through the enhancer", () => {
    const session = new SemanticCaptureSession(document, window)
    session.initialize()

    const refined = session.refineSelectionTarget({
      regionId: "repeated-item-1",
      primitive: "repeated-item",
      subtype: "nested",
      category: "discussion.thread",
      nodeKind: "comment",
      nodeId: "repeated-item-1-item-2",
      rootNodeId: "repeated-item-1-item-1",
      scopeRootId: "repeated-item-1-item-1",
      label: "Comment",
      displayLabel: "Comment",
      text: "focused child comment"
    })

    expect(refined.category).toBe("discussion.comment")
    expect(refined.displayLabel).toBe("Comment by bob")

    session.dispose()
  })

  it("assembles hn front page title and metadata rows into one item", () => {
    window.history.replaceState({}, "", "https://news.ycombinator.com/")
    document.body.innerHTML = buildFrontPageMarkup()

    const session = new SemanticCaptureSession(document, window)
    session.initialize()
    const metadataRow = document.querySelector("#meta-2")
    expect(metadataRow).toBeTruthy()

    const result = session.captureSnapshot({
      source: "command",
      activeElement: document.body,
      selection: window.getSelection(),
      triggerTarget: metadataRow ?? null,
      selectedElement: metadataRow ?? null,
      lastHoveredElement: metadataRow ?? null
    })

    expect(result.error).toBeNull()
    expect(result.snapshot?.focus.nodeId).toBe("repeated-item-1-item-2")
    expect(result.snapshot?.focus.node).toMatchObject({
      kind: "content",
      attributes: expect.objectContaining({
        primaryHref: "https://example.com/story-2",
        discussionHref: "https://news.ycombinator.com/item?id=2",
        author: "bob",
        commentCount: "18"
      })
    })

    session.dispose()
  })

  it("keeps jobs-style variants in assembled repeated items", () => {
    window.history.replaceState({}, "", "https://news.ycombinator.com/")
    document.body.innerHTML = buildFrontPageMarkup()

    const session = new SemanticCaptureSession(document, window)
    session.initialize()
    const jobsRow = document.querySelector("#story-3")
    expect(jobsRow).toBeTruthy()

    const result = session.captureSnapshot({
      source: "command",
      activeElement: document.body,
      selection: window.getSelection(),
      triggerTarget: jobsRow ?? null,
      selectedElement: jobsRow ?? null,
      lastHoveredElement: jobsRow ?? null
    })

    expect(result.error).toBeNull()
    expect(result.snapshot?.focus.nodeId).toBe("repeated-item-1-item-3")
    expect(result.snapshot?.focus.node).toMatchObject({
      kind: "content",
      attributes: expect.not.objectContaining({
        discussionHref: expect.any(String)
      })
    })

    session.dispose()
  })

  it("does not classify same-origin card links as discussion links", () => {
    window.history.replaceState({}, "", "/search")
    document.body.innerHTML = buildSameOriginGridMarkup()

    const session = new SemanticCaptureSession(document, window)
    session.initialize()
    const card = document.querySelectorAll(".result-card")[1]
    expect(card).toBeTruthy()

    const result = session.captureSnapshot({
      source: "popup",
      activeElement: card ?? document.body,
      selection: window.getSelection(),
      triggerTarget: card ?? null,
      selectedElement: card ?? null,
      lastHoveredElement: card ?? null
    })

    expect(result.error).toBeNull()
    expect(result.snapshot?.focus.node).toMatchObject({
      kind: "content",
      attributes: expect.objectContaining({
        primaryHref: expect.stringContaining("/docs/guide-2")
      })
    })
    expect((result.snapshot?.focus.node as { attributes?: Record<string, string> }).attributes?.discussionHref).toBeUndefined()

    session.dispose()
  })

  it("avoids repeated-item focus for short prose reading lists", () => {
    window.history.replaceState({}, "", "/blog/semantic-systems")
    document.body.innerHTML = buildProseListNegativeMarkup()

    const session = new SemanticCaptureSession(document, window)
    session.initialize()

    const readingLink = document.querySelector(".related-reading a")
    expect(readingLink).toBeTruthy()

    const result = session.captureSnapshot({
      source: "command",
      activeElement: document.body,
      selection: window.getSelection(),
      triggerTarget: readingLink ?? null,
      selectedElement: null,
      lastHoveredElement: readingLink ?? null
    })

    expect(result.error).toBeNull()
    expect(session.getSkeleton()?.regions.some((region) => region.primitive === "repeated-item")).toBe(false)
    expect(result.snapshot?.focus.region).toBe("authored-block-1")

    session.dispose()
  })

  it("assigns layout roles and suppression metadata for docs layouts", () => {
    window.history.replaceState({}, "", "/guide")
    document.body.innerHTML = buildDocsLayoutMarkup()

    const session = new SemanticCaptureSession(document, window)
    session.initialize()

    expect(document.querySelector("article h1")?.getAttribute("data-semantic-layout-role")).toBe("main-content")
    expect(document.querySelector("article h1")?.getAttribute("data-semantic-role-rank")).toBe("primary")
    expect(document.querySelector("aside nav a")?.getAttribute("data-semantic-layout-role")).toBe("section-nav")
    expect(document.querySelector("aside nav a")?.getAttribute("data-semantic-auto-suppressed")).toBe("true")
    expect(document.querySelector("footer nav a")?.getAttribute("data-semantic-layout-role")).toBe("footer-resources")
    expect(document.querySelector("footer nav a")?.getAttribute("data-semantic-auto-suppressed")).toBe("true")
    expect(document.querySelector("#layout-q")?.getAttribute("data-semantic-layout-role")).toBe("search-bar")
    expect(document.querySelector("#layout-q")?.getAttribute("data-semantic-auto-suppressed")).toBe("true")

    session.dispose()
  })

  it("skips suppressed regions for auto focus but allows explicit selection", () => {
    window.history.replaceState({}, "", "/guide")
    document.body.innerHTML = buildDocsLayoutMarkup()

    const session = new SemanticCaptureSession(document, window)
    session.initialize()

    const footerLink = document.querySelector("footer nav a")
    expect(footerLink).toBeTruthy()
    const autoResult = session.captureSnapshot({
      source: "command",
      activeElement: document.body,
      selection: window.getSelection(),
      triggerTarget: footerLink ?? null,
      selectedElement: null,
      lastHoveredElement: footerLink ?? null
    })

    expect(autoResult.error).toBeNull()
    expect(autoResult.snapshot?.focus.region).toBe("authored-block-1")

    const searchInput = document.querySelector("#layout-q")
    expect(searchInput).toBeTruthy()
    const explicitResult = session.captureSnapshot({
      source: "command",
      activeElement: document.body,
      selection: window.getSelection(),
      triggerTarget: searchInput ?? null,
      selectedElement: searchInput ?? null,
      lastHoveredElement: null
    })

    expect(explicitResult.error).toBeNull()
    expect(explicitResult.snapshot?.focus.region).toBe("interactive-block-1")
    expect(explicitResult.snapshot?.focus.node).toMatchObject({
      kind: "interactive",
      controlType: "group",
      label: "Docs search",
      action: "search"
    })

    session.dispose()
  })
})
