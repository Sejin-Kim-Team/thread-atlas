import type { ArticleContext, PageStructure } from "./article"
import type { ConversationContext } from "./context"
import type { Intent } from "./intent"
import type { ThreadSemantics } from "./semantics"

export interface VisibleComment {
  commentId: string
  author: string
  textPreview: string
  depth: number
  scoreIfAvailable: number | null
}

export interface SelectedText {
  text: string
  commentId: string | null
  surroundingContext: string
}

export interface FocusedElement {
  commentId: string | null
  text: string
  source: "hover" | "keyboard" | "proximity"
}

export interface PageContent {
  threadDoc: null
  structure: PageStructure
  visibleComments: VisibleComment[]
}

export interface StateSnapshot {
  intent: Intent
  page: {
    url: string
    title: string
    content: PageContent
  }
  user: {
    speech: string | null
    selection: SelectedText | null
    focus: FocusedElement | null
  }
  viewport: string | null
  sourceArticle: ArticleContext | null
  semantics: ThreadSemantics | null
  conversationContext: ConversationContext | null
}
