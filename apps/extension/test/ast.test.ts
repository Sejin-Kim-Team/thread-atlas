import { beforeEach, describe, expect, it } from "vitest"
import {
  buildSemanticAst,
  mapElementToContentNode,
  SemanticASTBuilder,
  semanticAstToText
} from "../src/content/semantic/ast"

describe("SemanticASTBuilder", () => {
  const builder = new SemanticASTBuilder()

  beforeEach(() => {
    document.body.innerHTML = ""
  })

  it("converts heading html into heading text", () => {
    document.body.innerHTML = `<article><h1>Hello World</h1></article>`
    const article = document.querySelector("article")
    expect(article).toBeTruthy()

    const ast = buildSemanticAst(article as Element)
    expect(semanticAstToText(ast)).toContain("Hello World")
  })

  it("converts nested lists and content nodes", () => {
    document.body.innerHTML = `
      <article>
        <ul>
          <li>One</li>
          <li>Two<ul><li>Nested</li></ul></li>
        </ul>
      </article>
    `
    const list = document.querySelector("ul")
    expect(list).toBeTruthy()

    const ast = builder.build(list as Element)
    const node = mapElementToContentNode(list as Element, "list-1")
    expect(semanticAstToText(ast)).toContain("Nested")
    expect(node?.type).toBe("list")
  })

  it("maps top-level ast nodes into content nodes", () => {
    document.body.innerHTML = `<article><h2>Section</h2><p>Paragraph</p></article>`
    const ast = builder.build(document.querySelector("article") as Element)
    const nodes = builder.toContentNodes(ast)
    expect(nodes[0]?.type).toBe("heading")
    expect(nodes[0]?.text).toContain("Section")
  })
})
