# Semantic Snapshot Browser Extension — Technical Spec

> ThreadAtlas의 semantic extraction 레이어를 범용 웹으로 확장한 프로젝트.
> Gemini Live Agent Challenge 해커톤 제출 대상이되, 아키텍처는 범용 웹 대응 가능하게 설계한다.

---

## 1. Problem Statement

AI와 인간 모두 웹 페이지를 **의미 단위**로 이해하지 못한다.

- DOM/HTML은 구조는 있지만 의미가 없다 (너무 저수준)
- 전체 페이지 텍스트는 노이즈가 많다 (너무 고수준)

이 시스템은 웹 페이지를 의미론적으로 구조화하여, AI와 인간 모두가 소비 가능한 **Semantic Snapshot**을 생성하는 브라우저 확장이다.

---

## 2. Core Concepts

### 2.1 Semantic Skeleton

페이지 로드 시 구축되는 **문서 구조 지도**. 페이지 타입, 주요 semantic region, DOM anchor, 구조적 관계를 포함한다.

```
Page (HN Thread)
 ├─ Story Region
 │    ├─ title
 │    ├─ metadata (author, score, time)
 │    └─ url
 └─ Comment Region
      └─ Comment Tree
```

Skeleton은 immutable snapshot이 아니라 **versioned structure**이다 (§5 참조).

### 2.2 Semantic Region

Skeleton의 특정 영역을 실제로 파싱한 구조. **Lazy loading** 된다 — skeleton 구축 시점에는 region의 위치만 알고, 실제 콘텐츠 파싱은 사용자 트리거 시점까지 지연된다.

### 2.3 Semantic Snapshot

사용자 트리거 시점에 생성되는 **focus 중심 의미 맥락 슬라이스**. focus node와 그 주변 context(parent, children, siblings)를 포함한다.

---

## 3. System Architecture

```
┌─────────────────────────────────────────────────┐
│                  Trigger Layer                   │
│         (shortcut / context menu / UI)           │
└──────────────────────┬──────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────┐
│              Browser Capture Layer               │
│      (URL, title, selection, active element)     │
└──────────────────────┬──────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────┐
│             Skeleton Builder                     │
│   (page type detection, region discovery)        │
│                                                  │
│   ┌──────────────────────────────────────────┐  │
│   │        Plugin System (Extractor)          │  │
│   │  ┌──────────┐ ┌──────────┐ ┌──────────┐ │  │
│   │  │ HN       │ │ Reddit   │ │ Generic  │ │  │
│   │  │ Extractor │ │ Extractor│ │ Article  │ │  │
│   │  └──────────┘ └──────────┘ └──────────┘ │  │
│   └──────────────────────────────────────────┘  │
└──────────────────────┬──────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────┐
│           Lazy Region Extractor                  │
│    (on-demand parsing, caching, invalidation)    │
└──────────────────────┬──────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────┐
│              Semantic IR Layer                   │
│     (PageNode, ContentNode, CommentNode, ...)    │
└──────────────────────┬──────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────┐
│           Context Slice Builder                  │
│   (focus + parent + children + siblings slice)   │
└──────────────────────┬──────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────┐
│            Semantic Snapshot Output               │
│          (JSON — AI & Human 소비 가능)            │
└─────────────────────────────────────────────────┘
```

---

## 4. Plugin System (Extractor)

### 4.1 설계 방향

- MVP: **built-in plugins only** (HN, Reddit, Generic Article)
- 인터페이스는 향후 서드파티 확장 가능하게 설계
- Plugin은 빌드타임에 번들

### 4.2 Extractor Interface

