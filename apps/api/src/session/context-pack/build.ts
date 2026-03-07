import type {
  ContextPack,
  SemanticSnapshot
} from "./types"

function deriveFocusText(snapshot: SemanticSnapshot): string {
  const node = snapshot.focus.node
  if (typeof node.text === "string" && node.text.trim().length > 0) {
    return node.text.trim()
  }
  if (typeof node.label === "string" && node.label.trim().length > 0) {
    return node.label.trim()
  }
  return "(empty)"
}

export function buildCanonicalContextPack(snapshot: SemanticSnapshot): ContextPack {
  return {
    version: 1,
    page: {
      id: snapshot.page.id,
      url: snapshot.page.url,
      ...(snapshot.page.title ? { title: snapshot.page.title } : {}),
      kind: snapshot.page.kind
    },
    focus: {
      id: snapshot.focus.node.id,
      kind: snapshot.focus.node.kind,
      text: deriveFocusText(snapshot)
    },
    provenance: {
      extractorId: snapshot.meta.extractorId,
      capturedAt: snapshot.meta.capturedAt,
      skeletonVersion: snapshot.meta.skeletonVersion
    }
  }
}

