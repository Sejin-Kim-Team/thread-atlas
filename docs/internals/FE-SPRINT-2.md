# Codex 구현 요구사항 — Semantic Snapshot Browser Extension

> 이 문서는 SPEC.md를 기반으로, 코드 에이전트가 구현할 때 따라야 할 **구체적 요구사항, 순서, 제약 조건**을 정의한다.
> 반드시 SPEC.md를 먼저 읽고 이 문서를 따를 것.

---

## 핵심 원칙 (구현 전 반드시 숙지)

### ⛔ 금지 사항

1. **CSS selector 하드코딩으로 사이트를 크롤링하지 마라.**
    - `document.querySelector('.athing')` 같은 site-specific selector를 직접 사용하는 것은 "semantic extraction"이 아니라 "site scraping"이다.
    - 모든 extractor는 SPEC.md §7의 3단계 파이프라인(Signal Detection → Semantic AST → Domain Interpretation)을 반드시 따라야 한다.

2. **DOM element를 직접 반환하지 마라.**
    - 모든 출력은 Semantic IR (PageNode, ContentNode, CommentNode) 타입이어야 한다.
    - DOM 참조는 WeakRef로만 유지하며, 출력 payload에는 포함하지 않는다.

3. **페이지 전체를 한 번에 파싱하지 마라.**
    - Skeleton은 구조만 파악 (< 50ms). 실제 콘텐츠 파싱은 Lazy Region Extraction으로 트리거 시점에 수행.

### ✅ 필수 원칙

1. **3단계 파이프라인을 따라라.**
    - Phase 1: DOM에서 semantic signal 수집 (HTML5 elements, ARIA, 반복 구조, 밀도 변화)
    - Phase 2: `dom-to-semantic-markdown`의 `htmlToMarkdownAST`로 semantic AST 변환
    - Phase 3: Site-specific extractor가 AST 위에서 도메인 의미 해석

2. **라이브러리를 적극 활용하라.**
    - `@mozilla/readability`: Phase 1에서 article 페이지 판별 + 본문 영역 추출
    - `dom-to-semantic-markdown`: Phase 2에서 DOM subtree → Semantic AST 변환 엔진
    - 이 라이브러리들이 공유 인프라이며, site-specific extractor는 Phase 3만 구현한다.

3. **시각적 피드백을 제공하라.**
    - 마우스가 가리키는 semantic region을 실시간 하이라이트
    - 단축키로 현재 focus의 semantic snapshot을 캡처

---

## 프로젝트 구조

```
semantic-snapshot-extension/
├── manifest.json                    # Chrome Extension Manifest V3
├── package.json
├── tsconfig.json
├── src/
│   ├── content/                     # Content Script (페이지에 주입)
│   │   ├── index.ts                 # Entry point
│   │   ├── overlay/                 # 시각적 하이라이트 레이어
│   │   │   ├── RegionHighlighter.ts # region 하이라이트 오버레이
│   │   │   └── SnapshotIndicator.ts # 캡처 피드백 UI
│   │   └── capture/
│   │       ├── TriggerManager.ts    # 단축키 / 컨텍스트 메뉴 관리
│   │       └── BrowserCapture.ts    # 트리거 시점 브라우저 상태 캡처
│   │
│   ├── core/                        # 프레임워크 비의존 핵심 로직
│   │   ├── skeleton/
│   │   │   ├── SkeletonBuilder.ts   # Skeleton 구축 오케스트레이터
│   │   │   ├── SkeletonManager.ts   # Skeleton versioning + invalidation
│   │   │   └── SignalDetector.ts    # Phase 1: semantic signal 수집
│   │   │
│   │   ├── extraction/
│   │   │   ├── SemanticASTBuilder.ts  # Phase 2: dom-to-semantic-markdown 래퍼
│   │   │   ├── RegionExtractor.ts     # Lazy region extraction
│   │   │   └── FocusResolver.ts       # element → semantic focus 변환
│   │   │
│   │   ├── ir/
│   │   │   ├── types.ts             # Semantic IR 타입 (PageNode, ContentNode, CommentNode, ...)
│   │   │   ├── SemanticSnapshot.ts  # Snapshot 조립
│   │   │   └── ContextSliceBuilder.ts # focus 주변 맥락 슬라이스
│   │   │
│   │   └── plugin/
│   │       ├── ExtractorRegistry.ts   # Plugin 등록 + resolution
│   │       ├── PageExtractor.ts       # Extractor 인터페이스 정의
│   │       └── extractors/
│   │           ├── HackerNewsExtractor.ts
│   │           ├── RedditExtractor.ts
│   │           └── GenericArticleExtractor.ts
│   │
│   ├── background/                  # Service Worker
│   │   └── index.ts                 # 단축키 커맨드 등록, 메시지 라우팅
│   │
│   └── sidepanel/                   # Side Panel UI (스냅샷 뷰어)
│       ├── index.html
│       ├── index.ts
│       └── SnapshotViewer.ts        # 캡처된 스냅샷 표시
│
├── public/
│   └── icons/                       # 확장 아이콘
│
└── tests/
    ├── signals/                     # Phase 1 signal detection 테스트
    ├── ast/                         # Phase 2 AST 변환 테스트
    └── extractors/                  # Phase 3 extractor 테스트
```