```ts
interface PageExtractor {
  /** 이 extractor가 현재 페이지를 처리할 수 있는지 판별 */
  match(url: string, document: Document): boolean

  /** 페이지 로드 시 semantic skeleton 구축 */
  buildSkeleton(document: Document): SemanticSkeleton

  /** 특정 region의 콘텐츠를 실제 파싱 */
  expandRegion(region: SemanticRegionRef): SemanticRegion

  /** DOM element로부터 semantic focus 판별 */
  resolveFocus(element: Element): FocusResult

  /** (optional) DOM mutation이 구조적으로 유의미한지 판별 */
  isStructuralMutation?(mutation: MutationRecord): boolean

  /** (optional) navigation 발생 시 skeleton 처리 방식 결정 */
  onNavigate?(url: URL, prevUrl: URL): "rebuild" | "update" | "ignore"
}
```

### 4.3 Plugin Resolution

```ts
class ExtractorRegistry {
  private extractors: PageExtractor[] = []

  register(extractor: PageExtractor): void {
    this.extractors.push(extractor)
  }

  /** 등록 순서대로 match, 첫 번째 매치 반환. 없으면 GenericArticleExtractor fallback */
  resolve(url: string, document: Document): PageExtractor {
    return (
      this.extractors.find(e => e.match(url, document))
      ?? this.genericFallback
    )
  }
}
```

### 4.4 MVP Plugins

| Plugin | match 조건 | 역할 |
|--------|-----------|------|
| `HackerNewsExtractor` | `news.ycombinator.com` | story + comment tree 구조화 |
| `RedditExtractor` | `reddit.com`, `old.reddit.com` | post + comment thread 구조화 |
| `GenericArticleExtractor` | fallback (항상 매치) | `@mozilla/readability` 기반 본문 추출 |

---

## 5. Dynamic Content Handling

### 5.1 모델: Skeleton Versioning + Region Invalidation

Skeleton은 "한 번 찍는 사진"이 아니라 **versioned, living structure**이다. 변경 감지 시 affected region만 invalidate하고, 실제 re-extraction은 다음 사용자 트리거 시점까지 지연한다.

```
Page Load → Skeleton v1 생성
          ↓
MutationObserver 감시 시작 (skeleton anchor 기준)
          ↓
DOM 변이 감지 → 변이 위치가 어떤 region에 속하는지 판별
          ↓
해당 region을 "stale" 마킹
          ↓
User Trigger → stale region이면 re-extract, 아니면 캐시 사용
```

### 5.2 Skeleton & Region 타입

```ts
type SemanticSkeleton = {
  version: number
  pageType: string
  regions: SemanticRegionRef[]
  anchors: Map<string, WeakRef<Element>>
}

type SemanticRegionRef = {
  id: string
  kind: string                          // "story" | "comment-tree" | "article-body" | ...
  anchor: WeakRef<Element>              // DOM 참조 (GC 위임)
  state: "fresh" | "stale" | "unloaded"
  extractedAt?: number                  // timestamp
}
```

### 5.3 Case별 처리 전략

| Case | 전략 | 구현 |
|------|------|------|
| **SPA 라우트 전환** | Skeleton full rebuild | `pushState` / `popstate` / Navigation API 감지 |
| **점진적 콘텐츠 로딩** | Region invalidation | MutationObserver + `isStructuralMutation` 위임 |
| **실시간 콘텐츠 변이** | **Non-Goal (MVP 제외)** | 향후 "streaming skeleton" 모델로 별도 설계 |

### 5.4 MutationObserver 전략

단일 observer로 `document.body`를 감시하되, region anchor에 `data-semantic-region` attribute를 심어 `closest()` 기반 O(depth) 탐색으로 affected region을 판별한다.

```ts
const observer = new MutationObserver((mutations) => {
  const structuralChanges = mutations.filter(m =>
    m.type === 'childList' &&
    m.addedNodes.length > 0 &&
    currentExtractor.isStructuralMutation?.(m) !== false
  )

  if (structuralChanges.length > 0) {
    debouncedInvalidate(affectedRegions(structuralChanges))
  }
})

function affectedRegions(mutations: MutationRecord[]): string[] {
  return [...new Set(
    mutations
    .map(m => (m.target as Element).closest?.('[data-semantic-region]'))
    .filter(Boolean)
    .map(el => el!.getAttribute('data-semantic-region')!)
  )]
}
```

