import type {
  SemanticSnapshot,
  SnapshotValidationResult
} from "./types"

const VALID_RELATIONS = new Set(["parent", "child", "sibling", "container", "ancestor"])

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function hasNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isValidCoverage(coverage: unknown): boolean {
  if (!isObject(coverage)) {
    return false
  }

  const kind = coverage.kind
  const rootNodeId = coverage.rootNodeId
  const capturedNodeCount = coverage.capturedNodeCount
  const omittedNodeCount = coverage.omittedNodeCount
  const omittedRootCount = coverage.omittedRootCount

  const validKind = kind === "focus-branch" || kind === "focus-section"
  return (
    validKind &&
    hasNonBlankString(rootNodeId) &&
    typeof capturedNodeCount === "number" &&
    capturedNodeCount >= 0 &&
    typeof omittedNodeCount === "number" &&
    omittedNodeCount >= 0 &&
    typeof omittedRootCount === "number" &&
    omittedRootCount >= 0
  )
}

export function validateSemanticSnapshot(snapshot: unknown): SnapshotValidationResult {
  if (!isObject(snapshot)) {
    return { ok: false, errors: ["snapshot must be an object"] }
  }

  const errors: string[] = []
  const casted = snapshot as Partial<SemanticSnapshot>

  if (!casted.page || !isObject(casted.page) || !hasNonBlankString(casted.page.id)) {
    errors.push("page is required")
  }

  if (!casted.page || !isObject(casted.page) || !hasNonBlankString(casted.page.url)) {
    errors.push("page.url is required")
  }

  if (!casted.focus || !isObject(casted.focus) || typeof casted.focus.nodeId !== "string") {
    errors.push("focus is required")
  }

  if (!casted.focus || !isObject(casted.focus.node) || typeof casted.focus.node.id !== "string") {
    errors.push("focus.node is required")
  }

  if (
    casted.focus &&
    isObject(casted.focus) &&
    isObject(casted.focus.node) &&
    typeof casted.focus.nodeId === "string" &&
    typeof casted.focus.node.id === "string" &&
    casted.focus.nodeId !== casted.focus.node.id
  ) {
    errors.push("focus.nodeId must match focus.node.id")
  }

  if (!Array.isArray(casted.context)) {
    errors.push("context must be an array")
  } else {
    for (const slice of casted.context) {
      if (!isObject(slice)) {
        errors.push("context slice must be object")
        continue
      }
      if (typeof slice.relation !== "string" || !VALID_RELATIONS.has(slice.relation)) {
        errors.push("context relation is invalid")
      }
      if (typeof slice.distance !== "number" || slice.distance < 1) {
        errors.push("context distance must be >= 1")
      }
      if (!isObject(slice.node) || typeof slice.node.id !== "string") {
        errors.push("context node is invalid")
      }
    }
  }

  if (!casted.meta || !isObject(casted.meta) || typeof casted.meta.capturedAt !== "string") {
    errors.push("meta is required")
  }

  if (casted.meta && isObject(casted.meta) && casted.meta.coverage !== undefined) {
    if (!isValidCoverage(casted.meta.coverage)) {
      errors.push("meta.coverage is invalid")
    }
  }

  return {
    ok: errors.length === 0,
    errors
  }
}