---

## 구현 순서 (이 순서를 반드시 따를 것)

### Phase A: 핵심 타입 + 인터페이스 정의

> 코드를 한 줄도 쓰기 전에 타입부터 확정한다.

**A-1. Semantic IR 타입 (`src/core/ir/types.ts`)**

```ts
// SPEC.md §6.2의 타입을 그대로 구현
export type PageNode = {
  id: string
  url: string
  title?: string
  kind: 'article' | 'thread' | 'post' | 'generic'
  metadata?: Record<string, string>
}

export type ContentNode = {
  id: string
  type: 'paragraph' | 'heading' | 'quote' | 'code' | 'list' | 'image'
  text: string
  level?: number
  language?: string
  attributes?: Record<string, string>
}

export type CommentNode = {
  id: string
  author?: string
  text: string
  timestamp?: string
  parentId?: string
  depth: number
  metadata?: Record<string, string>
}

export type SemanticCategory =
  | 'content.article'
  | 'content.post'
  | 'content.media'
  | 'discussion.comment'
  | 'discussion.thread'
  | 'discussion.reaction'
  | 'navigation.menu'
  | 'navigation.breadcrumb'
  | 'navigation.pagination'
  | 'metadata.author'
  | 'metadata.timestamp'
  | 'metadata.stats'

export type SemanticRegion = {
  id: string
  kind: string
  category: SemanticCategory
  nodes: (ContentNode | CommentNode)[]
  structure?: {
    type: 'flat' | 'tree' | 'sequence'
    rootIds?: string[]
  }
}

export type SemanticRegionRef = {
  id: string
  kind: string
  category: SemanticCategory
  anchor: WeakRef<Element>
  state: 'fresh' | 'stale' | 'unloaded'
  extractedAt?: number
}

export type SemanticSkeleton = {
  version: number
  pageType: string
  regions: SemanticRegionRef[]
  anchors: Map<string, WeakRef<Element>>
}

export type ContextSlice = {
  relation: 'parent' | 'child' | 'sibling' | 'container' | 'ancestor'
  node: ContentNode | CommentNode
  distance: number
}

export type SemanticSnapshot = {
  page: PageNode
  focus: {
    nodeId: string
    node: ContentNode | CommentNode
    region: string
  }
  context: ContextSlice[]
  meta: {
    capturedAt: string
    skeletonVersion: number
    extractorId: string
  }
}
```

**A-2. Extractor 인터페이스 (`src/core/plugin/PageExtractor.ts`)**

```ts
// SPEC.md §4.2 그대로
export interface PageExtractor {
  readonly id: string
  match(url: string, document: Document): boolean
  buildSkeleton(document: Document): SemanticSkeleton
  expandRegion(region: SemanticRegionRef): SemanticRegion
  resolveFocus(element: Element): FocusResult | null
  isStructuralMutation?(mutation: MutationRecord): boolean
  onNavigate?(url: URL, prevUrl: URL): 'rebuild' | 'update' | 'ignore'
}

export type FocusResult = {
  nodeId: string
  node: ContentNode | CommentNode
  regionId: string
}
```

---

### Phase B: 공유 인프라 (Phase 1 + Phase 2)