---

## 6. Semantic IR

### 6.1 설계 원칙

- AI와 인간 모두가 소비 가능한 포맷
- 확장 가능한 node 타입 시스템
- focus 중심 slice 표현

### 6.2 Node Types

```ts
/** 페이지 레벨 */
type PageNode = {
  id: string
  url: string
  title?: string
  kind: "article" | "thread" | "post" | "generic"
  metadata?: Record<string, string>
}

/** 콘텐츠 블록 */
type ContentNode = {
  id: string
  type: "paragraph" | "heading" | "quote" | "code" | "list" | "image"
  text: string
  level?: number            // heading level
  language?: string         // code block language
  attributes?: Record<string, string>
}

/** 댓글 */
type CommentNode = {
  id: string
  author?: string
  text: string
  timestamp?: string
  parentId?: string
  depth: number
  metadata?: Record<string, string>   // score, flags, etc.
}

/** 의미론적 영역 */
type SemanticRegion = {
  id: string
  kind: string
  nodes: (ContentNode | CommentNode)[]
  structure?: {
    type: "flat" | "tree" | "sequence"
    rootIds?: string[]
  }
}
```

### 6.3 Semantic Snapshot (출력 포맷)

```ts
type SemanticSnapshot = {
  /** 페이지 메타 */
  page: PageNode

  /** 사용자가 상호작용 중인 대상 */
  focus: {
    nodeId: string
    node: ContentNode | CommentNode
    region: string            // region id
  }

  /** focus 주변 맥락 */
  context: ContextSlice[]

  /** 스냅샷 메타 */
  meta: {
    capturedAt: string        // ISO timestamp
    skeletonVersion: number
    extractorId: string       // 어떤 plugin이 처리했는지
  }
}

type ContextSlice = {
  relation: "parent" | "child" | "sibling" | "container" | "ancestor"
  node: ContentNode | CommentNode
  distance: number            // focus로부터의 거리
}
```

### 6.4 Snapshot 예시 (HN comment)

```json
{
  "page": {
    "id": "hn-39281045",
    "url": "https://news.ycombinator.com/item?id=39281045",
    "title": "Show HN: I built a semantic browser extension",
    "kind": "thread"
  },
  "focus": {
    "nodeId": "comment-39281200",
    "node": {
      "id": "comment-39281200",
      "author": "pg",
      "text": "This is exactly the kind of thing we need...",
      "timestamp": "2024-02-15T10:30:00Z",
      "parentId": "comment-39281100",
      "depth": 1
    },
    "region": "comment-tree"
  },
  "context": [
    {
      "relation": "parent",
      "node": {
        "id": "comment-39281100",
        "author": "dang",
        "text": "Interesting approach to semantic extraction...",
        "parentId": null,
        "depth": 0
      },
      "distance": 1
    },
    {
      "relation": "child",
      "node": {
        "id": "comment-39281250",
        "author": "tptacek",
        "text": "Have you considered the privacy implications?",
        "parentId": "comment-39281200",
        "depth": 2
      },
      "distance": 1
    },
    {
      "relation": "sibling",
      "node": {
        "id": "comment-39281210",
        "author": "jgrahamc",
        "text": "We tried something similar at Cloudflare...",
        "parentId": "comment-39281100",
        "depth": 1
      },
      "distance": 1
    }
  ],
  "meta": {
    "capturedAt": "2024-02-15T12:00:00Z",
    "skeletonVersion": 2,
    "extractorId": "hackernews"
  }
}
```

---

## 7. Semantic Extraction Principles

이 섹션은 구현자가 모든 extractor에서 따라야 할 **의미론적 추출의 원칙**을 정의한다. 특정 사이트의 CSS selector를 하드코딩하는 것이 아니라, 범용적 signal에 기반하여 의미 구조를 판별하는 것이 핵심이다.

### 7.1 추출 파이프라인

