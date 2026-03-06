import {
  htmlToMarkdownAST,
  type ConversionOptions,
  type SemanticMarkdownAST
} from "dom-to-semantic-markdown"
import type { ContentNode } from "@threadatlas/shared"
import { extractReadableText, normalizeText } from "./text"

export const GENERIC_ARTICLE_BLOCK_SELECTOR = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "blockquote",
  "pre",
  "code",
  "ul",
  "ol",
  "img",
  "figure"
].join(",")

function flattenContent(content: string | SemanticMarkdownAST[]): string {
  if (typeof content === "string") {
    return content
  }

  return content.map((node) => semanticAstToText(node)).filter(Boolean).join(" ")
}

function inferNodeTypeFromTag(element: Element): ContentNode["type"] {
  const tag = element.tagName.toLowerCase()
  if (/^h[1-6]$/.test(tag)) {
    return "heading"
  }
  if (tag === "blockquote") {
    return "quote"
  }
  if (tag === "pre" || tag === "code") {
    return "code"
  }
  if (tag === "ul" || tag === "ol") {
    return "list"
  }
  if (tag === "img" || tag === "figure") {
    return "image"
  }
  if (tag === "a") {
    return "link"
  }
  return "paragraph"
}

function inferNodeTypeFromAst(ast: SemanticMarkdownAST[], element: Element): ContentNode["type"] {
  const primaryNode = ast[0]
  if (!primaryNode) {
    return inferNodeTypeFromTag(element)
  }

  switch (primaryNode.type) {
    case "heading":
      return "heading"
    case "blockquote":
      return "quote"
    case "code":
      return "code"
    case "list":
      return "list"
    case "image":
      return "image"
    case "link":
      return "link"
    default:
      return inferNodeTypeFromTag(element)
  }
}

export class SemanticASTBuilder {
  build(element: Element, options: ConversionOptions = {}): SemanticMarkdownAST[] {
    return buildSemanticAst(element, options)
  }

  toContentNodes(ast: SemanticMarkdownAST[]): ContentNode[] {
    const nodes: ContentNode[] = []

    for (const [index, node] of ast.entries()) {
      const text = semanticAstToText(node)
      const normalized = normalizeText(text, { preserveLineBreaks: true })
      if (!normalized) {
        continue
      }

      nodes.push({
        kind: "content",
        id: `ast-node-${index + 1}`,
        type: node.type === "heading" ? "heading" : node.type === "blockquote" ? "quote" : "paragraph",
        text: normalized,
        ...(node.type === "heading" ? { level: node.level } : {})
      })
    }

    return nodes
  }
}

export function buildSemanticAst(element: Element, options: ConversionOptions = {}): SemanticMarkdownAST[] {
  return htmlToMarkdownAST(element, {
    extractMainContent: false,
    ...options
  })
}

export function semanticAstToText(node: SemanticMarkdownAST | SemanticMarkdownAST[]): string {
  if (Array.isArray(node)) {
    return normalizeText(node.map((item) => semanticAstToText(item)).filter(Boolean).join("\n"), {
      preserveLineBreaks: true
    })
  }

  switch (node.type) {
    case "text":
      return node.content
    case "heading":
    case "bold":
    case "italic":
    case "strikethrough":
      return flattenContent(node.content)
    case "link":
      return semanticAstToText(node.content)
    case "list":
      return node.items.map((item) => semanticAstToText(item.content)).join("\n")
    case "blockquote":
    case "semanticHtml":
      return node.content.map((item) => semanticAstToText(item)).join("\n")
    case "code":
      return node.content
    case "image":
      return node.alt ?? ""
    case "video":
      return node.poster ?? node.src
    case "table":
      return node.rows
        .map((row) =>
          row.cells
            .map((cell) =>
              typeof cell.content === "string" ? cell.content : semanticAstToText(cell.content)
            )
            .join(" | ")
        )
        .join("\n")
    case "custom":
      return typeof node.content === "string" ? node.content : ""
    case "meta":
      return ""
    default:
      return ""
  }
}

export function mapElementToContentNode(element: Element, nodeId: string): ContentNode | null {
  const ast = buildSemanticAst(element)
  const textFromAst = semanticAstToText(ast)
  const text = textFromAst || extractReadableText(element, { preserveLineBreaks: true })
  const normalized = normalizeText(text, { preserveLineBreaks: true })

  if (!normalized && element.tagName.toLowerCase() !== "img") {
    return null
  }

  const type = inferNodeTypeFromAst(ast, element)
  const node: ContentNode = {
    kind: "content",
    id: nodeId,
    type,
    text: normalized || element.getAttribute("alt") || ""
  }

  if (type === "heading") {
    node.level = Number.parseInt(element.tagName.slice(1), 10) as 1 | 2 | 3 | 4 | 5 | 6
  }

  if (type === "code") {
    const className = element.getAttribute("class") ?? ""
    const languageMatch = className.match(/language-([\w-]+)/i)
    if (languageMatch?.[1]) {
      node.language = languageMatch[1]
    }
  }

  if (type === "image") {
    const imageElement = element.tagName.toLowerCase() === "img" ? element : element.querySelector("img")
    const src = imageElement?.getAttribute("src")
    const alt = imageElement?.getAttribute("alt")
    if (src || alt) {
      node.attributes = {
        ...(src ? { src } : {}),
        ...(alt ? { alt } : {})
      }
    }
  }

  if (type === "link") {
    const href = element.getAttribute("href") ?? element.querySelector("a")?.getAttribute("href")
    if (href) {
      node.attributes = { href }
    }
  }

  return node
}

export function collectArticleBlockElements(root: Element): Element[] {
  const blocks = root.matches(GENERIC_ARTICLE_BLOCK_SELECTOR) ? [root] : []
  blocks.push(...Array.from(root.querySelectorAll(GENERIC_ARTICLE_BLOCK_SELECTOR)))

  return blocks.filter((element, index, all) => {
    if (index === 0) {
      return true
    }

    return !all.some((candidate, candidateIndex) => {
      return candidateIndex < index && candidate !== element && candidate.contains(element)
    })
  })
}

export function annotateContentNodes(root: Element, prefix: string): Element[] {
  const blocks = collectArticleBlockElements(root)
  blocks.forEach((element, index) => {
    element.setAttribute("data-semantic-node-id", `${prefix}-${index + 1}`)
  })
  return blocks
}
