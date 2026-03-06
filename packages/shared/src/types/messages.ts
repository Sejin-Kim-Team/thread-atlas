import type { Projection } from "./projection"
import type {
  SemanticCategory,
  SemanticNodeKind,
  SemanticPrimitive,
  SemanticSnapshot
} from "./semantic-snapshot"
import type { ThreadDoc } from "./thread"
import type { ArticleContext, PageStructure } from "./article"
import type { FocusedElement, SelectedText, VisibleComment } from "./state"
import type { CaptureSource } from "./semantic-runtime"

export interface SensorData {
  visibleComments: VisibleComment[]
  focus: FocusedElement | null
  selection: SelectedText | null
  structure: PageStructure
  threadDoc: ThreadDoc | null
  articleUrl: string | null
}

export interface SemanticSnapshotCaptureResponse {
  snapshot: SemanticSnapshot | null
  error: string | null
}

export interface SemanticSelectionTarget {
  regionId: string
  primitive: SemanticPrimitive
  subtype?: string
  category: SemanticCategory
  nodeKind: SemanticNodeKind
  nodeId: string | null
  rootNodeId: string | null
  scopeRootId: string | null
  label: string
  displayLabel: string
  text: string
}

export interface SemanticSelectionStateResponse {
  enabled: boolean
  selectedTarget: SemanticSelectionTarget | null
}

export interface SemanticSnapshotHistoryResponse {
  tabId: number | null
  snapshots: SemanticSnapshot[]
}

export type SidePanelToContentMessage =
  | { type: "COLLECT_SENSORS" }
  | { type: "GET_THREAD_DOC" }
  | { type: "EXECUTE_PROJECTION"; projection: Projection }

export type ServiceWorkerToContentMessage =
  | { type: "CAPTURE_SEMANTIC_SNAPSHOT"; payload: { source: CaptureSource } }
  | { type: "TOGGLE_SEMANTIC_SELECTION" }
  | { type: "GET_SEMANTIC_SELECTION_STATE" }
  | { type: "CLEAR_SEMANTIC_SELECTION" }

export type ServiceWorkerToSidePanelMessage =
  | { type: "ACTIVE_TAB_CHANGED"; payload: { tabId: number; url: string; title: string } }
  | { type: "ARTICLE_INJECTED"; payload: { tabId: number; url: string } }
  | {
      type: "SEMANTIC_SNAPSHOT_READY"
      payload: {
        tabId: number | null
        snapshot: SemanticSnapshot | null
        error: string | null
      }
    }
  | {
      type: "SEMANTIC_SNAPSHOT_HISTORY_UPDATED"
      payload: SemanticSnapshotHistoryResponse
    }
  | {
      type: "SEMANTIC_SELECTION_STATE_CHANGED"
      payload: {
        tabId: number | null
        enabled: boolean
        selectedTarget: SemanticSelectionTarget | null
      }
    }

export type SidePanelToServiceWorkerMessage =
  | { type: "CAPTURE_VIEWPORT" }
  | { type: "REQUEST_TOKEN" }
  | { type: "REGISTER_ARTICLE_URL"; payload: { url: string; threadId: string } }
  | { type: "OPEN_TAB"; payload: { url: string; active: boolean } }
  | { type: "REQUEST_SEMANTIC_SNAPSHOT"; payload?: { tabId?: number; source?: CaptureSource } }
  | { type: "GET_LATEST_SEMANTIC_SNAPSHOT"; payload?: { tabId?: number } }
  | { type: "GET_SEMANTIC_SNAPSHOT_HISTORY"; payload?: { tabId?: number } }
  | { type: "TOGGLE_SEMANTIC_SELECTION"; payload?: { tabId?: number } }
  | { type: "GET_SEMANTIC_SELECTION_STATE"; payload?: { tabId?: number } }
  | { type: "CLEAR_SEMANTIC_SELECTION"; payload?: { tabId?: number } }
  | {
      type: "SYNC_SEMANTIC_SELECTION_STATE"
      payload: {
        enabled: boolean
        selectedTarget: SemanticSelectionTarget | null
        snapshot?: SemanticSnapshot | null
        error?: string | null
      }
    }

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
  | ServiceWorkerToContentMessage
  | ServiceWorkerToSidePanelMessage
  | SidePanelToServiceWorkerMessage
  | ArticleContentMessage

export type SourceArticleFromGraph = Pick<ArticleContext, "url" | "title" | "text" | "structure" | "readAt">
