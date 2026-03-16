import type {
  PageExtractor,
  ResolveFocusInput,
  SemanticRegion,
  SemanticRegionState,
  SemanticSkeleton
} from "@threadatlas/shared/browser-runtime"
import type { SemanticSnapshot } from "@threadatlas/shared"
import type {
  SemanticSelectionTarget,
  SemanticSnapshotCaptureResponse
} from "@threadatlas/shared/runtime"
import { isSemanticCaptureSupportedUrl } from "../../common/semantic-url"
import { buildSemanticSnapshot } from "./context-slice"
import { FocusResolver } from "./focus-resolver"
import { GenericSemanticExtractor } from "./generic-semantic-extractor"
import { SkeletonBuilder } from "./skeleton-builder"
import { SkeletonManager } from "./skeleton-manager"
import type { RegionDump } from "./core/observability"

const NAVIGATION_EVENT = "threadatlas:semantic-navigation"
const HISTORY_PATCH_FLAG = "__threadatlasSemanticNavigationPatched__"

function patchHistoryNavigation(win: Window): void {
  const historyWithFlag = win.history as History & { [HISTORY_PATCH_FLAG]?: boolean }
  if (historyWithFlag[HISTORY_PATCH_FLAG]) {
    return
  }

  const wrap = (method: "pushState" | "replaceState") => {
    const original = win.history[method].bind(win.history)
    win.history[method] = ((...args: Parameters<History["pushState"]>) => {
      const result = original(...args)
      win.dispatchEvent(new Event(NAVIGATION_EVENT))
      return result
    }) as History["pushState"]
  }

  wrap("pushState")
  wrap("replaceState")
  historyWithFlag[HISTORY_PATCH_FLAG] = true
}

function hasMeaningfulRegion(region: SemanticRegion): boolean {
  return region.nodes.some((node) => {
    if ("text" in node) {
      return Boolean(node.text)
    }

    return Boolean(node.label || node.valuePreview)
  })
}

function findRegionDumpEntry(dump: RegionDump | null, regionId: string): RegionDump["regions"][number] | null {
  if (!dump) {
    return null
  }
  return dump.regions.find((region) => region.id === regionId) ?? null
}

function applyMultimodalHints(
  snapshot: SemanticSnapshot,
  dump: RegionDump | null,
  scopeKind: "page" | "selection"
): void {
  snapshot.meta.scopeKind = scopeKind
  snapshot.meta.focusTargetHint = {
    regionId: snapshot.focus.region,
    focusNodeId: snapshot.focus.nodeId,
    ...(snapshot.meta.coverage?.rootNodeId ? { rootNodeId: snapshot.meta.coverage.rootNodeId } : {})
  }

  const region = findRegionDumpEntry(dump, snapshot.focus.region)
  if (!region) {
    return
  }

  snapshot.meta.focusRegionHint = {
    primitive: region.primitive,
    ...(region.subtype ? { subtype: region.subtype } : {}),
    ...(region.normalizedKind ? { normalizedKind: region.normalizedKind } : {}),
    ...(region.layoutRole ? { layoutRole: region.layoutRole } : {}),
    ...(region.roleRank ? { roleRank: region.roleRank } : {})
  }
}

function resolveCaptureScopeKind(input?: ResolveFocusInput): "page" | "selection" {
  if (input?.scopeKind === "page" || input?.scopeKind === "selection") {
    return input.scopeKind
  }
  if (input?.selectedElement) {
    return "selection"
  }
  if (input?.selection && !input.selection.isCollapsed) {
    return "selection"
  }
  return "page"
}

export class SemanticCaptureSession {
  private readonly focusResolver = new FocusResolver()
  private readonly skeletonBuilder = new SkeletonBuilder()
  private readonly skeletonManager: SkeletonManager
  private readonly extractor: PageExtractor
  private currentUrl = ""
  private regionCache = new Map<string, SemanticRegion>()
  private skeleton: SemanticSkeleton | null = null
  private versionCounter = 0

  constructor(
    private readonly document: Document,
    private readonly window: Window,
    extractor?: PageExtractor
  ) {
    this.extractor = extractor ?? new GenericSemanticExtractor()
    this.skeletonManager = new SkeletonManager(document, window)
  }

  initialize(): void {
    patchHistoryNavigation(this.window)
    this.window.addEventListener("popstate", this.handleNavigation)
    this.window.addEventListener(NAVIGATION_EVENT, this.handleNavigation)
    this.rebuildForCurrentLocation()
  }

  dispose(): void {
    this.window.removeEventListener("popstate", this.handleNavigation)
    this.window.removeEventListener(NAVIGATION_EVENT, this.handleNavigation)
    this.skeletonManager.disconnect()
    this.skeletonManager.clearAnchorAttributes(this.skeleton)
  }

  getSkeleton(): SemanticSkeleton | null {
    return this.skeleton
  }

  getRegionState(regionId: string): SemanticRegionState | null {
    return this.skeleton?.regions.find((region) => region.id === regionId)?.state ?? null
  }

