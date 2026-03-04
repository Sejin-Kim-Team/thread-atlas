# ThreadAtlas — Semantic Relay Spec v1.0

**FE 구현 명세서 (Chrome Extension)**

Version: 1.0
Date: 2025-03-04
Companion: Agent Brain Spec v1.1, PRD v1.0, Scenario Playbook v3.0

---

# 1. Overview

Semantic Relay는 ThreadAtlas의 브라우저 측 실행 환경이다. Chrome Extension으로 구현되며, 사용자의 브라우저 세계를 센서로 읽고, Agent Brain의 판단을 Projection으로 실현한다.

```
사용자                      Semantic Relay (FE)                    Agent Brain (BE)
──────                      ───────────────────                    ────────────────

  음성 ─────→ Side Panel
              │ Gemini Live
              │ processUserIntent FC
              │
              ├── Content Script에 센서 요청
              │     ↓ DOM 스냅샷 수집
              │     ↑ 센서 데이터 응답
              │
              ├── Service Worker에 viewport 요청
              │     ↓ captureVisibleTab
              │     ↑ base64 JPEG
              │
              ├── StateSnapshot 조립 ─────────→ POST /api/evaluate
              │
              │                        ←───────── SSE (projection[])
              │
              ├── respond → Gemini Live → 음성 ──→ 사용자
              ├── focus   → Content Script → DOM ──→ 사용자
              └── present → Side Panel UI ────────→ 사용자
```

## 1.1 핵심 원칙

**DOM 스냅샷 원칙.** 에이전트는 사용자와 같은 세계를 본다. 사용자가 브라우저에서 열어본 페이지의 DOM만 안다. 사용자가 열지 않은 원문은 모른다. "More"를 클릭하지 않은 댓글은 존재하지 않는다. 모든 센서는 요청 시점의 스냅샷이다.

**Side Panel이 세션 주인.** Gemini Live 연결, SSE 연결, ConversationContext, ContentGraph — 세션의 모든 상태를 Side Panel이 보유한다. 탭이 전환되어도 Side Panel은 유지되므로 세션이 끊기지 않는다.

**의도 선언, 실현 분리.** Agent Brain은 "무엇을 달성할지"를 선언하고 (focus, respond 등), 실현 방법은 Semantic Relay가 결정한다 (스크롤 타이밍, CSS 색상, 애니메이션 등).

---

# 2. Chrome Extension 구조

## 2.1 Manifest

```json
{
  "manifest_version": 3,
  "name": "ThreadAtlas",
  "version": "0.1.0",

  "permissions": [
    "activeTab",
    "scripting",
    "sidePanel",
    "storage"
  ],

  "host_permissions": [
    "*://news.ycombinator.com/*"
  ],

  "background": {
    "service_worker": "service-worker.js"
  },

  "side_panel": {
    "default_path": "sidepanel.html"
  },

  "content_scripts": [
    {
      "matches": ["*://news.ycombinator.com/*"],
      "js": ["content-hn.js"],
      "run_at": "document_idle"
    }
  ],

  "action": {
    "default_icon": "icons/icon-48.png",
    "default_title": "ThreadAtlas"
  }
}
```

## 2.2 파일 구조

```
extension/
├── manifest.json
├── sidepanel.html              # Side Panel 엔트리
├── sidepanel.js                # Side Panel 로직
├── service-worker.js           # Background Service Worker
├── content-hn.js               # HN 전용 Content Script (정적)
├── content-article.js          # 원문 추출 Content Script (동적)
├── icons/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
└── styles/
    └── highlight.css           # Projection 스타일 정의
```

## 2.3 실행 환경별 역할

```
Side Panel (세션 주인):
  - Gemini Live WebSocket 연결 관리
  - 마이크 입력 (MediaStream → AudioWorklet → 16kHz PCM)
  - 오디오 출력 (24kHz PCM → AudioContext)
  - StateSnapshot 조립
  - POST /api/evaluate SSE 연결
  - Projection 수신 및 라우팅
  - ConversationContext 보유
  - ContentGraph (DAG) 관리
  - present(sidebar) 콘텐츠 렌더링
  - notify 토스트 렌더링
  - Phase FSM 관리

Content Script — content-hn.js (정적, HN에만):
  - HN DOM 파싱 → ThreadDoc 추출
  - 원문 URL 추출 (a.titlelink의 href)
  - 센서 수집 (visibleComments, user.focus, user.selection, structure)
  - Projection 실행 (focus, focusMultiple → 하이라이트, 스크롤, 배지)
  - Side Panel과 메시지 통신

Content Script — content-article.js (동적, 원문 탭에만):
  - 원문 텍스트 추출 (document.body.innerText, 최대 5000자)
  - 페이지 구조 추출 (headings, landmarks)
  - 추출 결과 → Side Panel에 전달
  - 리스너 등록 후 대기, 요청 시에만 동작

Service Worker (중계 + Extension API):
  - chrome.tabs.captureVisibleTab (viewport 캡처)
  - chrome.tabs.onActivated (활성 탭 변경 감지)
  - chrome.tabs.onUpdated (원문 탭 감지 → 동적 inject)
  - POST /api/token (Ephemeral Token 요청)
  - knownArticleUrls 관리
  - Side Panel ↔ Content Script 메시지 라우팅
```

---

# 3. Side Panel

세션의 모든 상태를 보유하는 중앙 컨트롤러.

## 3.1 상태

```typescript
// Side Panel이 보유하는 전체 상태
interface SidePanelState {
  // 세션
  phase: Phase
  geminiLiveSession: LiveSession | null
  tokenExpiresAt: number | null

  // 콘텐츠
  contentGraph: ContentGraph
  activeTabId: number | null
  activeTabContext: TabContext | null

  // 대화
  conversationContext: ConversationContext | null
  cachedSemantics: ThreadSemantics | null

  // SSE
  currentAbortController: AbortController | null
}

type Phase = "initializing" | "ready" | "conversing" | "dormant" | "error"

interface TabContext {
  tabId: number
  url: string
  type: "hn_thread" | "hn_other" | "article" | "unrelated"
}
```

