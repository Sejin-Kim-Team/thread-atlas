import { describe, expect, it } from "vitest"
import {
  buildCanonicalRegionDump,
  buildScenarioScorecard,
  compareCanonicalRegionDumps,
  type CanonicalRegionDump
} from "../src/content/semantic/core/observability"
import { SemanticPipeline } from "../src/content/semantic/core/pipeline/SemanticPipeline"

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

describe("Semantic pipeline observability", () => {
  it("records assembly merge decisions in the region dump", () => {
    window.history.replaceState({}, "", "/news")
    document.body.innerHTML = buildFrontPageMarkup()

    const pipeline = new SemanticPipeline()
    pipeline.build(document)
    const dump = pipeline.createRegionDump(document)

    expect(dump.url).toContain("/news")
    expect(dump.decisions.assemblyMerges.some((entry) => entry.includes("merged"))).toBe(true)
    expect(dump.regions.some((region) => region.nodeCount > 0)).toBe(true)
  })

  it("records containment overlap and suppression decisions in the region dump", () => {
    window.history.replaceState({}, "", "/docs")
    document.body.innerHTML = buildDocsLayoutMarkup()

    const pipeline = new SemanticPipeline()
    pipeline.build(document)
    const dump = pipeline.createRegionDump(document)

    expect(dump.decisions.overlapResolutions.length).toBeGreaterThan(0)
    expect(dump.decisions.suppressions.length).toBeGreaterThan(0)
    expect(
      dump.regions.some(
        (region) =>
          region.layoutRole === "footer-resources" &&
          region.autoSuppressed &&
          region.roleRank === "peripheral"
      )
    ).toBe(true)
  })

  it("builds stable canonical dumps and scenario scorecards", () => {
    window.history.replaceState({}, "", "/docs")
    document.body.innerHTML = buildDocsLayoutMarkup()

    const pipeline = new SemanticPipeline()
    pipeline.build(document)

    const canonicalDump = buildCanonicalRegionDump(pipeline.createRegionDump(document))
    const scorecard = buildScenarioScorecard(canonicalDump)

    expect(canonicalDump.url).toContain("/docs")
    expect(canonicalDump.regions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "authored-block-1",
          primitive: "authored-block",
          layoutRole: "main-content",
          normalizedKind: "article"
        }),
        expect.objectContaining({
          id: "interactive-block-1",
          primitive: "interactive-block",
          layoutRole: "search-bar",
          suppressed: true
        })
      ])
    )
    expect(scorecard).toMatchObject({
      regionCount: canonicalDump.regions.length,
      suppressedCount: canonicalDump.regions.filter((region) => region.suppressed).length,
      primitiveCounts: expect.objectContaining({
        "authored-block": 1,
        "interactive-block": 1
      })
    })
  })

  it("summarizes region additions and key field changes in canonical dump diffs", () => {
    const expected: CanonicalRegionDump = {
      url: "https://example.com/search",
      regions: [
        {
          id: "authored-block-1",
          primitive: "authored-block",
          subtype: "post",
          category: "content.post",
          layoutRole: "main-content",
          roleRank: "primary",
          suppressed: false,
          confidence: 0.82,
          nodeCount: 3,
          textLength: 80,
          assembledItemCount: 0,
          normalizedKind: "article"
        },
        {
          id: "navigation-cluster-2",
          primitive: "navigation-cluster",
          subtype: "global",
          category: "navigation.menu",
          layoutRole: "global-nav",
          roleRank: "peripheral",
          suppressed: true,
          confidence: 0.76,
          nodeCount: 3,
          textLength: 12,
          assembledItemCount: 0
        },
        {
          id: "repeated-item-1",
          primitive: "repeated-item",
          subtype: "grid",
          category: "content.post",
          layoutRole: "main-content",
          roleRank: "primary",
          suppressed: false,
          confidence: 0.8,
          nodeCount: 3,
          textLength: 32,
          assembledItemCount: 3,
          normalizedKind: "card"
        }
      ]
    }

    const actual: CanonicalRegionDump = {
      url: "https://example.com/search?q=cards",
      regions: [
        {
          id: "authored-block-1",
          primitive: "navigation-cluster",
          subtype: "post",
          category: "content.post",
          layoutRole: "main-content",
          roleRank: "primary",
          suppressed: false,
          confidence: 0.82,
          nodeCount: 3,
          textLength: 80,
          assembledItemCount: 0,
          normalizedKind: "article"
        },
        {
          id: "repeated-item-1",
          primitive: "repeated-item",
          subtype: "grid",
          category: "content.post",
          layoutRole: "section-nav",
          roleRank: "primary",
          suppressed: true,
          confidence: 0.8,
          nodeCount: 3,
          textLength: 32,
          assembledItemCount: 1,
          normalizedKind: "card"
        },
        {
          id: "navigation-cluster-1",
          primitive: "navigation-cluster",
          subtype: "global",
          category: "navigation.menu",
          layoutRole: "global-nav",
          roleRank: "peripheral",
          suppressed: true,
          confidence: 0.76,
          nodeCount: 3,
          textLength: 14,
          assembledItemCount: 0
        }
      ]
    }

    const comparison = compareCanonicalRegionDumps(expected, actual)

    expect(comparison.matches).toBe(false)
    expect(comparison.summary).toEqual(
      expect.arrayContaining([
        "url changed: https://example.com/search -> https://example.com/search?q=cards",
        "suppressed count changed: 1 -> 2",
        "assembly count changed: 3 -> 1",
        "region removed: navigation-cluster-2",
        "region added: navigation-cluster-1",
        "primitive changed for authored-block-1: authored-block -> navigation-cluster",
        "layout role changed for repeated-item-1: main-content -> section-nav",
        "suppressed changed for repeated-item-1: false -> true",
        "assembly count changed for repeated-item-1: 3 -> 1"
      ])
    )
  })
})