> 모든 extractor가 공유하는 코어 로직. 여기가 프로젝트의 심장이다.

**B-1. Signal Detector (`src/core/skeleton/SignalDetector.ts`)**

SPEC.md §7.2의 semantic signal을 구현한다.

```ts
export type SemanticSignal = {
  element: Element
  type: 'html5-semantic' | 'aria-landmark' | 'repeated-structure' | 'density-boundary' | 'heading-section'
  strength: 'strong' | 'medium' | 'weak'
  suggestedCategory: SemanticCategory
  confidence: number // 0-1
}

export class SignalDetector {
  /**
   * DOM tree를 순회하며 semantic signal을 수집한다.
   *
   * 구현 요구사항:
   * 1. 강한 signal: HTML5 semantic elements (<article>, <main>, <nav>, <aside>, <section>, <header>, <footer>)
   *    및 ARIA landmarks (role="main", role="navigation" 등)를 탐지. 단독으로 region 판별 가능.
   *
   * 2. 중간 signal: 반복 구조 감지 — 동일 패턴의 DOM subtree가 3회 이상 반복되는지 판별.
   *    "동일 패턴"은 tagName + className 조합의 유사도로 판단.
   *    구조적 depth 변화(nesting)가 있으면 thread 후보.
   *
   * 3. 약한 signal: id/class에 semantic 키워드(comment, post, article, content, sidebar 등) 포함 여부.
   *    보조적 판단 근거로만 사용.
   */
  detect(root: Element): SemanticSignal[]
}
```

**B-2. Semantic AST Builder (`src/core/extraction/SemanticASTBuilder.ts`)**

`dom-to-semantic-markdown`을 래핑한다.

```ts
import { htmlToMarkdownAST } from 'dom-to-semantic-markdown'

export class SemanticASTBuilder {
  /**
   * DOM subtree를 semantic AST로 변환한다.
   *
   * 구현 요구사항:
   * 1. dom-to-semantic-markdown의 htmlToMarkdownAST를 사용
   * 2. extractMainContent: false (region 자체가 이미 관심 영역)
   * 3. overrideElementProcessing 훅을 통해 extractor의 Phase 3 로직을 주입 가능하게 설계
   * 4. AST node type → SemanticCategory 매핑 (SPEC.md §7.4 테이블 참조)
   */
  build(element: Element, overrides?: OverrideProcessing): SemanticMarkdownAST[]

  /**
   * AST를 Semantic IR (ContentNode[])로 변환한다.
   */
  toContentNodes(ast: SemanticMarkdownAST[]): ContentNode[]
}
```

**B-3. GenericArticleExtractor (`src/core/plugin/extractors/GenericArticleExtractor.ts`)**

```ts
/**
 * 구현 요구사항:
 *
 * 이 extractor는 fallback이다. 다른 site-specific extractor가 매치되지 않을 때 사용된다.
 *
 * Phase 1: @mozilla/readability 사용
 *   - isProbablyReaderable(document)로 article 페이지 판별
 *   - 반드시 document.cloneNode(true)로 복사본 전달 (readability가 DOM을 변형함)
 *   - Readability의 serializer: (el) => el 옵션으로 DOM Element를 그대로 받아 anchor로 활용
 *
 * Phase 2: SemanticASTBuilder.build(articleBodyElement)로 AST 변환
 *
 * Phase 3: AST의 heading 계층 구조로 article section 분할.
 *   heading이 없으면 paragraph 단위로 ContentNode 생성.
 */
```

---

### Phase C: 시각적 하이라이트 + 트리거

> 사용자가 보고 상호작용하는 레이어.

**C-1. Region Highlighter (`src/content/overlay/RegionHighlighter.ts`)**