모든 extractor는 다음 3단계 파이프라인을 따른다.

```
Phase 1: Structural Signal Detection
  DOM → semantic signal 수집 (HTML5 elements, ARIA, 반복 구조, 밀도 변화)

Phase 2: Semantic AST 변환
  signal이 가리키는 DOM subtree → dom-to-semantic-markdown의 AST로 변환
  → heading, list, table, blockquote 등의 semantic node type 획득

Phase 3: Domain Interpretation
  semantic AST 위에서 도메인 특화 의미를 해석
  (예: "반복되는 list item + nesting" → comment thread)
```

site-specific extractor는 Phase 3만 도메인에 맞게 구현한다. Phase 1–2는 공유 인프라다.

### 7.2 Semantic Region 판별 Signal

DOM subtree가 독립적인 semantic region인지 판별하는 signal 목록. 강도(weight) 순으로 나열한다.

**강한 signal (단독으로 region 판별 가능)**

| Signal | 판별 방법 | 예시 |
|--------|----------|------|
| HTML5 semantic elements | `<article>`, `<main>`, `<nav>`, `<aside>`, `<section>`, `<header>`, `<footer>` | `<article>` → content region |
| ARIA landmarks | `role="main"`, `role="navigation"`, `role="complementary"`, `role="contentinfo"` | `role="main"` → primary content |

**중간 signal (2개 이상 조합 시 region 판별 가능)**

| Signal | 판별 방법 | 예시 |
|--------|----------|------|
| 콘텐츠 밀도 변화 | text density가 주변 대비 급격히 높거나 낮은 경계 | sidebar ↔ main content 경계 |
| 반복 구조 | 동일 패턴의 DOM subtree가 3회 이상 반복 | comment list, feed items |
| 구조적 depth 변화 | 동일 반복 구조 내에서 nesting이 발생 | threaded comment (reply tree) |
| heading 기반 섹션 | `<h1>`~`<h6>` 또는 heading role이 콘텐츠 블록을 선행 | article sections |

**약한 signal (보조적 판단 근거)**

| Signal | 판별 방법 | 예시 |
|--------|----------|------|
| id/class naming convention | 의미론적 키워드 포함 (`comment`, `post`, `article`, `content`, `sidebar`) | 휴리스틱 보조 |
| interactive element 밀도 | 링크, 버튼이 집중된 영역 | navigation region |

### 7.3 Semantic Node 분류 체계

region 내부의 콘텐츠를 분류하는 범용 카테고리. site-specific 의미는 이 카테고리에서 파생된다.

```
SemanticCategory
 ├─ Content        (주요 콘텐츠)
 │   ├─ Article    (장문 텍스트, heading 구조)
 │   ├─ Post       (단문 텍스트, 독립적)
 │   └─ Media      (이미지, 비디오, 임베드)
 ├─ Discussion     (사용자 상호작용)
 │   ├─ Comment    (텍스트 + author + timestamp)
 │   ├─ Thread     (중첩된 comment 구조)
 │   └─ Reaction   (vote, emoji, etc.)
 ├─ Navigation     (이동/탐색)
 │   ├─ Menu       (사이트 내비게이션)
 │   ├─ Breadcrumb (현재 위치 경로)
 │   └─ Pagination (페이지 이동)
 └─ Metadata       (부가 정보)
     ├─ Author     (작성자 정보)
     ├─ Timestamp  (시간 정보)
     └─ Stats      (조회수, 점수 등)
```

site-specific extractor의 역할은 이 범용 카테고리를 **해당 사이트의 DOM에 매핑**하는 것이다.

예시 — HN extractor의 Phase 3:
```
반복 구조 감지 (Phase 1)
  → AST 변환: list items with nested sublists (Phase 2)
    → Domain Interpretation: "Discussion.Thread" (Phase 3)
      → 각 item을 CommentNode로 변환
```

### 7.4 dom-to-semantic-markdown 활용

