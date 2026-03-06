import type { CanonicalRegionDumpEntry } from "../../src/content/semantic/core/observability"

export type CorpusScenarioId =
  | "hn-front"
  | "hn-item"
  | "hn-item-deep"
  | "hn-thread-collapsed"
  | "docs-landing"
  | "docs-article"
  | "docs-sidebar-tree-negative"
  | "article-toc-negative"
  | "footer-link-cloud-negative"
  | "search-grid"
  | "dashboard-table"
  | "irregular-card-grid"
  | "prose-list-negative"
  | "filter-panel"
  | "sort-tabs"
  | "command-palette-trigger"
  | "multi-field-form"
  | "action-toolbar"
  | "search-results-with-filters"
  | "reddit-thread-prep"

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

function buildHnItemDeepMarkup(): string {
  return `
    <main>
      <table>
        <tbody>
          <tr>
            <td><a href="https://example.com/deep-thread">Deep Thread Title</a></td>
          </tr>
          <tr>
            <td><span class="subtext">221 points by submitter 2 hours ago</span></td>
          </tr>
          <tr id="deep-1">
            <td indent="0"></td>
            <td>
              <a class="hnuser">alice</a>
              <span class="age">5 hours ago</span>
              <div class="commtext">top level branch</div>
              <a href="item?id=1">parent</a>
            </td>
          </tr>
          <tr id="deep-2">
            <td indent="1"></td>
            <td>
              <a class="hnuser">bob</a>
              <span class="age">4 hours ago</span>
              <div class="commtext">nested child branch</div>
              <a href="item?id=1">reply</a>
            </td>
          </tr>
          <tr id="deep-3">
            <td indent="2"></td>
            <td>
              <a class="hnuser">carol</a>
              <span class="age">3 hours ago</span>
              <div class="commtext">grandchild branch</div>
            </td>
          </tr>
          <tr id="deep-4">
            <td indent="3"></td>
            <td>
              <a class="hnuser">dave</a>
              <span class="age">2 hours ago</span>
              <div class="commtext">great grandchild branch</div>
            </td>
          </tr>
          <tr id="deep-5">
            <td indent="1"></td>
            <td>
              <a class="hnuser">eve</a>
              <span class="age">1 hour ago</span>
              <div class="commtext">sibling branch</div>
            </td>
          </tr>
        </tbody>
      </table>
    </main>
  `
}

