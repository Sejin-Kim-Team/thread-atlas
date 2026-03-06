import type { Comment, SelectedText, ThreadDoc, VisibleComment } from "@threadatlas/shared"

export interface ParsedCommentRow {
  id: string
  author: string
  text: string
  depth: number
  parentId: string | null
  ageText: string | null
}

export function parseDepthFromRow(row: Element): number {
  const indentRaw = row.querySelector(".ind")?.getAttribute("indent")
  if (!indentRaw) {
    return 0
  }

  const parsed = Number.parseInt(indentRaw, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

export function parseCommentRows(rows: Iterable<Element>): ParsedCommentRow[] {
  const parsedRows: ParsedCommentRow[] = []
  const stack: Array<{ id: string; depth: number }> = []

  for (const row of rows) {
    const id = row.getAttribute("id") ?? ""
    const depth = parseDepthFromRow(row)

    while (stack.length > 0 && (stack.at(-1)?.depth ?? 0) >= depth) {
      stack.pop()
    }

    const parentId = stack.at(-1)?.id ?? null

    parsedRows.push({
      id,
      author: row.querySelector(".hnuser")?.textContent?.trim() ?? "",
      text: row.querySelector(".commtext")?.textContent?.trim() ?? "",
      depth,
      parentId,
      ageText: row.querySelector(".age")?.textContent?.trim() ?? null
    })

    stack.push({ id, depth })
  }

  return parsedRows
}

export function parseCommentsFromDocument(doc: Document): Comment[] {
  const commentRows = doc.querySelectorAll("tr.athing.comtr")
  return parseCommentRows(commentRows).map((row) => ({
    id: row.id,
    author: row.author,
    text: row.text,
    depth: row.depth,
    score: null,
    parentId: row.parentId,
    timestamp: Date.now()
  }))
}

export function parseThreadDocFromDocument(doc: Document, url: string): ThreadDoc {
  const title = doc.querySelector(".titleline a")?.textContent?.trim() ?? ""
  const submitter = doc.querySelector(".hnuser")?.textContent?.trim() ?? ""
  const scoreText = doc.querySelector(".score")?.textContent ?? "0"
  const score = Number.parseInt(scoreText, 10) || 0

  return {
    url,
    title,
    submitter,
    score,
    comments: parseCommentsFromDocument(doc)
  }
}

export function parseVisibleComments(
  rows: Element[],
  viewportHeight: number,
  getRect: (row: Element) => { top: number; bottom: number }
): VisibleComment[] {
  const visible: VisibleComment[] = []

  for (const row of rows) {
    const rect = getRect(row)
    if (rect.top < viewportHeight && rect.bottom > 0) {
      const text = row.querySelector(".commtext")?.textContent?.trim() ?? ""
      visible.push({
        commentId: row.getAttribute("id") ?? "",
        author: row.querySelector(".hnuser")?.textContent?.trim() ?? "",
        textPreview: text.slice(0, 150),
        depth: parseDepthFromRow(row),
        scoreIfAvailable: null
      })
    }
  }

  return visible
}

export function deriveSelectedText(fullText: string, selectedText: string): string {
  const index = fullText.indexOf(selectedText)
  if (index < 0) {
    return selectedText.slice(0, 200)
  }

  const start = Math.max(0, index - 100)
  const end = Math.min(fullText.length, index + selectedText.length + 100)
  return fullText.slice(start, end)
}

export function selectionFromWindow(selection: Selection | null): SelectedText | null {
  if (!selection || selection.isCollapsed) {
    return null
  }

  const text = selection.toString().trim()
  if (!text) {
    return null
  }

  const anchor = selection.anchorNode
  const anchorElement = anchor?.parentElement ?? null
  const row = anchorElement?.closest("tr.athing.comtr")
  const commentId = row?.getAttribute("id") ?? null
  const fullText = row?.querySelector(".commtext")?.textContent ?? ""

  return {
    text,
    commentId,
    surroundingContext: deriveSelectedText(fullText, text)
  }
}