```ts
/**
 * 마우스가 가리키는 semantic region을 실시간 하이라이트한다.
 *
 * 구현 요구사항:
 *
 * 1. 동작 방식 (VueUse useElementByPoint 데모 참고):
 *    - mousemove 이벤트를 throttle(50ms)로 감지
 *    - document.elementFromPoint(x, y)로 커서 아래 leaf element 탐지
 *    - element.closest('[data-semantic-region]')로 해당 element가 속한 semantic region 탐지
 *    - region의 getBoundingClientRect()로 오버레이 위치/크기 계산
 *
 * 2. 오버레이 렌더링:
 *    - position: fixed / pointer-events: none / z-index: 2147483647 (최상위)
 *    - 현재 region: 반투명 파란색 배경 (rgba(59, 130, 246, 0.08)) + 파란색 border (1px solid rgba(59, 130, 246, 0.5))
 *    - 부모 region: 반투명 초록색 배경 (rgba(34, 197, 94, 0.06)) + 초록색 border (1px solid rgba(34, 197, 94, 0.4))
 *    - transition: all 0.05s linear (부드러운 전환)
 *
 * 3. 라벨 표시:
 *    - 하이라이트된 region의 좌상단에 작은 라벨 표시
 *    - 라벨 내용: region.category (예: "discussion.thread", "content.article")
 *    - 폰트: system-ui, 11px, 반투명 배경
 *
 * 4. 성능 제약:
 *    - mousemove throttle 50ms
 *    - region 변경 시에만 DOM 업데이트 (같은 region이면 skip)
 *    - 오버레이 element는 최초 1회만 생성, 이후 style만 변경
 *
 * 5. 활성화/비활성화:
 *    - 확장 아이콘 클릭 또는 단축키(Alt+Shift+H)로 하이라이트 모드 토글
 *    - 비활성화 시 오버레이 숨김 + mousemove 리스너 제거
 */
```

**C-2. Trigger Manager (`src/content/capture/TriggerManager.ts`)**

```ts
/**
 * 사용자 트리거를 관리한다.
 *
 * 구현 요구사항:
 *
 * 1. 단축키 (manifest.json의 commands로 등록):
 *
 *    | 단축키 | 동작 |
 *    |--------|------|
 *    | Alt+Shift+S | 현재 focus의 semantic snapshot 캡처 |
 *    | Alt+Shift+H | 하이라이트 모드 토글 |
 *
 *    - background service worker에서 chrome.commands.onCommand로 수신
 *    - content script로 메시지 전달
 *
 * 2. 컨텍스트 메뉴:
 *    - 우클릭 → "Capture Semantic Snapshot" 메뉴 항목
 *    - background에서 chrome.contextMenus.create로 등록
 *    - 클릭 시 현재 우클릭 위치의 element 기준 snapshot 캡처
 *
 * 3. 텍스트 선택 트리거:
 *    - 텍스트를 선택한 상태에서 단축키(Alt+Shift+S)를 누르면
 *    - selection의 anchorNode가 속한 region을 focus로 사용
 *
 * 4. 트리거 발동 시 호출 흐름:
 *    trigger → BrowserCapture.capture() → FocusResolver.resolve()
 *    → RegionExtractor.extract() → ContextSliceBuilder.build()
 *    → SemanticSnapshot 생성 → Side Panel에 표시 + 클립보드 복사
 */
```

**C-3. Snapshot Indicator (`src/content/overlay/SnapshotIndicator.ts`)**

```ts
/**
 * 스냅샷 캡처 성공 시 시각적 피드백을 제공한다.
 *
 * 구현 요구사항:
 *
 * 1. 캡처된 region에 짧은 flash 효과 (200ms 녹색 glow → fade out)
 * 2. 화면 우상단에 토스트 알림: "Snapshot captured" + region category
 * 3. 토스트는 2초 후 자동 사라짐
 * 4. 캡처된 snapshot JSON이 클립보드에 복사되었음을 표시
 */
```

---

### Phase D: Side Panel (스냅샷 뷰어)

**D-1. Side Panel UI (`src/sidepanel/`)**

```ts
/**
 * 캡처된 semantic snapshot을 시각적으로 표시하는 Side Panel.
 *
 * 구현 요구사항:
 *
 * 1. 기본 레이아웃:
 *    - 상단: 페이지 정보 (title, url, kind)
 *    - 중앙: focus node 상세 (텍스트, author, timestamp 등)
 *    - 하단: context slices (parent, children, siblings를 관계별로 그룹핑)
 *
 * 2. 스냅샷 히스토리:
 *    - 세션 내 캡처된 스냅샷 목록을 시간순으로 표시
 *    - 각 항목 클릭 시 상세 보기
 *
 * 3. JSON 뷰:
 *    - "Raw JSON" 토글로 원본 JSON 확인 가능
 *    - 복사 버튼
 *
 * 4. 스타일:
 *    - 깔끔하고 읽기 쉬운 UI. 과도한 장식 불필요.
 *    - system font 사용 (Chrome 확장 컨벤션)
 *    - dark/light mode는 시스템 설정 따름
 */
```