## 3.2 Phase FSM

```
                    ┌──────────────┐
                    │ initializing │
                    └──────┬───────┘
                           │ ThreadSemantics 수신 완료
                           ▼
              ┌──── │    ready     │ ←──── HN 탭 복귀
              │     └──────┬───────┘
              │            │ 사용자 발화 감지
              │            ▼
              │     ┌──────────────┐
              │     │  conversing  │ ←→ (SSE 진행 중)
              │     └──────┬───────┘
              │            │ done 이벤트 수신
              │            ▼
              │         ready로 복귀
              │
              │     HN이 아닌 탭으로 전환
              └───→ ┌──────────────┐
                    │   dormant    │
                    └──────────────┘

              어디서든 에러 발생
              ────→ ┌──────────────┐
                    │    error     │
                    └──────────────┘
```

### 전환 트리거

```
initializing → ready:
  POST /api/analyze 응답 수신 → cachedSemantics 저장
  Gemini Live 연결 완료

ready → conversing:
  Gemini Live에서 processUserIntent FC 발생

conversing → ready:
  SSE done 이벤트 수신

ready → dormant:
  chrome.tabs.onActivated → 활성 탭이 HN이 아님

dormant → ready:
  chrome.tabs.onActivated → 활성 탭이 HN 댓글 페이지
  cachedSemantics가 이미 있으면 바로 ready
  없으면 initializing 경유

* → error:
  Gemini Live 연결 실패
  Token 갱신 3회 실패
  복구 불가능한 에러
```

## 3.3 초기화 흐름

```
1. 사용자가 Extension 아이콘 클릭 → Side Panel 열림
2. Side Panel: Gemini Live 연결 시작
   a. POST /api/token → ephemeral token 수신
   b. ai.live.connect(config) → WebSocket 연결
   c. 마이크 권한 요청 (getUserMedia)
   d. AudioWorklet 초기화

3. 활성 탭 확인
   a. chrome.tabs.query({ active: true })
   b. URL이 HN 댓글 페이지인지 확인
   c. HN이면 → Content Script에 ThreadDoc 요청
   d. HN이 아니면 → Phase: dormant

4. ThreadDoc 수신
   a. Content Script에서 ThreadDoc + 원문 URL 수신
   b. ContentGraph에 thread 노드 추가
   c. 원문 URL → Service Worker에 knownArticleUrls 등록
   d. POST /api/analyze (threadDoc + articleUrl)

5. ThreadSemantics 수신
   a. cachedSemantics에 저장
   b. Phase: initializing → ready
```

---

# 4. Content Script — content-hn.js

HN 댓글 페이지에서 정적으로 로드되는 센서/액추에이터.

## 4.1 페이지 타입 감지

```typescript
function detectHNPageType(): "hn_thread" | "hn_other" {
  const url = window.location.href
  if (/news\.ycombinator\.com\/item\?id=\d+/.test(url)) {
    return "hn_thread"
  }
  return "hn_other"
}

// hn_thread에서만 센서/파서 활성화
// hn_other (프론트페이지, user 페이지 등)에서는 최소 리스너만
```

## 4.2 HN DOM 파서

```typescript
function parseThreadDoc(): ThreadDoc {
  const title = document.querySelector('.titleline a')?.textContent || ''
  const submitter = document.querySelector('.hnuser')?.textContent || ''
  const scoreText = document.querySelector('.score')?.textContent || '0'
  const score = parseInt(scoreText) || 0

  const commentRows = document.querySelectorAll('tr.athing.comtr')
  const comments: Comment[] = []

  for (const row of commentRows) {
    const id = row.getAttribute('id') || ''
    const author = row.querySelector('.hnuser')?.textContent || ''
    const text = row.querySelector('.commtext')?.textContent || ''
    const indent = row.querySelector('.ind')?.getAttribute('indent') || '0'
    const depth = parseInt(indent) || 0

    comments.push({
      id,              // HN 네이티브 ID 그대로 (예: "39900123")
      author,
      text,
      depth,
      score: null,     // 개별 댓글 점수는 본인 것만 보임
      parentId: null,  // depth 기반으로 추론 가능하나 MVP에서는 null
      timestamp: Date.now()
    })
  }

  return {
    url: window.location.href,
    title,
    submitter,
    score,
    comments
  }
}
```

## 4.3 원문 URL 추출

```typescript
function extractArticleUrl(): string | null {
  // HN 댓글 페이지 상단의 원문 링크
  const titleLink = document.querySelector('.titleline a') as HTMLAnchorElement | null
  if (!titleLink) return null

  const href = titleLink.href

  // HN 자체 URL이면 원문이 없는 것 (Ask HN, Show HN 등)
  if (href.includes('news.ycombinator.com')) return null

  return href
}
```

## 4.4 센서 수집

모든 센서는 메시지 요청 시점에 한 번 수집한다. 상시 추적하지 않는다.

