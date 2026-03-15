import type { Projection } from "./projection"
import type { EnsureAuthSessionResponse, ExtensionAuthState } from "./auth-session"
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

export type AudioCaptureRuntimeState = "idle" | "listening" | "processing" | "unsupported" | "error"

export interface AudioCaptureControlResponse {
  ok: boolean
  error?: string
}

export interface PageTextSelectionChangedPayload {
  tabId?: number | null
  hasSelection: boolean
  textPreview: string
  timestamp: number
}

export interface SemanticSnapshotHistoryResponse {
  tabId: number | null
  snapshots: SemanticSnapshot[]
}

export type SidePanelToContentMessage =
  | { type: "COLLECT_SENSORS" }
  | { type: "GET_THREAD_DOC" }
  | { type: "EXECUTE_PROJECTION"; projection: Projection }
  | { type: "CAPTURE_PAGE_TEXT_SELECTION_SNAPSHOT" }
  | {
      type: "APPLY_PAGE_SELECTION_SCOPE_HIGHLIGHT"
      payload: { regionId: string; focusNodeId: string; rootNodeId?: string | null }
    }
  | { type: "CLEAR_PAGE_SELECTION_SCOPE_HIGHLIGHT" }
  | { type: "CLEAR_PAGE_TEXT_SELECTION" }
  | { type: "START_PAGE_AUDIO_CAPTURE"; payload: { sessionId: string } }
  | { type: "STOP_PAGE_AUDIO_CAPTURE"; payload: { sessionId: string } }
  | { type: "CANCEL_PAGE_AUDIO_CAPTURE"; payload: { sessionId: string } }

export type ServiceWorkerToContentMessage =
  | { type: "CAPTURE_SEMANTIC_SNAPSHOT"; payload: { source: CaptureSource } }
  | { type: "TOGGLE_SEMANTIC_SELECTION" }
  | { type: "GET_SEMANTIC_SELECTION_STATE" }
  | { type: "GET_SEMANTIC_REGION_DUMP" }
  | { type: "CLEAR_SEMANTIC_SELECTION" }

export type ServiceWorkerToSidePanelMessage =
  | { type: "ACTIVE_TAB_CHANGED"; payload: { tabId: number; url: string; title: string } }
  | { type: "ARTICLE_INJECTED"; payload: { tabId: number; url: string } }
  | { type: "AUTH_STATE_CHANGED"; payload: ExtensionAuthState }
  | {
      type: "PAGE_AUDIO_CAPTURE_READY"
      payload: {
        tabId?: number | null
      }
    }
  | {
      type: "PAGE_AUDIO_CAPTURE_STATE_CHANGED"
      payload: {
        tabId?: number | null
        sessionId: string
        state: AudioCaptureRuntimeState
        detail?: string
      }
    }
  | {
      type: "PAGE_AUDIO_CAPTURE_CHUNK"
      payload: {
        tabId?: number | null
        sessionId: string
        chunkBase64: string
      }
    }
  | {
      type: "PAGE_TEXT_SELECTION_CHANGED"
      payload: PageTextSelectionChangedPayload
    }
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
  | { type: "REGISTER_ARTICLE_URL"; payload: { url: string; threadId: string } }
  | { type: "OPEN_TAB"; payload: { url: string; active: boolean } }
  | { type: "GET_AUTH_STATE" }
  | { type: "SIGN_IN_WITH_GOOGLE" }
  | { type: "ENSURE_AUTH_SESSION" }
  | { type: "SIGN_OUT" }
  | { type: "REQUEST_SEMANTIC_SNAPSHOT"; payload?: { tabId?: number; source?: CaptureSource } }
  | { type: "GET_LATEST_SEMANTIC_SNAPSHOT"; payload?: { tabId?: number } }
  | { type: "GET_SEMANTIC_SNAPSHOT_HISTORY"; payload?: { tabId?: number } }
  | { type: "TOGGLE_SEMANTIC_SELECTION"; payload?: { tabId?: number } }
  | { type: "GET_SEMANTIC_SELECTION_STATE"; payload?: { tabId?: number } }
  | { type: "GET_SEMANTIC_REGION_DUMP"; payload?: { tabId?: number } }
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

export type ServiceWorkerAuthResponse =
  | ExtensionAuthState
  | EnsureAuthSessionResponse

export type SourceArticleFromGraph = Pick<ArticleContext, "url" | "title" | "text" | "structure" | "readAt">
