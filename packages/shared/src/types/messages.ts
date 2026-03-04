import type { Projection } from "./projection"
import type { ThreadDoc } from "./thread"
import type { ArticleContext, PageStructure } from "./article"
import type { FocusedElement, SelectedText, VisibleComment } from "./state"

export interface SensorData {
  visibleComments: VisibleComment[]
  focus: FocusedElement | null
  selection: SelectedText | null
  structure: PageStructure
  threadDoc: ThreadDoc | null
  articleUrl: string | null
}

export type SidePanelToContentMessage =
  | { type: "COLLECT_SENSORS" }
  | { type: "GET_THREAD_DOC" }
  | { type: "EXECUTE_PROJECTION"; projection: Projection }

export type ServiceWorkerToSidePanelMessage =
  | { type: "ACTIVE_TAB_CHANGED"; payload: { tabId: number; url: string; title: string } }
  | { type: "ARTICLE_INJECTED"; payload: { tabId: number; url: string } }

export type SidePanelToServiceWorkerMessage =
  | { type: "CAPTURE_VIEWPORT" }
  | { type: "REQUEST_TOKEN" }
  | { type: "REGISTER_ARTICLE_URL"; payload: { url: string; threadId: string } }
  | { type: "OPEN_TAB"; payload: { url: string; active: boolean } }

export interface ArticleContentMessage {
  type: "ARTICLE_CONTENT"
  payload: {
    url: string
    title: string
    text: string
    structure: PageStructure
    extractedAt: number
  }
}

export type AnyRuntimeMessage =
  | SidePanelToContentMessage
  | ServiceWorkerToSidePanelMessage
  | SidePanelToServiceWorkerMessage
  | ArticleContentMessage

export type SourceArticleFromGraph = Pick<ArticleContext, "url" | "title" | "text" | "structure" | "readAt">
