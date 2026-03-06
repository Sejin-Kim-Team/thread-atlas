import { describe, expect, it } from "vitest"
import {
  deriveSelectedText,
  parseCommentsFromDocument,
  parseThreadDocFromDocument,
  parseVisibleComments,
  selectionFromWindow
} from "../src/content/content-hn-utils"

function buildDocument() {
  const parser = new DOMParser()
  return parser.parseFromString(
    `
      <!doctype html>
      <html>
        <body>
          <div class="titleline"><a href="https://example.com/article">Thread Title</a></div>
          <span class="hnuser">submitter</span>
          <span class="score">123 points</span>
          <table>
            <tr class="athing comtr" id="c1">
              <td class="ind" indent="0"></td>
              <td class="default"><a class="hnuser">alice</a><div class="commtext">first comment text</div></td>
            </tr>
            <tr class="athing comtr" id="c2">
              <td class="ind" indent="1"></td>
              <td class="default"><a class="hnuser">bob</a><div class="commtext">second comment text</div></td>
            </tr>
          </table>
        </body>
      </html>
    `,
    "text/html"
  )
}

describe("content-hn utils", () => {
  it("parses thread doc shape", () => {
    const dom = buildDocument()
    const parsed = parseThreadDocFromDocument(dom, "https://news.ycombinator.com/item?id=1")

    expect(parsed.title).toBe("Thread Title")
    expect(parsed.comments).toHaveLength(2)
    expect(parsed.comments[0]?.id).toBe("c1")
    expect(parsed.comments[1]?.depth).toBe(1)
    expect(parsed.comments[1]?.parentId).toBe("c1")
  })

  it("filters visible comments", () => {
    const dom = buildDocument()
    const rows = Array.from(dom.querySelectorAll("tr.athing.comtr"))

    const visible = parseVisibleComments(rows, 100, (row) => {
      if (row.getAttribute("id") === "c1") {
        return { top: 10, bottom: 50 }
      }
      return { top: 200, bottom: 260 }
    })

    expect(visible).toHaveLength(1)
    expect(visible[0]?.commentId).toBe("c1")
  })

  it("creates selection context windows", () => {
    const fullText = "0123456789 ".repeat(30)
    const selected = "0123456789"
    const around = deriveSelectedText(fullText, selected)

    expect(around.length).toBeGreaterThan(selected.length)
  })

  it("parses selection object", () => {
    const dom = buildDocument()
    document.body.innerHTML = ""
    document.body.innerHTML = dom.body.innerHTML

    const range = document.createRange()
    const target = document.querySelector(".commtext")?.firstChild
    expect(target).toBeTruthy()

    range.setStart(target as Text, 0)
    range.setEnd(target as Text, 5)

    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    const parsed = selectionFromWindow(selection)

    expect(parsed?.text).toBe("first")
    expect(parsed?.commentId).toBe("c1")
  })

  it("parses comments from document", () => {
    const dom = buildDocument()
    const comments = parseCommentsFromDocument(dom)
    expect(comments.length).toBeGreaterThanOrEqual(2)
  })
})
