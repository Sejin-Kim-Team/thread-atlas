import { beforeEach, describe, expect, it } from "vitest"
import { SemanticPipeline } from "../src/content/semantic/core/pipeline/SemanticPipeline"
import type { ArticleMetadata, CardMetadata, ThreadMetadata } from "../src/content/semantic/core/types"

function buildThreadNormalizationMarkup(): string {
  return `
    <table>
      <tbody>
        <tr>
          <td><a href="https://example.com/story">Thread Title</a></td>
        </tr>
        <tr>
          <td><span class="subtext">123 points by submitter 1 hour ago</span></td>
        </tr>
        <tr id="c1">
          <td indent="0"></td>
          <td>
            <a class="hnuser">alice</a>
            <span class="age">3 hours ago</span>
            <div class="commtext">root comment</div>
          </td>
        </tr>
        <tr id="c2">
          <td indent="0"></td>
          <td>
            <a class="hnuser">bob</a>
            <span class="age">2 hours ago</span>
            <div class="commtext">
              child comment [2 more]
              <a href="#c1">parent</a>
              <a href="#c1">root</a>
              <a href="#c3">next</a>
              <a href="#c1">reply</a>
            </div>
          </td>
        </tr>
        <tr id="c3">
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

function buildArticleNormalizationMarkup(): string {
  return `
    <main>
      <article>
        <h1>Building Semantic Systems</h1>
        <ul class="tag-chips">
          <li><a href="/tags/ai">AI</a></li>
          <li><a href="/tags/agents">Agents</a></li>
          <li><a href="/tags/elixir">Elixir</a></li>
        </ul>
        <p>Intro paragraph with enough text to keep the authored block meaningful and stable.</p>
        <h2>Section One</h2>
        <p>Section one body paragraph with enough detail to stay in the normalized tree.</p>
        <h2>Section Two</h2>
        <p>Section two body paragraph with enough detail to stay in the normalized tree.</p>
        <h3>Related</h3>
        <ul class="related-links">
          <li><a href="/guide/a">Guide A</a></li>
          <li><a href="/guide/b">Guide B</a></li>
        </ul>
      </article>
    </main>
  `
}

function buildCardNormalizationMarkup(): string {
  return `
    <section class="results-grid">
      <article class="result-card">
        <img src="/images/1.png" alt="Card one" />
        <a href="/docs/guide-1">Guide One</a>
        <p class="meta">Updated today</p>
        <button type="button">Open</button>
      </article>
      <article class="result-card">
        <img src="/images/2.png" alt="Card two" />
        <a href="/docs/guide-2">Guide Two</a>
        <p class="meta">Updated yesterday</p>
        <button type="button">Open</button>
      </article>
      <article class="result-card">
        <img src="/images/3.png" alt="Card three" />
        <a href="/docs/guide-3">Guide Three</a>
        <p class="meta">Updated recently</p>
        <button type="button">Open</button>
      </article>
    </section>
  `
}

describe("Semantic normalization pipeline", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "https://news.ycombinator.com/item?id=100")
  })

  it("records thread metadata and applies explicit parent/root hints", () => {
    document.body.innerHTML = buildThreadNormalizationMarkup()

    const pipeline = new SemanticPipeline()
    const { regions } = pipeline.build(document)
    const repeatedRegion = regions.find(
      (region) => region.primitive === "repeated-item" && region.subtype === "nested"
    )

    expect(repeatedRegion).toBeTruthy()

    const expanded = pipeline.expandRegion(repeatedRegion!.id, document)
    const metadata = pipeline.getState(repeatedRegion!.id)?.normalized as ThreadMetadata | undefined

    expect(expanded).toBeTruthy()
    expect(metadata).toMatchObject({
      kind: "thread",
      hasCollapsedBranches: true,
      hasReplyAffordance: true
    })
    expect(metadata?.collapsedBranchIds).toContain("repeated-item-1-item-2")
    expect(metadata?.explicitHints.map((hint) => hint.kind)).toEqual(
      expect.arrayContaining(["parent", "root", "next"])
    )
    expect(expanded?.nodes.find((node) => node.id === "repeated-item-1-item-2")).toMatchObject({
      parentId: "repeated-item-1-item-1",
      depth: 1
    })
    expect(expanded?.structure?.rootIds).toEqual(["repeated-item-1-item-1"])
  })

  it("builds article section metadata and removes tags/related navigation from body nodes", () => {
    window.history.replaceState({}, "", "/blog/semantic-systems")
    document.body.innerHTML = buildArticleNormalizationMarkup()

    const pipeline = new SemanticPipeline()
    const { regions } = pipeline.build(document)
    const authoredRegion = regions.find(
      (region) => region.primitive === "authored-block" && region.layoutRole === "main-content"
    )

    expect(authoredRegion).toBeTruthy()

    const expanded = pipeline.expandRegion(authoredRegion!.id, document)
    const metadata = pipeline.getState(authoredRegion!.id)?.normalized as ArticleMetadata | undefined

    expect(expanded).toBeTruthy()
    expect(metadata?.kind).toBe("article")
    expect(metadata?.sections.map((section) => section.title)).toEqual(
      expect.arrayContaining(["Building Semantic Systems", "Section One", "Section Two"])
    )
    expect(metadata?.tags).toEqual(expect.arrayContaining(["AI", "Agents", "Elixir"]))
    expect(metadata?.separatedNavigation).toEqual(expect.arrayContaining(["Guide A", "Guide B"]))
    expect(expanded?.nodes.some((node) => "text" in node && node.text.includes("Guide A"))).toBe(false)
    expect(
      expanded?.nodes.some(
        (node) => "text" in node && /AI[\s\n]+Agents[\s\n]+Elixir/.test(node.text)
      )
    ).toBe(false)
    expect(expanded?.structure?.rootIds).toEqual(["authored-block-1-node-1"])
  })

  it("learns card field templates and annotates repeated-item node attributes", () => {
    window.history.replaceState({}, "", "/docs")
    document.body.innerHTML = buildCardNormalizationMarkup()

    const pipeline = new SemanticPipeline()
    const { regions } = pipeline.build(document)
    const cardRegion = regions.find(
      (region) =>
        region.primitive === "repeated-item" &&
        (region.subtype === "flat" || region.subtype === "grid")
    )

    expect(cardRegion).toBeTruthy()

    const expanded = pipeline.expandRegion(cardRegion!.id, document)
    const metadata = pipeline.getState(cardRegion!.id)?.normalized as CardMetadata | undefined

    expect(metadata).toEqual({
      kind: "card",
      fieldTemplate: {
        title: "first-link",
        image: "first-image",
        metadata: "after-title",
        cta: "last-button"
      }
    })

    const firstNode = expanded?.nodes[0]
    expect(firstNode?.kind).toBe("content")
    if (firstNode?.kind === "content") {
      expect(firstNode.attributes).toMatchObject({
        primaryHref: "/docs/guide-1",
        normalizedTitle: "first-link",
        normalizedImage: "first-image",
        normalizedMetadata: "after-title",
        normalizedCta: "last-button"
      })
      expect(firstNode.attributes?.discussionHref).toBeUndefined()
    }
  })
})
