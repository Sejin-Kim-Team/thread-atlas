import type {
  InteractiveNode,
  PageNode,
  SemanticCategory,
  SemanticScopeKind,
  SemanticNode,
  SemanticPrimitive
} from "./semantic-snapshot"
import type { CaptureSource } from "./semantic-runtime"

export type SemanticRegionState = "fresh" | "stale" | "unloaded"

export interface SemanticSkeleton {
  version: number
  pageType: string
  regions: SemanticRegionRef[]
  anchors: Map<string, WeakRef<Element>>
}

export interface SemanticRegionRef {
  id: string
  kind: string
  primitive: SemanticPrimitive
  subtype?: string
  category: SemanticCategory
  anchor: WeakRef<Element>
  state: SemanticRegionState
  parentId?: string
  displayLabel?: string
  extractedAt?: number
}

export interface RecognizedRegion {
  id: string
  element: Element
  primitive: SemanticPrimitive
  confidence: number
  signals: string[]
  subtype?: string
  category: SemanticCategory
}

export interface SemanticRegion {
  id: string
  kind: string
  primitive: SemanticPrimitive
  subtype?: string
  category: SemanticCategory
  displayLabel?: string
  nodes: SemanticNode[]
  structure?: {
    type: "flat" | "tree" | "sequence"
    rootIds?: string[]
  }
}

export interface FocusResult {
  nodeId: string
  node: SemanticNode
  regionId: string
}

export interface ResolveFocusInput {
  source: CaptureSource
  scopeKind?: SemanticScopeKind
  activeElement: Element | null
  selection: Selection | null
  triggerTarget: Element | null
  selectedElement?: Element | null
  lastHoveredElement?: Element | null
  lastHoveredCommentId?: string | null
}

export interface PageExtractor {
  id: string
  match(url: string, document: Document): boolean
  describePage(document: Document, url: string): PageNode
  buildSkeleton(document: Document): SemanticSkeleton
  expandRegion(region: SemanticRegionRef, document: Document): SemanticRegion
  resolveFocus(document: Document, input: ResolveFocusInput): FocusResult | null
  isStructuralMutation?(mutation: MutationRecord): boolean
  onNavigate?(url: URL, prevUrl: URL): "rebuild" | "update" | "ignore"
}

export interface PrimitiveRecognizer {
  readonly primitive: SemanticPrimitive
  detect(root: Element, document: Document): RecognizedRegion[]
  extract(region: RecognizedRegion, document: Document): SemanticRegion
}

const SENSITIVE_INPUT_TYPES = new Set(["password", "hidden", "email", "tel"])
const SENSITIVE_AUTOCOMPLETE = new Set([
  "cc-number",
  "cc-exp",
  "cc-csc",
  "cc-name",
  "email",
  "tel",
  "one-time-code"
])
const SENSITIVE_NAME_PATTERNS = /ssn|social|secret|token|password|credit|session|auth|api[-_]?key/i
const PREVIEW_LIMIT = 80

export function sanitizeInteractiveNode(node: InteractiveNode): InteractiveNode {
  const metadata = node.metadata ?? {}
  const inputType = metadata.inputType?.toLowerCase() ?? ""
  const autocomplete = metadata.autocomplete?.toLowerCase() ?? ""
  const name = metadata.name ?? ""
  const rawValue = metadata.rawValue ?? ""
  const placeholder = metadata.placeholder ?? ""

  const isSensitive =
    SENSITIVE_INPUT_TYPES.has(inputType) ||
    SENSITIVE_AUTOCOMPLETE.has(autocomplete) ||
    SENSITIVE_NAME_PATTERNS.test(name)

  const nextMetadata = { ...metadata }
  delete nextMetadata.rawValue

  if (inputType === "hidden" || inputType === "file") {
    return {
      ...node,
      ...(Object.keys(nextMetadata).length > 0 ? { metadata: nextMetadata } : {})
    }
  }

  if (node.controlType === "textarea") {
    return {
      ...node,
      ...(Object.keys(nextMetadata).length > 0 ? { metadata: nextMetadata } : {})
    }
  }

  if (node.controlType === "checkbox" || node.controlType === "radio" || node.controlType === "select") {
    return {
      ...node,
      ...(Object.keys(nextMetadata).length > 0 ? { metadata: nextMetadata } : {})
    }
  }

  const previewSource = isSensitive ? "[redacted]" : rawValue || placeholder
  const valuePreview = previewSource ? previewSource.slice(0, PREVIEW_LIMIT) : undefined

  return {
    ...node,
    ...(valuePreview ? { valuePreview } : {}),
    ...(Object.keys(nextMetadata).length > 0 ? { metadata: nextMetadata } : {})
  }
}