`dom-to-semantic-markdown`은 Phase 2의 핵심 엔진이다. DOM subtree를 넘기면 semantic AST가 나온다.

```ts
import { htmlToMarkdownAST, SemanticMarkdownAST } from 'dom-to-semantic-markdown'

/** Phase 2: DOM subtree → Semantic AST */
function buildSemanticAST(element: Element): SemanticMarkdownAST[] {
  return htmlToMarkdownAST(element.innerHTML, {
    extractMainContent: false,      // region 자체가 관심 영역
    overrideElementProcessing: (el, options, indent) => {
      // Phase 3 진입점: 도메인 특화 처리를 여기서 주입
      return undefined  // undefined 반환 시 기본 처리
    }
  })
}
```

이 AST의 node type들이 Semantic Node 분류의 기반이 된다:

| AST Node Type | → Semantic Category |
|---------------|---------------------|
| `heading` (level 1-6) | Content.Article (구조적 heading) |
| `list` (ordered/unordered) | 반복 구조 → Discussion.Thread 후보 |
| `blockquote` | Content.Article (인용) 또는 Discussion.Comment (reply 맥락) |
| `table` | Content.Article (데이터) |
| `text` | Context에 따라 분류 |
| `link` | Navigation 또는 Content 내 참조 |
| `semanticHtml` (`article`, `nav`, ...) | 직접 region 판별 signal |

### 7.5 @mozilla/readability 활용

`@mozilla/readability`는 GenericArticleExtractor의 **Phase 1 signal detector**이다.

```ts
import { Readability, isProbablyReaderable } from '@mozilla/readability'

/** Phase 1: article 페이지인지 판별 */
function detectArticleRegion(document: Document): Element | null {
  if (!isProbablyReaderable(document)) return null

  const clone = document.cloneNode(true) as Document  // DOM 변형 방지
  const reader = new Readability(clone, {
    serializer: (el) => el  // DOM Element 그대로 반환
  })
  const result = reader.parse()
  return result?.content ?? null  // article body의 DOM Element
}
```

반환된 Element를 `dom-to-semantic-markdown`의 AST로 변환하면, article body의 의미 구조(heading 계층, paragraph, code block 등)를 얻는다.

---

## 8. Dependencies

### 8.1 핵심 의존성

| Package | 역할 | 파이프라인 위치 |
|---------|------|----------------|
| `@mozilla/readability` | Article 페이지 판별 + 본문 영역 추출 | Phase 1 (Signal Detection) |
| `dom-to-semantic-markdown` | DOM → Semantic AST 변환 엔진 | Phase 2 (AST 변환) |

### 8.2 아키텍처에서의 위치

```
DOM
 ↓
@mozilla/readability ─── "이 페이지에서 article body는 어디인가?" (Phase 1)
 ↓
dom-to-semantic-markdown ─── "이 DOM subtree의 의미 구조는 무엇인가?" (Phase 2)
 ↓
Site-specific interpretation ─── "이 AST가 이 사이트에서 무슨 뜻인가?" (Phase 3)
 ↓
Semantic IR (PageNode, ContentNode, CommentNode, ...)
```

`readability`는 "어디를 볼 것인가"를 결정하고, `dom-to-semantic-markdown`은 "본 것을 어떻게 이해할 것인가"를 담당한다. site-specific extractor는 이 이해 위에 도메인 의미를 부여한다.

---

## 9. Data Lifecycle

### 9.1 Page Load Phase

```
Page Load
  ↓
ExtractorRegistry.resolve(url, document)
  ↓
extractor.buildSkeleton(document)
  ↓
Skeleton v1 생성 + Session Created
  ↓
MutationObserver 감시 시작
```

### 9.2 User Trigger Phase

```
User Trigger (shortcut / context menu / selection)
  ↓
Browser Capture (URL, selection, active element, trigger target)
  ↓
extractor.resolveFocus(triggerTarget)
  ↓
region.state === "stale" ?
  → Yes: extractor.expandRegion(region) → state = "fresh"
  → No: 캐시 사용
  ↓
Context Slice Builder (focus + parent + children + siblings)
  ↓
Semantic Snapshot 생성
  ↓
Output (JSON)
```