```typescript
// 유일한 상시 추적: 마지막 hover 대상
let lastHoveredCommentId: string | null = null

document.addEventListener('mousemove', throttle((e: MouseEvent) => {
  const commentRow = (e.target as Element).closest('tr.athing.comtr')
  lastHoveredCommentId = commentRow?.getAttribute('id') || null
}, 200))


// 센서 수집 (요청 시점 스냅샷)
function collectSensors(): SensorData {
  return {
    visibleComments: getVisibleComments(),
    focus: getFocusedComment(),
    selection: getSelection(),
    structure: getPageStructure(),
    threadDoc: parseThreadDoc(),
    articleUrl: extractArticleUrl()
  }
}


function getVisibleComments(): VisibleComment[] {
  const commentRows = document.querySelectorAll('tr.athing.comtr')
  const viewportHeight = window.innerHeight
  const visible: VisibleComment[] = []

  for (const row of commentRows) {
    const rect = row.getBoundingClientRect()

    // 뷰포트 내에 일부라도 보이는 댓글
    if (rect.top < viewportHeight && rect.bottom > 0) {
      const text = row.querySelector('.commtext')?.textContent || ''
      visible.push({
        commentId: row.getAttribute('id') || '',
        author: row.querySelector('.hnuser')?.textContent || '',
        textPreview: text.slice(0, 150),
        depth: parseInt(row.querySelector('.ind')?.getAttribute('indent') || '0'),
        scoreIfAvailable: null
      })
    }
  }

  return visible
}


function getFocusedComment(): FocusedElement | null {
  if (!lastHoveredCommentId) return null

  const row = document.getElementById(lastHoveredCommentId)
  if (!row) return null

  return {
    commentId: lastHoveredCommentId,
    text: (row.querySelector('.commtext')?.textContent || '').slice(0, 150),
    source: "hover" as const
  }
}


function getSelection(): SelectedText | null {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || !sel.toString().trim()) return null

  const text = sel.toString().trim()

  // 선택 영역이 속한 댓글 찾기
  const anchorNode = sel.anchorNode
  const commentRow = anchorNode?.parentElement?.closest('tr.athing.comtr')
  const commentId = commentRow?.getAttribute('id') || null

  // 주변 컨텍스트 (선택 전후 100자)
  const container = commentRow?.querySelector('.commtext')
  const fullText = container?.textContent || ''
  const startIdx = Math.max(0, fullText.indexOf(text) - 100)
  const endIdx = Math.min(fullText.length, fullText.indexOf(text) + text.length + 100)
  const surroundingContext = fullText.slice(startIdx, endIdx)

  return { text, commentId, surroundingContext }
}


function getPageStructure(): PageStructure {
  const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).map(h => ({
    level: parseInt(h.tagName[1]),
    text: h.textContent?.trim() || ''
  }))

  const landmarks = Array.from(document.querySelectorAll('[role]')).map(el => ({
    role: el.getAttribute('role') || '',
    label: el.getAttribute('aria-label') || ''
  }))

  const commentRows = document.querySelectorAll('tr.athing.comtr')
  let maxDepth = 0
  for (const row of commentRows) {
    const depth = parseInt(row.querySelector('.ind')?.getAttribute('indent') || '0')
    if (depth > maxDepth) maxDepth = depth
  }

  return {
    headings,
    landmarks,
    commentCount: commentRows.length,
    nestingDepth: maxDepth
  }
}
```

## 4.5 Projection 실행

Side Panel에서 수신한 Projection 명령을 DOM에 실현한다.

```typescript
// 현재 활성화된 하이라이트 상태
interface HighlightState {
  type: "focus" | "focusMultiple"
  targets: Map<string, { style: string; label?: string; elements: HTMLElement[] }>
  dimmingActive: boolean
}

let currentHighlight: HighlightState | null = null


function executeFocus(commentId: string, options?: FocusOptions): void {
  // 이전 focus 처리
  if (currentHighlight) {
    if (currentHighlight.type === "focus") {
      // 이전 focus를 secondary로 전환
      for (const [id, target] of currentHighlight.targets) {
        if (id !== commentId) {
          updateHighlightStyle(id, target.elements, "secondary")
        }
      }
    } else if (currentHighlight.type === "focusMultiple") {
      // focusMultiple → focus: 전체 제거
      clearAllHighlights()
    }
  }

  const element = document.getElementById(commentId)
  if (!element) return

  // 스크롤
  if (options?.scroll !== false) {
    element.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  // 하이라이트 적용
  const style = options?.style || "primary"
  const highlightElements = applyHighlight(element, style)

  // 라벨 배지
  if (options?.label) {
    insertBadge(element, options.label, style)
  }

  // 상태 업데이트
  currentHighlight = {
    type: "focus",
    targets: new Map([[commentId, { style, label: options?.label, elements: highlightElements }]]),
    dimmingActive: false
  }

  // duration 자동 해제
  if (options?.duration) {
    setTimeout(() => {
      removeHighlight(commentId)
    }, options.duration * 1000)
  }
}


function executeFocusMultiple(targets: FocusTarget[], options?: FocusMultipleOptions): void {
  // 이전 하이라이트 전체 제거
  clearAllHighlights()

  // 비 대상 댓글 dimming
  applyDimming()

  // 각 target에 하이라이트 + 라벨 적용
  const targetMap = new Map<string, any>()

  for (const target of targets) {
    const element = document.getElementById(target.commentId)
    if (!element) continue

    const style = target.style || "primary"
    const highlightElements = applyHighlight(element, style)

    if (target.label) {
      insertBadge(element, target.label, style)
    }

    // dimming에서 제외
    element.classList.add('ta-highlight-target')

    targetMap.set(target.commentId, {
      style,
      label: target.label,
      elements: highlightElements
    })
  }

  // 스크롤
  const scrollTarget = options?.scrollTo || targets[0]?.commentId
  if (scrollTarget) {
    document.getElementById(scrollTarget)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  // 상태 업데이트
  currentHighlight = {
    type: "focusMultiple",
    targets: targetMap,
    dimmingActive: true
  }

  // duration
  if (options?.duration) {
    setTimeout(() => clearAllHighlights(), options.duration * 1000)
  }
}


// 하이라이트 스타일 적용
function applyHighlight(element: HTMLElement, style: string): HTMLElement[] {
  const className = `ta-highlight-${style}`   // ta-highlight-primary, etc.
  element.classList.add('ta-highlight', className)
  return [element]
}

function applyDimming(): void {
  const allComments = document.querySelectorAll('tr.athing.comtr')
  for (const comment of allComments) {
    if (!comment.classList.contains('ta-highlight-target')) {
      (comment as HTMLElement).classList.add('ta-dimmed')
    }
  }
}

function insertBadge(element: HTMLElement, label: string, style: string): void {
  // 기존 배지 제거
  element.querySelector('.ta-badge')?.remove()

  const badge = document.createElement('span')
  badge.className = `ta-badge ta-badge-${style}`
  badge.textContent = label

  const commhead = element.querySelector('.commhead')
  commhead?.appendChild(badge)
}

function clearAllHighlights(): void {
  document.querySelectorAll('.ta-highlight').forEach(el => {
    el.classList.remove('ta-highlight', 'ta-highlight-primary',
      'ta-highlight-secondary', 'ta-highlight-warning', 'ta-highlight-target')
  })
  document.querySelectorAll('.ta-badge').forEach(el => el.remove())
  document.querySelectorAll('.ta-dimmed').forEach(el => el.classList.remove('ta-dimmed'))
  currentHighlight = null
}
```