---

### Phase E: Skeleton Manager + 동적 콘텐츠

**E-1. Skeleton Manager (`src/core/skeleton/SkeletonManager.ts`)**

```ts
/**
 * Skeleton의 lifecycle을 관리한다.
 *
 * 구현 요구사항 (SPEC.md §5):
 *
 * 1. 페이지 로드 시:
 *    - ExtractorRegistry.resolve()로 적합한 extractor 선택
 *    - extractor.buildSkeleton()으로 skeleton v1 생성
 *    - 각 region의 anchor element에 data-semantic-region 속성 추가
 *    - MutationObserver 시작
 *
 * 2. DOM 변이 감지 시:
 *    - 단일 MutationObserver로 document.body 감시 (subtree: true, childList: true)
 *    - mutation.target에서 closest('[data-semantic-region]')로 affected region 판별
 *    - extractor.isStructuralMutation?.()으로 유의미한 변화인지 확인
 *    - 유의미하면 해당 region을 'stale'로 마킹
 *    - debounce 300ms
 *
 * 3. SPA navigation 감지:
 *    - history.pushState, history.replaceState monkey-patch
 *    - popstate 이벤트 감지
 *    - extractor.onNavigate?.()로 처리 방식 결정
 *    - 'rebuild' → skeleton 전체 재구축
 *    - 'update' → 변경 region만 invalidate
 *    - 'ignore' → 무시
 *
 * 4. Region extraction 시:
 *    - region.state === 'stale' 또는 'unloaded'이면 re-extract
 *    - 'fresh'이면 캐시 사용
 *    - WeakRef.deref()가 null이면 region 소멸 처리
 */
```

---

### Phase F: Site-Specific Extractors

> Phase B의 공유 인프라 위에서 Phase 3만 구현한다.

**F-1. HackerNewsExtractor**

```ts
/**
 * 구현 요구사항:
 *
 * ⛔ document.querySelector('.athing') 같은 직접 selector 금지.
 *
 * 대신 다음 흐름을 따른다:
 *
 * Phase 1 (SignalDetector 활용):
 *   - 반복 구조 signal로 comment list 감지
 *   - 구조적 depth 변화 signal로 threaded comment 감지
 *
 * Phase 2 (SemanticASTBuilder 활용):
 *   - 감지된 region의 DOM subtree를 AST로 변환
 *
 * Phase 3 (이 extractor만의 로직):
 *   - HN의 indent 기반 nesting을 thread 구조로 해석
 *   - AST에서 author, timestamp, score 등의 metadata 추출
 *   - 각 comment를 CommentNode로 변환, parentId로 tree 구조 표현
 *
 * match 조건:
 *   - url에 'news.ycombinator.com' 포함
 *
 * isStructuralMutation:
 *   - childList mutation에서 comment 패턴의 element가 추가되었는지 판별
 *   - score 업데이트 등은 무시
 *
 * Regions:
 *   - story: 제목 + 메타데이터 영역
 *   - comment-tree: 댓글 트리 영역
 */
```

**F-2. RedditExtractor**

```ts
/**
 * HackerNewsExtractor와 동일한 원칙. Phase 1-2는 공유 인프라, Phase 3만 Reddit 특화.
 *
 * match 조건:
 *   - url에 'reddit.com' 또는 'old.reddit.com' 포함
 *
 * Regions:
 *   - post: 게시글 본문
 *   - comment-thread: 댓글 스레드
 */
```

---

## manifest.json 요구사항

