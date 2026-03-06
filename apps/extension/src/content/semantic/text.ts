const BLOCK_TAGS = new Set([
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "BR",
  "CODE",
  "DIV",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "TD",
  "TH",
  "TR",
  "UL"
])

function collapseWhitespace(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ")
}

export function normalizeText(value: string, options: { preserveLineBreaks?: boolean } = {}): string {
  const { preserveLineBreaks = false } = options
  const collapsed = preserveLineBreaks
    ? collapseWhitespace(value)
        .replace(/[ \t]*\n[ \t]*/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
    : collapseWhitespace(value).replace(/\s+/g, " ")

  return collapsed.trim()
}

export function extractReadableText(
  root: Element,
  options: { preserveLineBreaks?: boolean } = {}
): string {
  const chunks: string[] = []

  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent ?? ""
      if (value.trim()) {
        chunks.push(value)
      }
      return
    }

    if (!(node instanceof root.ownerDocument.defaultView!.Element)) {
      return
    }

    if (node.tagName === "BR") {
      chunks.push("\n")
      return
    }

    const isBlock = BLOCK_TAGS.has(node.tagName)
    if (isBlock && chunks.length > 0) {
      chunks.push("\n")
    }

    for (const child of node.childNodes) {
      walk(child)
    }

    if (isBlock) {
      chunks.push("\n")
    }
  }

  walk(root)
  return normalizeText(chunks.join(""), options)
}