## 4.6 CSS 주입

content-hn.js가 로드 시 스타일을 주입한다. HN의 CSS와 충돌을 최소화하기 위해 `ta-` 접두사 사용.

```css
/* highlight.css — content-hn.js가 <style>로 주입 */

.ta-highlight {
  transition: background-color 0.3s ease, opacity 0.3s ease;
  border-radius: 4px;
}

.ta-highlight-primary {
  background-color: rgba(59, 130, 246, 0.12);      /* blue */
  border-left: 3px solid #3B82F6;
}

.ta-highlight-secondary {
  background-color: rgba(107, 114, 128, 0.08);     /* gray */
  border-left: 3px solid #9CA3AF;
}

.ta-highlight-warning {
  background-color: rgba(239, 68, 68, 0.10);       /* red */
  border-left: 3px solid #EF4444;
}

.ta-dimmed {
  opacity: 0.4;
  transition: opacity 0.3s ease;
}

.ta-badge {
  display: inline-block;
  padding: 2px 8px;
  margin-left: 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  vertical-align: middle;
}

.ta-badge-primary {
  background-color: #DBEAFE;
  color: #1D4ED8;
}

.ta-badge-secondary {
  background-color: #F3F4F6;
  color: #4B5563;
}

.ta-badge-warning {
  background-color: #FEE2E2;
  color: #DC2626;
}
```

## 4.7 메시지 핸들러

```typescript
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case "COLLECT_SENSORS":
      sendResponse(collectSensors())
      break

    case "GET_THREAD_DOC":
      sendResponse({
        threadDoc: parseThreadDoc(),
        articleUrl: extractArticleUrl()
      })
      break

    case "EXECUTE_PROJECTION":
      executeProjection(msg.projection)
      sendResponse({ ok: true })
      break
  }
  return true   // async sendResponse
})

function executeProjection(projection: Projection): void {
  switch (projection.type) {
    case "focus":
      executeFocus(projection.payload.commentId, projection.payload.options)
      break
    case "focusMultiple":
      executeFocusMultiple(projection.payload.targets, projection.payload.options)
      break
    // respond, present, notify, copy, navigate는 Side Panel이 직접 처리
  }
}
```

---

# 5. Content Script — content-article.js

원문 탭에 동적으로 주입되는 경량 스크립트.

## 5.1 inject 조건

Service Worker가 chrome.tabs.onUpdated를 감지하여, URL이 knownArticleUrls에 매칭될 때만 주입한다. HN과 무관한 페이지에는 절대 inject되지 않는다.

## 5.2 구현

```typescript
// content-article.js
// 동적 inject 시 즉시 실행하여 데이터 추출 후 Side Panel에 전송

(async () => {
  const data = {
    url: window.location.href,
    title: document.title,
    text: extractMainText(),
    structure: extractStructure(),
    extractedAt: Date.now()
  }

  chrome.runtime.sendMessage({
    type: "ARTICLE_CONTENT",
    payload: data
  })
})()


function extractMainText(): string {
  // <article> 태그 우선, 없으면 <main>, 없으면 body
  const article = document.querySelector('article')
    || document.querySelector('main')
    || document.querySelector('[role="main"]')
    || document.body

  const text = article.innerText || ''

  // 최대 5000자
  return text.slice(0, 5000)
}


function extractStructure(): PageStructure {
  const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).map(h => ({
    level: parseInt(h.tagName[1]),
    text: (h.textContent?.trim() || '').slice(0, 100)
  }))

  const landmarks = Array.from(document.querySelectorAll('[role]'))
    .filter(el => ['main', 'article', 'navigation', 'complementary'].includes(el.getAttribute('role') || ''))
    .map(el => ({
      role: el.getAttribute('role') || '',
      label: el.getAttribute('aria-label') || ''
    }))

  return {
    headings,
    landmarks,
    commentCount: 0,
    nestingDepth: 0
  }
}
```

---

# 6. Service Worker

백그라운드에서 Extension API를 사용하고 메시지를 라우팅한다.

## 6.1 상태

```typescript
// Service Worker 상태 (최소한)
const knownArticleUrls = new Map<string, string>()   // articleUrl → threadId
```

## 6.2 Side Panel 열기

```typescript
// Extension 아이콘 클릭 → Side Panel 열기
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
```

## 6.3 활성 탭 감지

```typescript
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId)

  // Side Panel에 활성 탭 변경 알림
  chrome.runtime.sendMessage({
    type: "ACTIVE_TAB_CHANGED",
    payload: {
      tabId: activeInfo.tabId,
      url: tab.url || '',
      title: tab.title || ''
    }
  })
})
```

## 6.4 원문 탭 감지 + 동적 inject

```typescript
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return

  // knownArticleUrls에 매칭되는지 확인
  if (knownArticleUrls.has(tab.url)) {
    // 원문 탭에 content-article.js 동적 주입
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content-article.js']
      })
    } catch (error) {
      console.error('Article script injection failed:', error)
    }
  }
})
```

## 6.5 Viewport 캡처

```typescript
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "CAPTURE_VIEWPORT") {
    chrome.tabs.captureVisibleTab(null, {
      format: 'jpeg',
      quality: 70           // 품질과 크기의 균형
    }, (dataUrl) => {
      // "data:image/jpeg;base64," 프리픽스 제거
      const base64 = dataUrl?.split(',')[1] || null
      sendResponse({ viewport: base64 })
    })
    return true   // async
  }

  if (msg.type === "REGISTER_ARTICLE_URL") {
    knownArticleUrls.set(msg.payload.url, msg.payload.threadId)
    sendResponse({ ok: true })
  }
})
```