### 9.3 Navigation Phase

```
URL Change 감지 (pushState / popstate / Navigation API)
  ↓
extractor.onNavigate?.(newUrl, prevUrl)
  ↓
"rebuild" → Skeleton full rebuild
"update"  → 변경된 region만 invalidate
"ignore"  → 무시 (hash change 등)
```

---

## 10. Performance Constraints

| 항목 | 목표 |
|------|------|
| Skeleton 구축 | < 50ms (DOM traversal only, no heavy parsing) |
| Region extraction | < 100ms per region |
| Snapshot 생성 (trigger → output) | < 500ms end-to-end |
| MutationObserver overhead | region invalidation만, debounce 300ms |
| Memory | WeakRef 기반 DOM 참조, GC 자동 정리 |

---

## 11. Privacy Principles

- 상시 사용자 추적 없음
- 데이터 수집은 **사용자 트리거 시점에만** 발생
- 최소 semantic context만 출력
- password/private input fields 자동 제외
- 외부 서버 전송 없음 (로컬 처리)

---

## 12. Non-Goals

이 시스템은 다음을 **명시적으로 목표하지 않는다.**

- AI integration (향후 계획, 현 스코프 밖)
- 전체 웹 크롤링 / 상시 추적
- 범용 knowledge graph 구축
- 전체 HTML을 AI에 전달
- 실시간 콘텐츠(채팅, 실시간 피드) 대응 → 향후 "streaming skeleton" 모델
- 서드파티 플러그인 런타임 로딩 (MVP)

---

## 13. MVP Scope

### 13.1 지원 사이트

| 사이트 | Extractor | 지원 region |
|--------|-----------|------------|
| Hacker News | `HackerNewsExtractor` | story, comment tree |
| Reddit | `RedditExtractor` | post, comment thread |
| Generic web | `GenericArticleExtractor` | article body, headings |

### 13.2 지원 기능

- text selection 기반 snapshot
- comment thread 구조화 snapshot
- article paragraph snapshot
- SPA navigation 대응 (skeleton rebuild)
- 점진적 콘텐츠 로딩 대응 (region invalidation)

### 13.3 지원 트리거

- keyboard shortcut
- context menu ("Capture Semantic Snapshot")
- extension popup UI
- text selection

---

## 14. Open Questions (MVP 이후)

| 항목 | 상태 | 비고 |
|------|------|------|
| Shadow DOM 지원 | 미결정 | Web Components 사용 사이트 증가 추세 |
| Cross-origin iframe | 미결정 | 보안 제약으로 접근 불가, postMessage 기반 협력 필요 |
| 서드파티 Plugin 배포 모델 | 향후 | npm? 확장 마켓? 런타임 로딩? |
| Cross-page semantic graph | 향후 | 여러 페이지 snapshot 연결 |
| AI-assisted semantic navigation | 향후 | AI가 region 단위로 페이지 탐색 |

---

## 15. Success Metrics

| 지표 | 목표 |
|------|------|
| Snapshot 생성 latency | < 500ms (trigger → output) |
| Extractor 정확도 | > 90% (지원 사이트 기준) |
| Skeleton 구축 시간 | < 50ms |
| 지원 사이트 커버리지 | HN, Reddit, generic article (MVP) |

---

## 16. Manifesto와의 관계

이 프로젝트는 Manifesto와 **같은 세계관의 별개 프로젝트**이다. 둘 다 "AI가 소비 가능한 의미론적 구조"라는 문제를 풀지만:

- **Manifesto**: 애플리케이션 수준의 shared world model (Snapshot + MEL 기반 semantic interface)
- **이 프로젝트**: 브라우저 수준의 웹 페이지 semantic extraction infrastructure

코드 의존성은 없으며, 철학적 기반을 공유한다.