```json
{
  "manifest_version": 3,
  "name": "Semantic Snapshot",
  "version": "0.1.0",
  "description": "Capture semantic structure of web pages",
  "permissions": [
    "activeTab",
    "contextMenus",
    "sidePanel",
    "clipboardWrite"
  ],
  "commands": {
    "capture-snapshot": {
      "suggested_key": {
        "default": "Alt+Shift+S",
        "mac": "Alt+Shift+S"
      },
      "description": "Capture semantic snapshot"
    },
    "toggle-highlight": {
      "suggested_key": {
        "default": "Alt+Shift+H",
        "mac": "Alt+Shift+H"
      },
      "description": "Toggle region highlight"
    }
  },
  "background": {
    "service_worker": "src/background/index.ts"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["src/content/index.ts"],
      "run_at": "document_idle"
    }
  ],
  "side_panel": {
    "default_path": "src/sidepanel/index.html"
  },
  "icons": {
    "16": "public/icons/icon-16.png",
    "48": "public/icons/icon-48.png",
    "128": "public/icons/icon-128.png"
  }
}
```

---

## 빌드 + 의존성

```json
{
  "dependencies": {
    "@mozilla/readability": "latest",
    "dom-to-semantic-markdown": "latest"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "vite": "^5.0.0",
    "@crxjs/vite-plugin": "latest",
    "vitest": "^1.0.0"
  }
}
```

- 번들러: **Vite + @crxjs/vite-plugin** (Chrome Extension 핫리로드 지원)
- 테스트: **Vitest**
- TypeScript strict mode 필수

---

## 테스트 요구사항

각 Phase별 최소 테스트:

**Phase 1 테스트 (Signal Detection):**
- HTML5 semantic element가 있는 DOM에서 강한 signal이 감지되는지
- 반복 구조(같은 패턴 3회 이상)에서 중간 signal이 감지되는지
- signal이 없는 빈 div에서 signal이 감지되지 않는지

**Phase 2 테스트 (AST 변환):**
- heading이 포함된 HTML이 heading node로 변환되는지
- nested list가 tree 구조로 변환되는지
- AST → ContentNode[] 변환이 정확한지

**Phase 3 테스트 (Domain Interpretation):**
- HN comment HTML 스니펫에서 CommentNode tree가 올바르게 생성되는지
- generic article에서 heading 기반 section 분할이 되는지

**Snapshot 테스트:**
- focus + context slice가 올바르게 조립되는지
- 출력 JSON이 SemanticSnapshot 타입에 맞는지

---

## 전체 데이터 플로우 요약

```
사용자가 웹 페이지를 연다
  ↓
[content script 주입]
  ↓
ExtractorRegistry.resolve(url, document) → 적합한 Extractor 선택
  ↓
SignalDetector.detect(document.body) → SemanticSignal[] (Phase 1)
  ↓
extractor.buildSkeleton(document) → SemanticSkeleton (region refs만, 콘텐츠는 unloaded)
  ↓
각 region anchor에 data-semantic-region 속성 부여
  ↓
MutationObserver 시작 + RegionHighlighter 활성화 (하이라이트 모드 시)
  ↓
[사용자가 마우스를 움직인다]
  ↓
elementFromPoint → closest('[data-semantic-region]') → 해당 region + parent region 하이라이트
  ↓
[사용자가 Alt+Shift+S를 누른다]
  ↓
BrowserCapture.capture() → { url, title, selection, activeElement, triggerTarget }
  ↓
FocusResolver.resolve(triggerTarget) → FocusResult { nodeId, node, regionId }
  ↓
region.state 확인 → stale/unloaded이면:
  SemanticASTBuilder.build(regionAnchor) (Phase 2)
  → extractor.expandRegion(region) (Phase 3)
  → region.state = 'fresh'
  ↓
ContextSliceBuilder.build(focusResult, skeleton) → ContextSlice[]
  ↓
SemanticSnapshot 조립 → JSON
  ↓
클립보드에 복사 + SnapshotIndicator flash + Side Panel에 표시
```

---

## 주의사항 (코덱스에게)

1. **SPEC.md를 먼저 읽어라.** 이 문서는 SPEC.md의 구현 가이드이지 대체물이 아니다.
2. **Phase 순서를 지켜라.** A → B → C → D → E → F. 타입 없이 코드를 쓰지 마라.
3. **Phase 1-2는 모든 extractor가 공유한다.** site-specific 코드는 Phase 3에만 존재해야 한다.
4. **selector 하드코딩을 하는 순간 구조가 무너진다.** DOM 구조가 바뀌면 깨지는 코드는 semantic extraction이 아니다.
5. **`dom-to-semantic-markdown`과 `@mozilla/readability`를 반드시 활용하라.** 직접 DOM traversal로 대체하지 마라.
