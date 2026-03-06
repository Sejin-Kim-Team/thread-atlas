import type {
  EnhancerContext,
  SemanticRegion,
  SemanticSkeleton,
  SiteEnhancer
} from "@threadatlas/shared/browser-runtime"
import type { SemanticSelectionTarget } from "@threadatlas/shared/runtime"
import { normalizeText } from "./text"

function isHackerNewsItemUrl(url: URL): boolean {
  return url.hostname === "news.ycombinator.com" && url.pathname === "/item"
}

function findSelectedNodeElement(
  ctx: EnhancerContext,
  selection: SemanticSelectionTarget
): Element | null {
  if (!selection.nodeId) {
    return null
  }

  return ctx.document.querySelector(
    `[data-semantic-region="${selection.regionId}"][data-semantic-node-id="${selection.nodeId}"]`
  )
}

function findCommentAuthor(element: Element | null): string | null {
  if (!element) {
    return null
  }

  const author = normalizeText(
    element.closest("tr")?.querySelector(".hnuser")?.textContent ??
      element.querySelector(".hnuser")?.textContent ??
      ""
  )
  return author || null
}

export class HackerNewsEnhancer implements SiteEnhancer {
  readonly id = "hacker-news"

  match(url: URL): boolean {
    return isHackerNewsItemUrl(url)
  }

  refineSkeleton(input: SemanticSkeleton): SemanticSkeleton {
    return {
      ...input,
      regions: input.regions.map((region) => {
        if (region.primitive === "repeated-item" && region.subtype === "nested") {
          return {
            ...region,
            category: "discussion.thread",
            displayLabel: "Thread branch"
          }
        }

        if (region.primitive === "authored-block") {
          return {
            ...region,
            category: "content.post",
            displayLabel: "Story"
          }
        }

        return region
      })
    }
  }

  refineRegion(input: SemanticRegion): SemanticRegion {
    if (input.primitive === "repeated-item" && input.subtype === "nested") {
      return {
        ...input,
        category: "discussion.thread",
        displayLabel: "Thread branch"
      }
    }

    if (input.primitive === "authored-block") {
      return {
        ...input,
        category: "content.post",
        displayLabel: "Story"
      }
    }

    return input
  }

  refineSelection(input: SemanticSelectionTarget, ctx: EnhancerContext): SemanticSelectionTarget {
    if (input.primitive === "repeated-item" && input.subtype === "nested") {
      const author = findCommentAuthor(findSelectedNodeElement(ctx, input))
      return {
        ...input,
        category: "discussion.comment",
        label: author ? `Comment by ${author}` : "Comment",
        displayLabel: author ? `Comment by ${author}` : "Comment"
      }
    }

    if (input.primitive === "authored-block") {
      return {
        ...input,
        category: "content.post",
        label: "Story",
        displayLabel: "Story"
      }
    }

    return input
  }
}