## 6.6 Token 요청

```typescript
async function requestToken(): Promise<{ token: string; expiresAt: number }> {
  const response = await fetch(`${API_BASE_URL}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'user_sungwoo' })
  })
  return response.json()
}
```

---

# 7. ContentGraph (DAG)

Side Panel이 인메모리로 관리하는 콘텐츠 그래프.

## 7.1 데이터 구조

```typescript
interface ContentGraph {
  nodes: Map<string, ContentNode>    // nodeId → ContentNode
  edges: ContentEdge[]
}

interface ContentNode {
  id: string                         // URL의 SHA-256 해시 앞 16자
  url: string
  title: string
  type: "article" | "thread"

  snapshot: {
    text: string                     // 본문 텍스트
    structure: PageStructure
    extractedAt: number
  } | null                           // 아직 사용자가 방문하지 않았으면 null
}

interface ThreadNode extends ContentNode {
  type: "thread"
  platform: "hn"
  threadDoc: ThreadDoc | null
  semantics: ThreadSemantics | null
  sourceArticleUrl: string | null    // HN DOM에서 추출한 원문 URL
}

interface ContentEdge {
  from: string                       // Node ID
  to: string                         // Node ID
  relation: "triggers"               // MVP: 원문 → 스레드
}
```

## 7.2 그래프 조작

```typescript
class ContentGraphManager {
  private graph: ContentGraph = { nodes: new Map(), edges: [] }

  // HN 댓글 페이지 방문 시
  addThread(threadDoc: ThreadDoc, articleUrl: string | null): string {
    const id = hashUrl(threadDoc.url)
    const node: ThreadNode = {
      id,
      url: threadDoc.url,
      title: threadDoc.title,
      type: "thread",
      platform: "hn",
      threadDoc,
      semantics: null,
      sourceArticleUrl: articleUrl,
      snapshot: null
    }
    this.graph.nodes.set(id, node)

    // 원문 URL이 있으면 edge 예약 (article 노드는 아직 없을 수 있음)
    if (articleUrl) {
      const articleId = hashUrl(articleUrl)
      this.graph.edges.push({
        from: articleId,
        to: id,
        relation: "triggers"
      })
    }

    return id
  }

  // 원문 탭 방문 시 (content-article.js에서 데이터 수신)
  addArticle(url: string, title: string, text: string, structure: PageStructure): string {
    const id = hashUrl(url)
    const node: ContentNode = {
      id,
      url,
      title,
      type: "article",
      snapshot: {
        text,
        structure,
        extractedAt: Date.now()
      }
    }
    this.graph.nodes.set(id, node)
    return id
  }

  // StateSnapshot 조립 시 sourceArticle 조회
  getSourceArticle(threadId: string): ArticleContext | null {
    const thread = this.graph.nodes.get(threadId) as ThreadNode | undefined
    if (!thread?.sourceArticleUrl) return null

    const articleId = hashUrl(thread.sourceArticleUrl)
    const article = this.graph.nodes.get(articleId)

    if (!article?.snapshot) return null   // 사용자가 원문을 아직 열지 않음

    return {
      url: article.url,
      title: article.title,
      text: article.snapshot.text,
      structure: article.snapshot.structure,
      readAt: article.snapshot.extractedAt
    }
  }
}

function hashUrl(url: string): string {
  // 브라우저 환경: SubtleCrypto 사용
  // 간소화 버전 (MVP):
  let hash = 0
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return Math.abs(hash).toString(16).padStart(16, '0').slice(0, 16)
}
```

## 7.3 그래프 생명주기

```
Side Panel 열림 → 빈 그래프 생성
HN 댓글 페이지 진입 → addThread()
원문 탭 열림 → addArticle()
Side Panel 닫힘 → 그래프 소멸 (인메모리)

MVP에서 그래프를 영속화하지 않는다.
세션 종료 시 사라진다.
과거 세션의 그래프 정보는 Firestore의 threadHistory에서 보관.
```

---

# 8. StateSnapshot 조립

Side Panel이 센서 데이터를 수집하고 StateSnapshot을 조립하는 전체 흐름.

## 8.1 조립 흐름

```typescript
async function assembleStateSnapshot(
  intent: Intent,
  contentGraph: ContentGraphManager,
  conversationContext: ConversationContext | null,
  cachedSemantics: ThreadSemantics | null,
  activeTabId: number
): Promise<StateSnapshot> {

  // 1. Content Script에서 센서 수집
  const sensors = await sendToContentScript(activeTabId, { type: "COLLECT_SENSORS" })

  // 2. sourceArticle 조회 (ContentGraph에서)
  const currentThreadId = hashUrl(sensors.threadDoc?.url || '')
  const sourceArticle = contentGraph.getSourceArticle(currentThreadId)

  // 3. viewport 캡처 (필요시만)
  let viewport: string | null = null
  if (intent.intentType === "contextual_query" || intent.intentType === "general") {
    const capture = await sendToServiceWorker({ type: "CAPTURE_VIEWPORT" })
    viewport = capture.viewport
  }

  // 4. intentType별 user 필드 결정
  const user = assembleUserContext(intent.intentType!, sensors, intent.transcript!)

  // 5. 조립
  return {
    intent,
    page: {
      url: sensors.threadDoc?.url || '',
      title: sensors.threadDoc?.title || '',
      content: {
        threadDoc: null,           // evaluate에서는 항상 null (BE가 Firestore에서 조회)
        structure: sensors.structure,
        visibleComments: sensors.visibleComments
      }
    },
    user,
    viewport,
    sourceArticle,
    semantics: cachedSemantics,
    conversationContext
  }
}

