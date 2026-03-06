import type { CanonicalRegionDumpEntry } from "../../src/content/semantic/core/observability"

export type CorpusScenarioId =
  | "hn-front"
  | "hn-item"
  | "docs-landing"
  | "docs-article"
  | "search-grid"
  | "prose-list-negative"

export interface RegionMatchExpectation
  extends Partial<
    Pick<
      CanonicalRegionDumpEntry,
      "id" | "primitive" | "subtype" | "category" | "layoutRole" | "roleRank" | "normalizedKind" | "assembledItemCount"
    >
  > {}

export interface CorpusScenario {
  id: CorpusScenarioId
  url: string
  html: string
  coreExpectations: {
    requiredRegionMatches?: RegionMatchExpectation[]
    forbiddenRegionMatches?: RegionMatchExpectation[]
  }
}

function buildHnFrontMarkup(): string {
  return `
    <header>
      <nav aria-label="HN global">
        <a href="/">new</a>
        <a href="/front">front</a>
        <a href="/best">best</a>
      </nav>
    </header>
    <main>
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
    </main>
    <footer>
      <nav aria-label="Footer">
        <a href="/guidelines">Guidelines</a>
        <a href="/faq">FAQ</a>
        <a href="/lists">Lists</a>
      </nav>
      <form role="search" aria-label="Footer search">
        <input type="search" value="vector index" />
      </form>
    </footer>
  `
}

function buildHnItemMarkup(): string {
  return `
    <main>
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
    </main>
  `
}

function buildDocsLandingMarkup(): string {
  return `
    <header>
      <nav aria-label="Global">
        <a href="/home">Home</a>
        <a href="/docs">Docs</a>
        <a href="/pricing">Pricing</a>
      </nav>
      <form role="search" aria-label="Docs search">
        <label for="docs-q">Search docs</label>
        <input id="docs-q" type="search" name="query" value="pipeline" placeholder="Search docs" />
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
          <p>This page combines authored content, supporting links, and card-style sections.</p>
          <p>The main article body should stay separate from the supporting card grid below.</p>
        </article>
        <section class="docs-card-grid">
          <article class="result-card">
            <a href="/docs/getting-started">Getting Started</a>
            <p>Set up the runtime and ship your first agent flow.</p>
          </article>
          <article class="result-card">
            <a href="/docs/context-pack">Context Pack</a>
            <p>Understand the derived IR and projection formats.</p>
          </article>
          <article class="result-card">
            <a href="/docs/observability">Observability</a>
            <p>Inspect region dumps and compare scenario regressions.</p>
          </article>
        </section>
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

function buildDocsArticleMarkup(): string {
  return `
    <header>
      <nav aria-label="Global">
        <a href="/home">Home</a>
        <a href="/docs">Docs</a>
      </nav>
    </header>
    <div class="docs-layout">
      <aside>
        <nav aria-label="Guide Sections">
          <a href="/docs/guide/intro">Intro</a>
          <a href="/docs/guide/install">Install</a>
          <a href="/docs/guide/runtime">Runtime</a>
        </nav>
      </aside>
      <main>
        <article>
          <h1>Pipeline Guide</h1>
          <p>Learn how the semantic runtime moves from detection to projection.</p>
          <h2>Assembly</h2>
          <p>Assembly combines raw candidates into semantic units that are stable enough for selection and context.</p>
          <h2>Normalization</h2>
          <p>Normalization keeps the exported snapshot compact while preserving structure and task-specific hints.</p>
        </article>
      </main>
    </div>
    <footer>
      <nav aria-label="Footer">
        <a href="/status">Status</a>
        <a href="/changelog">Changelog</a>
      </nav>
    </footer>
  `
}

function buildSearchGridMarkup(): string {
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

export const CORPUS_SCENARIOS: CorpusScenario[] = [
  {
    id: "hn-front",
    url: "https://news.ycombinator.com/",
    html: buildHnFrontMarkup(),
    coreExpectations: {
      requiredRegionMatches: [
        {
          primitive: "repeated-item",
          subtype: "flat",
          assembledItemCount: 3
        }
      ]
    }
  },
  {
    id: "hn-item",
    url: "https://news.ycombinator.com/item?id=123",
    html: buildHnItemMarkup(),
    coreExpectations: {
      requiredRegionMatches: [
        {
          primitive: "repeated-item",
          subtype: "nested",
          normalizedKind: "thread"
        }
      ]
    }
  },
  {
    id: "docs-landing",
    url: "https://example.com/docs",
    html: buildDocsLandingMarkup(),
    coreExpectations: {
      requiredRegionMatches: [
        {
          primitive: "repeated-item",
          subtype: "grid",
          assembledItemCount: 3
        }
      ]
    }
  },
  {
    id: "docs-article",
    url: "https://example.com/docs/guide/pipeline",
    html: buildDocsArticleMarkup(),
    coreExpectations: {
      requiredRegionMatches: [
        {
          primitive: "authored-block",
          normalizedKind: "article"
        }
      ]
    }
  },
  {
    id: "search-grid",
    url: "https://example.com/search",
    html: buildSearchGridMarkup(),
    coreExpectations: {
      requiredRegionMatches: [
        {
          primitive: "repeated-item",
          subtype: "grid",
          assembledItemCount: 3
        }
      ]
    }
  },
  {
    id: "prose-list-negative",
    url: "https://example.com/blog/semantic-systems",
    html: buildProseListNegativeMarkup(),
    coreExpectations: {
      forbiddenRegionMatches: [
        {
          primitive: "repeated-item"
        }
      ],
      requiredRegionMatches: [
        {
          primitive: "authored-block",
          normalizedKind: "article"
        }
      ]
    }
  }
]
