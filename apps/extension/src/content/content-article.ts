import type { PageStructure } from "@threadatlas/shared"

export function extractMainText(doc: Document = document): string {
  const root =
    doc.querySelector("article") ??
    doc.querySelector("main") ??
    doc.querySelector("[role='main']") ??
    doc.body

  return (root?.textContent ?? "").slice(0, 5000)
}

export function extractStructure(doc: Document = document): PageStructure {
  const headings = Array.from(doc.querySelectorAll("h1,h2,h3,h4,h5,h6")).map((heading) => ({
    level: Number.parseInt(heading.tagName.slice(1), 10),
    text: (heading.textContent ?? "").trim().slice(0, 100)
  }))

  const landmarks = Array.from(doc.querySelectorAll("[role]"))
    .filter((element) => ["main", "article", "navigation", "complementary"].includes(element.getAttribute("role") ?? ""))
    .map((element) => ({
      role: element.getAttribute("role") ?? "",
      label: element.getAttribute("aria-label") ?? ""
    }))

  return {
    headings,
    landmarks,
    commentCount: 0,
    nestingDepth: 0
  }
}

export function collectArticlePayload(doc: Document = document) {
  return {
    type: "ARTICLE_CONTENT" as const,
    payload: {
      url: window.location.href,
      title: doc.title,
      text: extractMainText(doc),
      structure: extractStructure(doc),
      extractedAt: Date.now()
    }
  }
}

if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
  chrome.runtime.sendMessage(collectArticlePayload())
}