function assembleUserContext(
  intentType: IntentType,
  sensors: SensorData,
  speech: string
): StateSnapshot['user'] {

  switch (intentType) {
    case "contextual_query":
      return {
        speech,
        selection: sensors.selection,
        focus: sensors.focus
      }

    case "memory_query":
    case "general":
      return {
        speech,
        selection: sensors.selection,     // 있으면 포함
        focus: sensors.focus              // 있으면 포함
      }

    case "briefing_request":
    case "navigation_request":
    case "clarification_response":
    default:
      return {
        speech,
        selection: null,
        focus: null
      }
  }
}
```

## 8.2 조립 타이밍

```
조립은 Gemini Live에서 processUserIntent FC가 발생했을 때 한 번만 실행된다.
주기적으로 실행하지 않는다.
사용자가 말할 때만 세계를 찍는다.
```

---

# 9. SSE 연결 + Projection 라우팅

## 9.1 SSE 연결

```typescript
async function callEvaluate(
  stateSnapshot: StateSnapshot,
  conversationContext: ConversationContext | null
): Promise<void> {

  // 이전 SSE 연결이 있으면 중단 (barge-in)
  if (currentAbortController) {
    currentAbortController.abort()
  }

  const abortController = new AbortController()
  currentAbortController = abortController

  const response = await fetch(`${API_BASE_URL}/api/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stateSnapshot, conversationContext }),
    signal: abortController.signal
  })

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          const eventType = line.slice(7).trim()
          continue
        }
        if (line.startsWith('data: ')) {
          const data = JSON.parse(line.slice(6))
          handleSSEEvent(currentEventType, data)
        }
      }
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      // Barge-in에 의한 정상 중단
      return
    }
    handleSSEError(error)
  } finally {
    currentAbortController = null
  }
}
```

## 9.2 Projection 라우팅

```typescript
function handleSSEEvent(eventType: string, data: any): void {
  switch (eventType) {
    case "projection":
      routeProjection(data)
      break

    case "done":
      handleDone(data)
      break

    case "error":
      handleSSEError(data)
      break
  }
}


function routeProjection(projection: Projection): void {
  switch (projection.type) {

    // → Gemini Live로 전달 → 음성 출력
    case "respond":
      handleRespond(projection.payload)
      break

    // → Content Script로 전달 → DOM 조작
    case "focus":
    case "focusMultiple":
      sendToContentScript(activeTabId!, {
        type: "EXECUTE_PROJECTION",
        projection
      })
      break

    // → Service Worker로 전달 → 새 탭
    case "navigate":
      handleNavigate(projection.payload)
      break

    // → Side Panel 내부 렌더링
    case "present":
      handlePresent(projection.payload)
      break

    // → Side Panel 내부 토스트
    case "notify":
      handleNotify(projection.payload)
      break

    // → 클립보드 복사
    case "copy":
      navigator.clipboard.writeText(projection.payload.text)
      showCopyToast()
      break
  }
}
```

## 9.3 respond 처리

```typescript
function handleRespond(payload: { text: string; mode: string }): void {
  // Gemini Live에 Function Result로 전달
  // → Gemini Live가 자연스러운 음성으로 읽어줌
  geminiLiveSession.sendFunctionResult({
    name: "agentResponse",
    response: { text: payload.text }
  })

  // mode별 추가 처리
  switch (payload.mode) {
    case "suggest":
      // 선택지 UI 표시 (Side Panel 내부)
      showSuggestChips(payload.text)
      break

    case "clarify":
      // pendingClarification은 done 이벤트에서 처리
      break

    case "answer":
      // 추가 처리 없음
      break
  }
}
```

## 9.4 done 처리

```typescript
function handleDone(data: {
  conversationContext: ConversationContext;
  memoryDelta: MemoryDelta | null
}): void {
  // ConversationContext 업데이트
  conversationContext = data.conversationContext

  // Phase 전환
  phase = "ready"

  // memoryDelta는 Side Panel이 보관
  // 다음 세션에서 필요하면 BE가 Firestore에서 조회
}
```

---

# 10. Gemini Live 연결

## 10.1 연결 설정

```typescript
async function connectGeminiLive(token: string): Promise<LiveSession> {
  const session = await ai.live.connect({
    model: "gemini-2.5-flash-native-audio-preview-12-2025",
    config: {
      responseModalities: ["AUDIO"],
      systemInstruction: {
        parts: [{
          text:
            "You are a voice interface for ThreadAtlas. " +
            "When the user speaks, call processUserIntent with their request. " +
            "When you receive a function result, speak it naturally in the same language the user used. " +
            "You do NOT analyze or judge — just relay faithfully. " +
            "Keep your spoken output natural and conversational."
        }]
      },
      tools: [{
        functionDeclarations: [{
          name: "processUserIntent",
          description:
            "사용자가 말을 했을 때 호출한다. " +
            "transcript에 사용자의 발화 전문을, " +
            "intentType에 발화의 의도 분류를 전달한다.",
          parameters: {
            type: "object",
            properties: {
              transcript: {
                type: "string",
                description: "사용자 발화 전문"
              },
              intentType: {
                type: "string",
                enum: [
                  "briefing_request",
                  "contextual_query",
                  "memory_query",
                  "navigation_request",
                  "clarification_response",
                  "general"
                ],
                description:
                  "briefing_request: 요약/핵심 요청. " +
                  "contextual_query: '이 댓글', '이거 뭐야' 등 현재 보이는 것에 대한 질문. " +
                  "memory_query: '전에 본 것 같다', '기억나?' 등 과거 참조. " +
                  "navigation_request: '보여줘', '열어줘', '다음', '뒤로' 등 이동 요청. " +
                  "clarification_response: 직전 clarify에 대한 답변. " +
                  "general: 위에 해당하지 않는 모든 발화."
              }
            },
            required: ["transcript", "intentType"]
          }
        }]
      }]
    }
  })

  // Function Call 핸들러 등록
  session.onFunctionCall = async (functionCall) => {
    if (functionCall.name === "processUserIntent") {
      await handleUserIntent(functionCall.args as Intent)
    }
  }

  return session
}
```

## 10.2 Intent 처리 파이프라인

```typescript
async function handleUserIntent(intent: Intent): Promise<void> {
  // Phase 전환
  phase = "conversing"

  // StateSnapshot 조립
  const snapshot = await assembleStateSnapshot(
    intent,
    contentGraph,
    conversationContext,
    cachedSemantics,
    activeTabId!
  )

  // Agent Brain 호출 (SSE)
  await callEvaluate(snapshot, conversationContext)
}
```

---

# 11. 오디오 파이프라인

## 11.1 마이크 권한

```
획득 시점: Side Panel 초기화 시 (Gemini Live 연결 직전)
API: navigator.mediaDevices.getUserMedia({ audio: true })
실패 시: Phase → error, Side Panel에 "마이크 권한이 필요합니다" 표시
```

## 11.2 입력 (마이크 → Gemini Live)

```
MediaStream (마이크)
  → AudioWorklet (리샘플링: 브라우저 기본 → 16kHz PCM mono)
  → Gemini Live WebSocket

AudioWorklet이 필요한 이유:
  브라우저의 기본 샘플레이트는 44.1kHz 또는 48kHz.
  Gemini Live는 16kHz PCM mono를 요구.
  AudioWorklet에서 다운샘플링.
```

## 11.3 출력 (Gemini Live → 스피커)

```
Gemini Live Native Audio 응답
  → 24kHz PCM mono 스트림
  → AudioContext의 AudioBufferSourceNode로 재생

Gemini Live가 음성 합성까지 처리하므로
별도 TTS 엔진은 불필요.
```

## 11.4 Barge-in

```
Gemini Live Native barge-in을 그대로 사용한다.
Gemini Live가 자동으로:
  1. 사용자 음성 입력 감지
  2. 현재 오디오 출력 중단
  3. 새 processUserIntent FC 발생

FE가 추가로 하는 것:
  1. processUserIntent FC 수신
  2. 진행 중인 SSE abort
  3. Projection 큐 폐기
  4. ConversationContext에 interrupted 기록
  5. 새 StateSnapshot 조립 → 새 evaluate 호출
```

---

# 12. Token 갱신

```typescript
class TokenManager {
  private tokenExpiresAt: number = 0
  private renewalTimer: number | null = null

  async initialize(): Promise<string> {
    const { token, expiresAt } = await requestToken()
    this.tokenExpiresAt = expiresAt
    this.scheduleRenewal()
    return token
  }

  private scheduleRenewal(): void {
    // 만료 2분 전에 갱신
    const renewAt = (this.tokenExpiresAt * 1000) - Date.now() - (2 * 60 * 1000)
    if (renewAt <= 0) {
      this.renew()
      return
    }
    this.renewalTimer = setTimeout(() => this.renew(), renewAt)
  }

  private async renew(): Promise<void> {
    let retries = 3
    while (retries > 0) {
      try {
        const { token, expiresAt } = await requestToken()
        this.tokenExpiresAt = expiresAt
        this.scheduleRenewal()

        // Gemini Live 세션에 새 토큰 적용
        await reconnectGeminiLive(token)
        return
      } catch (error) {
        retries--
        if (retries > 0) {
          await sleep(1000)
        }
      }
    }

    // 3회 실패 → error
    phase = "error"
    showNotify("세션이 만료됐어요. 다시 시작해주세요.", "error")
  }
}
```

---

# 13. Barge-in Protocol

## 13.1 처리 순서

```
1. Gemini Live: barge-in 감지 → 현재 음성 출력 중단
2. Gemini Live: 새 processUserIntent FC 발생
3. Side Panel: currentAbortController.abort() → 진행 중인 SSE 종료
4. Side Panel: Projection 큐는 자동으로 폐기됨 (SSE 스트림 종료)
5. Side Panel: ConversationContext 마지막 턴 업데이트
6. Side Panel: 새 handleUserIntent() 호출 → 새 사이클
```

## 13.2 ConversationContext 중단 기록

```typescript
function recordInterruption(): void {
  if (!conversationContext || conversationContext.turns.length === 0) return

  const lastTurn = conversationContext.turns[conversationContext.turns.length - 1]

  // 이미 delivered된 Projection 기반으로 부분 결과 기록
  lastTurn.action += " (interrupted)"
  lastTurn.result += " — partially delivered"
}
```

---

# 14. Focus Lifecycle

Content Script(content-hn.js)가 관리하는 하이라이트 상태 전환 규칙.

## 14.1 전환 규칙

```
focus(A, primary) → focus(B, warning)
  A: primary → secondary로 전환
  B: warning으로 활성화

focus(A, primary) → focus(A, warning)
  A: options만 업데이트 (primary → warning)

focus(A, primary, duration: 5) → [3초 후] focus(B, primary)
  A: duration 타이머 취소, secondary로 전환
  B: primary로 활성화

focus(A) → focusMultiple([B, C, D])
  A: 제거
  B, C, D: 각각 스타일 적용
  나머지 댓글: dimming

focusMultiple([A, B]) → focus(C)
  A, B: 제거, dimming 해제
  C: 활성화

focusMultiple([A, B]) → focusMultiple([C, D])
  A, B: 제거
  C, D: 교체
```

## 14.2 사이클 간

```
새 POST /api/evaluate 시작:
  이전 하이라이트 유지 (자동 정리 안 함)
  새 사이클에서 Agent Brain이 focus를 보내면 위 규칙에 따라 전환
  focus를 안 보내면 이전 것 유지
```

---

# 15. 메시지 프로토콜

컴포넌트 간 chrome.runtime.sendMessage / chrome.runtime.onMessage 통신 규격.

## 15.1 Content Script → Side Panel

```typescript
// content-hn.js → Side Panel
{ type: "HN_PAGE_LOADED", payload: { url: string, pageType: "hn_thread" | "hn_other" } }
{ type: "THREAD_DOC_READY", payload: { threadDoc: ThreadDoc, articleUrl: string | null } }
{ type: "DOM_CHANGED", payload: { newCommentCount: number } }

// content-article.js → Side Panel (Service Worker 경유)
{ type: "ARTICLE_CONTENT", payload: ArticleContent }
```

## 15.2 Side Panel → Content Script

```typescript
// Side Panel → content-hn.js (Service Worker 경유, 특정 tabId)
{ type: "COLLECT_SENSORS" }
  → Response: SensorData

{ type: "GET_THREAD_DOC" }
  → Response: { threadDoc: ThreadDoc, articleUrl: string | null }

{ type: "EXECUTE_PROJECTION", projection: Projection }
  → Response: { ok: boolean }
```

## 15.3 Side Panel → Service Worker

```typescript
{ type: "CAPTURE_VIEWPORT" }
  → Response: { viewport: string | null }     // base64 JPEG

{ type: "REGISTER_ARTICLE_URL", payload: { url: string, threadId: string } }
  → Response: { ok: boolean }

{ type: "REQUEST_TOKEN" }
  → Response: { token: string, expiresAt: number }

{ type: "OPEN_TAB", payload: { url: string, active: boolean } }
  → Response: { tabId: number }
```

## 15.4 Service Worker → Side Panel

```typescript
{ type: "ACTIVE_TAB_CHANGED", payload: { tabId: number, url: string, title: string } }
{ type: "ARTICLE_INJECTED", payload: { tabId: number, url: string } }
```

## 15.5 라우팅

```
Side Panel ↔ Service Worker: 직접 통신 (chrome.runtime.sendMessage)
Side Panel → Content Script: Service Worker 경유
  chrome.tabs.sendMessage(tabId, msg)
Content Script → Side Panel: chrome.runtime.sendMessage → Side Panel의 onMessage에서 수신
```

---

# 16. 에러 핸들링

## 16.1 Side Panel 에러

```
Gemini Live 연결 실패:
  → Phase: error
  → Side Panel UI: "음성 연결에 실패했어요. 다시 시도해주세요." + 재시도 버튼

SSE 연결 끊김 (evaluate 중):
  → 이미 실행된 Projection은 유효 (되돌리지 않음)
  → Side Panel 토스트: "연결이 끊겼어요. 다시 질문해주세요."
  → Phase: ready (conversing에서 복귀)

SSE error 이벤트 수신:
  → Gemini Live에 에러 메시지 전달 → 음성으로 안내
  → "죄송해요, 분석 중 문제가 생겼어요. 다시 질문해주세요."
  → Phase: ready
```

## 16.2 Content Script 에러

```
센서 수집 실패:
  → 빈 SensorData 반환
  → StateSnapshot에 visibleComments: [], focus: null, selection: null
  → Agent Brain은 제한된 정보로 응답 (graceful degradation)

Projection 실행 실패 (댓글 DOM 변경됨 등):
  → { ok: false } 반환
  → Side Panel은 무시 (에이전트 응답은 이미 음성으로 전달됨)
  → 치명적이지 않음 — 하이라이트 실패일 뿐

content-article.js inject 실패:
  → CSP나 권한 문제로 inject 안 됨
  → sourceArticle: null (자연스러운 fallback)
  → Agent Brain: "아직 원문 내용을 파악하지 못했어요"
```

## 16.3 Service Worker 에러

```
captureVisibleTab 실패:
  → viewport: null 반환
  → contextual_query에서도 viewport 없이 동작
  → Agent Brain은 visibleComments + focus로 판단

Token 요청 실패:
  → TokenManager의 3회 재시도 로직에 위임
  → 최종 실패 시 Phase: error
```

---

# 17. Side Panel UI

## 17.1 레이아웃

```
┌──────────────────────────────────────┐
│ ThreadAtlas                    [●]   │  ← 상태 인디케이터 (Phase별 색상)
├──────────────────────────────────────┤
│                                      │
│  [present 콘텐츠 영역]               │  ← present(sidebar) 시 카드 렌더링
│                                      │
│                                      │
├──────────────────────────────────────┤
│  [suggest 선택지 칩]                 │  ← respond(suggest) 시 표시
│  [ claim_1 상세 ] [ claim_2 상세 ]   │
├──────────────────────────────────────┤
│  [notify 토스트]                     │  ← 하단 토스트, 3초 후 자동 사라짐
└──────────────────────────────────────┘
```

## 17.2 상태 인디케이터

```
Phase별 표시:

  initializing: 노란색 ● + "분석 중..."
  ready:        초록색 ● + "준비됨"
  conversing:   파란색 ● (펄스 애니메이션) + "듣는 중..."
  dormant:      회색 ● + "대기 중"
  error:        빨간색 ● + "오류" + 재시도 버튼
```

## 17.3 suggest 선택지

```
respond(mode: "suggest") 수신 시:
  text에서 선택지를 파싱하거나, 고정 선택지를 표시.
  사용자가 칩을 클릭하면:
    → 해당 텍스트를 Gemini Live에 텍스트 입력으로 전달
    → 새 processUserIntent FC 발생
    → 음성 입력과 동일한 흐름
```

## 17.4 present 렌더링

```
present(sidebar) 수신 시:
  content.items를 카드 리스트로 렌더링.
  각 카드: source, summary, url (클릭 가능), relevance 태그.

  persistent: false → 다음 present 도착 시 교체
  persistent: true  → 사용자가 닫을 때까지 유지

present(overlay) 수신 시:
  Side Panel 상단에 떠다니는 패널로 렌더링.
  persistent: false → 5초 후 또는 다음 도착 시 자동 닫힘.
```

---

# 18. MVP 단순화

```
인증: 없음 (userId 하드코딩)
Side Panel 프레임워크: 순수 HTML + JS (React 미사용)
  → MVP에서 Side Panel UI가 단순하므로 프레임워크 불필요
  → present 카드, suggest 칩, notify 토스트 정도
  → 프로덕션에서 복잡해지면 React 도입

content-article.js: 기본 innerText 추출만
  → 프로덕션에서 Readability.js 등 정교한 본문 추출로 교체

ContentGraph: 인메모리 Map
  → 프로덕션에서 chrome.storage.session으로 세션 간 유지 가능

오디오: Gemini Live의 기본 오디오 설정 사용
  → 커스텀 AudioWorklet 리샘플링이 필요하면 구현
  → Gemini Live SDK가 내부적으로 처리하면 불필요
```