  getRegionElement(regionId: string): Element | null {
    return this.skeleton?.regions.find((region) => region.id === regionId)?.anchor.deref() ?? null
  }

  getRegionCategory(regionId: string): string | null {
    return this.skeleton?.regions.find((region) => region.id === regionId)?.category ?? null
  }

  refineSelectionTarget(target: SemanticSelectionTarget): SemanticSelectionTarget {
    const extractorWithRefiner = this.extractor as PageExtractor & {
      refineSelectionTarget?: (selection: SemanticSelectionTarget, document: Document) => SemanticSelectionTarget
    }
    return extractorWithRefiner.refineSelectionTarget?.(target, this.document) ?? target
  }

  captureSnapshot(input?: ResolveFocusInput): SemanticSnapshotCaptureResponse {
    this.ensureNavigationState()

    if (!isSemanticCaptureSupportedUrl(this.window.location.href) || !this.skeleton) {
      return {
        snapshot: null,
        error: "Semantic snapshots are only supported on standard web pages."
      }
    }

    const resolveInput =
      input ?? {
        source: "command",
        activeElement: this.document.activeElement,
        selection: this.window.getSelection(),
        triggerTarget: this.document.activeElement,
        selectedElement: null,
        lastHoveredElement: null
      }

    const focus = this.focusResolver.resolve(
      this.extractor,
      this.document,
      resolveInput
    )

    if (!focus) {
      return {
        snapshot: null,
        error: "No semantic focus could be resolved on this page."
      }
    }

    const focusRegion = this.ensureRegion(focus.regionId)
    if (!focusRegion || !hasMeaningfulRegion(focusRegion)) {
      return {
        snapshot: null,
        error: "No meaningful semantic region could be extracted from this page."
      }
    }

    const snapshot = buildSemanticSnapshot({
      page: this.extractor.describePage(this.document, this.window.location.href),
      focusRegion,
      focusNodeId: focus.nodeId,
      extractorId: this.extractor.id,
      skeletonVersion: this.skeleton.version
    })

    if (snapshot) {
      applyMultimodalHints(snapshot, this.dumpObservability(), resolveCaptureScopeKind(resolveInput))
    }

    return {
      snapshot,
      error: snapshot ? null : `Focus node ${focus.nodeId} could not be found in ${focus.regionId}.`
    }
  }

  dumpObservability(): RegionDump | null {
    this.ensureNavigationState()
    if (!this.skeleton) {
      return null
    }

    const extractorWithDump = this.extractor as PageExtractor & {
      dumpObservability?: (document: Document) => RegionDump
    }

    return extractorWithDump.dumpObservability?.(this.document) ?? null
  }

  private readonly handleNavigation = (): void => {
    this.ensureNavigationState()
  }

  private ensureNavigationState(): void {
    const nextUrl = this.window.location.href
    if (!this.skeleton) {
      this.rebuildForCurrentLocation()
      return
    }

    if (nextUrl === this.currentUrl) {
      return
    }

    const behavior = this.extractor.onNavigate?.(new URL(nextUrl), new URL(this.currentUrl)) ?? "rebuild"

    if (behavior === "ignore") {
      this.currentUrl = nextUrl
      return
    }

    if (behavior === "update") {
      this.currentUrl = nextUrl
      this.markRegionsStale(this.skeleton.regions.map((region) => region.id))
      return
    }

    this.rebuildForCurrentLocation()
  }

  private rebuildForCurrentLocation(): void {
    const nextUrl = this.window.location.href

    this.skeletonManager.disconnect()
    this.skeletonManager.clearAnchorAttributes(this.skeleton)
    this.skeletonManager.clearDocumentSemanticAttributes()
    this.regionCache.clear()
    this.currentUrl = nextUrl

    if (!isSemanticCaptureSupportedUrl(nextUrl)) {
      this.skeleton = null
      return
    }

    const skeleton = this.skeletonBuilder.build(this.extractor, this.document, this.versionCounter + 1)
    this.versionCounter += 1
    this.skeleton = skeleton
    this.skeletonManager.applyAnchorAttributes(skeleton)
    this.skeletonManager.observe(this.extractor, skeleton, (regionIds) => {
      this.markRegionsStale(regionIds)
    })
  }

  private ensureRegion(regionId: string): SemanticRegion | null {
    const regionRef = this.skeleton?.regions.find((region) => region.id === regionId)
    if (!regionRef) {
      return null
    }

    const cached = this.regionCache.get(regionId)
    if (cached && regionRef.state === "fresh") {
      return cached
    }

    const expanded = this.extractor.expandRegion(regionRef, this.document)
    regionRef.state = "fresh"
    regionRef.extractedAt = Date.now()
    this.regionCache.set(regionId, expanded)
    return expanded
  }

  private markRegionsStale(regionIds: string[]): void {
    const targets = new Set(regionIds)
    for (const region of this.skeleton?.regions ?? []) {
      if (targets.has(region.id)) {
        region.state = "stale"
      }
    }
  }
}
