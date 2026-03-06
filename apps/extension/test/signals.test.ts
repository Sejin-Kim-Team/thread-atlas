import { beforeEach, describe, expect, it } from "vitest"
import { SignalDetector } from "../src/content/semantic/signals"

describe("SignalDetector", () => {
  const detector = new SignalDetector()

  beforeEach(() => {
    document.body.innerHTML = ""
  })

  it("detects strong semantic signals from html5 landmarks", () => {
    document.body.innerHTML = `
      <main>
        <article>
          <h1>Title</h1>
          <p>Body</p>
        </article>
      </main>
    `

    const signals = detector.detect(document.body)
    expect(signals.some((signal) => signal.type === "html5-semantic")).toBe(true)
    expect(signals.some((signal) => signal.suggestedCategory === "content.article")).toBe(true)
  })

  it("detects repeated structures with depth changes", () => {
    document.body.innerHTML = `
      <table>
        <tbody>
          <tr class="athing comtr" indent="0"><td>one</td></tr>
          <tr class="athing comtr" indent="1"><td>two</td></tr>
          <tr class="athing comtr" indent="2"><td>three</td></tr>
        </tbody>
      </table>
    `

    const signals = detector.detect(document.body)
    expect(signals.some((signal) => signal.type === "repeated-structure")).toBe(true)
    expect(signals.some((signal) => signal.type === "density-boundary")).toBe(true)
  })

  it("returns no signals for empty structures", () => {
    document.body.innerHTML = `<div><div></div></div>`
    expect(detector.detect(document.body)).toEqual([])
  })
})