function buildHnThreadCollapsedMarkup(): string {
  return `
    <main>
      <table>
        <tbody>
          <tr>
            <td><a href="https://example.com/collapsed-thread">Collapsed Thread Title</a></td>
          </tr>
          <tr>
            <td><span class="subtext">145 points by submitter 3 hours ago</span></td>
          </tr>
          <tr class="comment" id="col-1">
            <td indent="0"></td>
            <td>
              <a class="hnuser">alice</a>
              <span class="age">4 hours ago</span>
              <div class="commtext">root comment</div>
              <a href="item?id=1">reply</a>
            </td>
          </tr>
          <tr class="comment" id="col-2">
            <td indent="1"></td>
            <td>
              <a class="hnuser">bob</a>
              <span class="age">3 hours ago</span>
              <div class="commtext">child comment [3 more]</div>
              <a href="item?id=1">parent</a>
              <a href="item?id=2">root</a>
            </td>
          </tr>
          <tr class="comment" id="col-3">
            <td indent="2"></td>
            <td>
              <a class="hnuser">carol</a>
              <span class="age">2 hours ago</span>
              <div class="commtext">visible reply in collapsed branch</div>
            </td>
          </tr>
          <tr>
            <td></td>
            <td>
              <form aria-label="Add comment">
                <textarea name="comment">reply text</textarea>
                <button type="submit">Add comment</button>
              </form>
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

function buildDocsSidebarTreeNegativeMarkup(): string {
  return `
    <div class="docs-layout">
      <aside>
        <nav aria-label="Docs sidebar">
          <ul class="sidebar-tree">
            <li>
              <a href="/docs/intro">Intro</a>
              <ul>
                <li><a href="/docs/intro/overview">Overview</a></li>
                <li><a href="/docs/intro/install">Install</a></li>
              </ul>
            </li>
            <li>
              <a href="/docs/runtime">Runtime</a>
              <ul>
                <li><a href="/docs/runtime/session">Session</a></li>
                <li><a href="/docs/runtime/context">Context</a></li>
              </ul>
            </li>
            <li><a href="/docs/api">API</a></li>
          </ul>
        </nav>
      </aside>
      <main>
        <article>
          <h1>Docs sidebar negative</h1>
          <p>The sidebar is a navigation tree and should remain navigation, not a repeated content thread.</p>
        </article>
      </main>
    </div>
  `
}

function buildArticleTocNegativeMarkup(): string {
  return `
    <main>
      <article>
        <h1>Architecture Notes</h1>
        <nav aria-label="Table of contents">
          <ul class="toc-list">
            <li><a href="#intro">Intro</a></li>
            <li>
              <a href="#pipeline">Pipeline</a>
              <ul>
                <li><a href="#detection">Detection</a></li>
                <li><a href="#assembly">Assembly</a></li>
              </ul>
            </li>
            <li><a href="#projection">Projection</a></li>
          </ul>
        </nav>
        <h2 id="intro">Intro</h2>
        <p>This is a longform article that should stay an authored block.</p>
        <h2 id="pipeline">Pipeline</h2>
        <p>The table of contents should not become a repeated comment thread.</p>
      </article>
    </main>
  `
}

function buildFooterLinkCloudNegativeMarkup(): string {
  return `
    <main>
      <article>
        <h1>Release Notes</h1>
        <p>Main article content stays primary.</p>
        <p>Footer resources should remain suppressed navigation clusters.</p>
      </article>
    </main>
    <footer>
      <div class="footer-columns">
        <ul class="resource-links">
          <li><a href="/guides/getting-started">Getting started</a></li>
          <li><a href="/guides/runtime">Runtime</a></li>
          <li><a href="/guides/context">Context</a></li>
        </ul>
        <ul class="resource-links">
          <li><a href="/company/about">About</a></li>
          <li><a href="/company/careers">Careers</a></li>
          <li><a href="/company/contact">Contact</a></li>
        </ul>
        <ul class="resource-links">
          <li><a href="/legal/privacy">Privacy</a></li>
          <li><a href="/legal/terms">Terms</a></li>
          <li><a href="/legal/security">Security</a></li>
        </ul>
      </div>
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

function buildDashboardTableMarkup(): string {
  return `
    <main>
      <section class="dashboard-table">
        <table>
          <tbody>
            <tr>
              <td><strong>Northwind</strong></td>
              <td><span class="meta">Owner: Alice</span></td>
              <td><span class="status">Healthy</span></td>
            </tr>
            <tr>
              <td><strong>Atlas API</strong></td>
              <td><span class="meta">Owner: Bob</span></td>
              <td><span class="status">At risk</span></td>
            </tr>
            <tr>
              <td><strong>Search Worker</strong></td>
              <td><span class="meta">Owner: Carol</span></td>
              <td><span class="status">Healthy</span></td>
            </tr>
            <tr>
              <td><strong>Billing Sync</strong></td>
              <td><span class="meta">Owner: Dave</span></td>
              <td><span class="status">Paused</span></td>
            </tr>
          </tbody>
        </table>
      </section>
    </main>
  `
}

function buildIrregularCardGridMarkup(): string {
  return `
    <section class="catalog-grid">
      <article class="catalog-card featured">
        <img src="https://example.com/a.png" alt="" />
        <h2><a href="https://example.com/alpha">Alpha</a></h2>
        <p>Primary result card with image, heading, and action.</p>
        <button type="button">Open</button>
      </article>
      <div class="catalog-card compact">
        <h3><a href="https://example.com/beta">Beta</a></h3>
        <p>Compact card with shorter summary text and no image.</p>
        <button type="button">Inspect</button>
      </div>
      <article class="catalog-card">
        <h2><a href="https://example.com/gamma">Gamma</a></h2>
        <p>Another card with a long description that still belongs in the same grid.</p>
        <button type="button">Compare</button>
      </article>
      <div class="catalog-card">
        <h3><a href="https://example.com/delta">Delta</a></h3>
        <p>Utility text and CTA density vary per card in this fixture.</p>
        <button type="button">Details</button>
      </div>
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

function buildFilterPanelMarkup(): string {
  return `
    <aside>
      <form aria-label="Filter results" class="filter-panel">
        <fieldset>
          <legend>Filter results</legend>
          <label><input type="checkbox" name="open-source" checked /> Open source</label>
          <label><input type="checkbox" name="enterprise" /> Enterprise</label>
          <label><input type="checkbox" name="starter" /> Starter tier</label>
          <button type="submit">Apply filters</button>
        </fieldset>
      </form>
    </aside>
  `
}

function buildSortTabsMarkup(): string {
  return `
    <div role="tablist" aria-label="Sort results">
      <button role="tab" aria-selected="true">Relevance</button>
      <button role="tab" aria-selected="false">Newest</button>
      <button role="tab" aria-selected="false">Top rated</button>
    </div>
  `
}

function buildCommandPaletteTriggerMarkup(): string {
  return `
    <header>
      <div role="toolbar" aria-label="Command palette">
        <button type="button" aria-label="Search docs">Search docs</button>
        <button type="button" aria-label="Toggle theme">Toggle theme</button>
      </div>
    </header>
  `
}

function buildMultiFieldFormMarkup(): string {
  return `
    <main>
      <form aria-label="Contact sales">
        <label for="name">Name</label>
        <input id="name" type="text" name="name" value="Kim" />
        <label for="email">Work email</label>
        <input id="email" type="email" name="email" value="kim@example.com" />
        <label for="company">Company</label>
        <textarea id="company" name="company">ThreadAtlas</textarea>
        <button type="submit">Request demo</button>
      </form>
    </main>
  `
}

function buildActionToolbarMarkup(): string {
  return `
    <header>
      <div role="toolbar" aria-label="Page actions">
        <button type="button" aria-label="Share">Share</button>
        <button type="button" aria-label="Copy link">Copy link</button>
        <button type="button" aria-label="Open settings">Settings</button>
      </div>
    </header>
  `
}

function buildSearchResultsWithFiltersMarkup(): string {
  return `
    <header>
      <form role="search" aria-label="Search docs">
        <label for="q">Search docs</label>
        <input id="q" type="search" name="query" value="semantic runtime" placeholder="Search docs" />
        <button type="submit">Search</button>
      </form>
    </header>
    <div class="search-layout">
      <aside>
        <form aria-label="Filter results" class="filter-panel">
          <fieldset>
            <legend>Filter results</legend>
            <label><input type="checkbox" name="guides" checked /> Guides</label>
            <label><input type="checkbox" name="api" /> API reference</label>
            <label><input type="checkbox" name="blog" /> Blog</label>
          </fieldset>
        </form>
      </aside>
      <main>
        <section class="results-grid">
          <article class="result-card">
            <a href="https://example.com/docs/runtime">Runtime guide</a>
            <p>Learn how the semantic runtime moves from detection to projection.</p>
          </article>
          <article class="result-card">
            <a href="https://example.com/docs/context">Context pack</a>
            <p>Use context packs to build compact and stable projections.</p>
          </article>
          <article class="result-card">
            <a href="https://example.com/docs/selection">Selection mode</a>
            <p>Understand focus resolution and scope coverage hints.</p>
          </article>
        </section>
      </main>
    </div>
  `
}

function buildRedditThreadPrepMarkup(): string {
  return `
    <main>
      <ul class="reddit-thread">
        <li class="comment" id="reddit-1">
          <a class="author" href="/u/alice">alice</a>
          <div class="comment-body">top level reddit comment</div>
          <button type="button">reply</button>
          <ul>
            <li class="comment" id="reddit-2">
              <a class="author" href="/u/bob">bob</a>
              <div class="comment-body">nested reddit reply</div>
              <button type="button">reply</button>
              <ul>
                <li class="comment" id="reddit-3">
                  <a class="author" href="/u/carol">carol</a>
                  <div class="comment-body">deep reply [2 more replies]</div>
                  <button type="button">reply</button>
                </li>
              </ul>
            </li>
            <li class="comment" id="reddit-4">
              <a class="author" href="/u/dave">dave</a>
              <div class="comment-body">sibling branch reply</div>
              <button type="button">reply</button>
            </li>
          </ul>
        </li>
      </ul>
    </main>
  `
}

export function getCorpusScenario(id: CorpusScenarioId): CorpusScenario {
  const scenario = CORPUS_SCENARIOS.find((entry) => entry.id === id)
  if (!scenario) {
    throw new Error(`Unknown corpus scenario: ${id}`)
  }
  return scenario
}

export const CORPUS_SCENARIOS: CorpusScenario[] = [
  {
    id: "hn-front",
    url: "https://news.ycombinator.com/",
    html: buildHnFrontMarkup(),
    coreExpectations: {
      requiredRegionMatches: [{ primitive: "repeated-item", subtype: "flat", assembledItemCount: 3 }]
    }
  },
  {
    id: "hn-item",
    url: "https://news.ycombinator.com/item?id=123",
    html: buildHnItemMarkup(),
    coreExpectations: {
      requiredRegionMatches: [{ primitive: "repeated-item", subtype: "nested", normalizedKind: "thread" }]
    }
  },
  {
    id: "hn-item-deep",
    url: "https://news.ycombinator.com/item?id=456",
    html: buildHnItemDeepMarkup(),
    coreExpectations: {
      requiredRegionMatches: [{ primitive: "repeated-item", subtype: "nested", normalizedKind: "thread" }]
    }
  },
  {
    id: "hn-thread-collapsed",
    url: "https://news.ycombinator.com/item?id=789",
    html: buildHnThreadCollapsedMarkup(),
    coreExpectations: {
      requiredRegionMatches: [{ primitive: "repeated-item", subtype: "nested", normalizedKind: "thread" }]
    }
  },
  {
    id: "docs-landing",
    url: "https://example.com/docs",
    html: buildDocsLandingMarkup(),
    coreExpectations: {
      requiredRegionMatches: [{ primitive: "repeated-item", subtype: "grid", assembledItemCount: 3 }]
    }
  },
  {
    id: "docs-article",
    url: "https://example.com/docs/guide/pipeline",
    html: buildDocsArticleMarkup(),
    coreExpectations: {
      requiredRegionMatches: [{ primitive: "authored-block", normalizedKind: "article" }]
    }
  },
  {
    id: "docs-sidebar-tree-negative",
    url: "https://example.com/docs/sidebar",
    html: buildDocsSidebarTreeNegativeMarkup(),
    coreExpectations: {
      forbiddenRegionMatches: [{ primitive: "repeated-item" }],
      requiredRegionMatches: [{ primitive: "navigation-cluster", layoutRole: "section-nav" }]
    }
  },
  {
    id: "article-toc-negative",
    url: "https://example.com/blog/architecture",
    html: buildArticleTocNegativeMarkup(),
    coreExpectations: {
      forbiddenRegionMatches: [{ primitive: "repeated-item" }],
      requiredRegionMatches: [{ primitive: "authored-block", normalizedKind: "article" }]
    }
  },
  {
    id: "footer-link-cloud-negative",
    url: "https://example.com/blog/release-notes",
    html: buildFooterLinkCloudNegativeMarkup(),
    coreExpectations: {
      forbiddenRegionMatches: [{ primitive: "repeated-item" }],
      requiredRegionMatches: [{ primitive: "navigation-cluster", layoutRole: "footer-resources" }]
    }
  },
  {
    id: "search-grid",
    url: "https://example.com/search",
    html: buildSearchGridMarkup(),
    coreExpectations: {
      requiredRegionMatches: [{ primitive: "repeated-item", subtype: "grid", assembledItemCount: 3 }]
    }
  },
  {
    id: "dashboard-table",
    url: "https://example.com/dashboard/projects",
    html: buildDashboardTableMarkup(),
    coreExpectations: {
      requiredRegionMatches: [{ primitive: "repeated-item", subtype: "flat", assembledItemCount: 4 }]
    }
  },
  {
    id: "irregular-card-grid",
    url: "https://example.com/catalog",
    html: buildIrregularCardGridMarkup(),
    coreExpectations: {
      requiredRegionMatches: [{ primitive: "repeated-item", subtype: "grid", assembledItemCount: 4 }]
    }
  },
  {
    id: "prose-list-negative",
    url: "https://example.com/blog/semantic-systems",
    html: buildProseListNegativeMarkup(),
    coreExpectations: {
      forbiddenRegionMatches: [{ primitive: "repeated-item" }],
      requiredRegionMatches: [{ primitive: "authored-block", normalizedKind: "article" }]
    }
  },
  {
    id: "filter-panel",
    url: "https://example.com/search/filters",
    html: buildFilterPanelMarkup(),
    coreExpectations: {
      requiredRegionMatches: [{ primitive: "interactive-block", subtype: "filter", category: "interactive.filter" }]
    }
  },
  {
    id: "sort-tabs",
    url: "https://example.com/search/sort",
    html: buildSortTabsMarkup(),
    coreExpectations: {
      requiredRegionMatches: [{ primitive: "interactive-block", subtype: "sort", category: "interactive.sort" }]
    }
  },
  {
    id: "command-palette-trigger",
    url: "https://example.com/docs/command",
    html: buildCommandPaletteTriggerMarkup(),
    coreExpectations: {
      requiredRegionMatches: [{ primitive: "interactive-block", subtype: "search", category: "interactive.search" }]
    }
  },
  {
    id: "multi-field-form",
    url: "https://example.com/contact",
    html: buildMultiFieldFormMarkup(),
    coreExpectations: {
      requiredRegionMatches: [{ primitive: "interactive-block", subtype: "form", category: "interactive.form" }]
    }
  },
  {
    id: "action-toolbar",
    url: "https://example.com/actions",
    html: buildActionToolbarMarkup(),
    coreExpectations: {
      requiredRegionMatches: [{ primitive: "interactive-block", subtype: "action-group", category: "interactive.action" }]
    }
  },
  {
    id: "search-results-with-filters",
    url: "https://example.com/search?q=semantic",
    html: buildSearchResultsWithFiltersMarkup(),
    coreExpectations: {
      requiredRegionMatches: [
        { primitive: "interactive-block", subtype: "search", category: "interactive.search" },
        { primitive: "interactive-block", subtype: "filter", category: "interactive.filter" },
        { primitive: "repeated-item", subtype: "grid", assembledItemCount: 3 }
      ]
    }
  },
  {
    id: "reddit-thread-prep",
    url: "https://example.com/r/programming/comments/abc123/thread",
    html: buildRedditThreadPrepMarkup(),
    coreExpectations: {
      requiredRegionMatches: [{ primitive: "repeated-item", subtype: "nested", normalizedKind: "thread" }]
    }
  }
]
