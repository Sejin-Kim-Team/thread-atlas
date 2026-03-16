import { marked } from "marked"

const ALLOWED_TAGS = new Set(["p", "ul", "ol", "li", "strong", "em", "code", "pre", "blockquote", "a", "br"])
const STRIP_CONTENT_TAGS = new Set(["script", "style", "iframe", "object", "embed"])
const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"])

function sanitizeHref(href: string): string | null {
  const normalized = href.trim()
  if (!normalized) {
    return null
  }
  if (normalized.startsWith("#")) {
    return normalized
  }

  try {
    const url = new URL(normalized, "https://threadatlas.invalid")
    if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
      return null
    }
    return normalized.startsWith("/") ? url.pathname + url.search + url.hash : url.href
  } catch {
    return null
  }
}

function sanitizeNode(node: Node, targetDocument: Document): Node | null {
  if (node.nodeType === Node.TEXT_NODE) {
    return targetDocument.createTextNode(node.textContent ?? "")
  }

  if (!(node instanceof Element)) {
    return null
  }

  const tagName = node.tagName.toLowerCase()
  if (STRIP_CONTENT_TAGS.has(tagName)) {
    return null
  }

  const children = Array.from(node.childNodes)
    .map((child) => sanitizeNode(child, targetDocument))
    .filter((child): child is Node => child !== null)

  if (!ALLOWED_TAGS.has(tagName)) {
    const fragment = targetDocument.createDocumentFragment()
    for (const child of children) {
      fragment.appendChild(child)
    }
    return fragment
  }

  const element = targetDocument.createElement(tagName)
  if (tagName === "a") {
    const href = sanitizeHref(node.getAttribute("href") ?? "")
    if (href) {
      element.setAttribute("href", href)
      element.setAttribute("target", "_blank")
      element.setAttribute("rel", "noreferrer noopener")
    }
  }

  for (const child of children) {
    element.appendChild(child)
  }

  return element
}

export function renderAssistantMarkdownFragment(markdown: string, targetDocument: Document = document): DocumentFragment {
  const html = marked.parse(markdown, {
    async: false,
    breaks: true
  }) as string

  const parsed = new DOMParser().parseFromString(html, "text/html")
  const fragment = targetDocument.createDocumentFragment()
  for (const child of Array.from(parsed.body.childNodes)) {
    const sanitized = sanitizeNode(child, targetDocument)
    if (sanitized) {
      fragment.appendChild(sanitized)
    }
  }
  return fragment
}
