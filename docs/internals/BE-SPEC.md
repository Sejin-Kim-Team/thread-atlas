# ThreadAtlas — Agent Brain Spec v1.0

**BE 구현 명세서**

Version: 1.1
Date: 2025-03-04
Companion: PRD v1.0, Scenario Playbook v3.0, Semantic Relay Spec v1.0

---

# 1. Overview

Agent Brain은 ThreadAtlas의 판단 엔진이다. FE(Semantic Relay)로부터 StateSnapshot을 받아, Gemini 2.5 Flash의 tool-use 에이전틱 루프로 추론하고, Projection을 SSE로 스트리밍한다.

```
FE                          BE (Agent Brain)                    External
──                          ────────────────                    ────────
                      ┌──────────────────────────┐
POST /api/evaluate    │  Layer 1: Request Handler │
  StateSnapshot ─────→│  Layer 2: Prompt Assembler│
                      │  Layer 3: Agentic Loop    │──→ Gemini 2.5 Flash
  SSE stream    ←─────│  Layer 4: Internal Tools  │──→ Firestore
  (Projection[])      │  Layer 5: Side Effects    │
                      └──────────────────────────┘
```

핵심 원칙:

- **Stateless.** ConversationContext는 FE가 매 요청에 전달한다.
- **Streaming.** Projection은 생성 즉시 SSE로 전달한다. 루프 완료를 기다리지 않는다.
- **의도 선언.** Agent Brain은 "무엇을 달성할지"를 Projection Tool로 선언하고, "어떻게 브라우저에서 실현할지"는 FE가 결정한다.
- **DOM 스냅샷 원칙.** 에이전트는 사용자와 같은 세계를 본다. 사용자가 브라우저에서 열어본 페이지의 DOM만 안다. 사용자가 열지 않은 원문은 모른다. 지식의 경계가 투명하다.

---

# 2. API Contract

## 2.1 POST /api/evaluate (SSE Stream)

Agent Brain의 핵심 엔드포인트.

### Request

```typescript
POST /api/evaluate
Content-Type: application/json

{
  stateSnapshot: StateSnapshot,
  conversationContext?: ConversationContext
}
```

### Response (SSE)

```
event: projection
data: { "type": "respond", "payload": { "text": "...", "mode": "answer" } }

event: projection
data: { "type": "focus", "payload": { "commentId": "c45", "options": { "label": "핵심 근거", "style": "primary" } } }

event: projection
data: { "type": "respond", "payload": { "text": "...", "mode": "answer" } }

event: done
data: {
  "conversationContext": { ... },
  "memoryDelta": { ... } | null
}
```

### SSE Event Types

| Event | 설명 | 빈도 |
|-------|------|------|
| `projection` | FE가 실행할 Projection Tool 호출 | 1~N회 |
| `done` | 루프 완료. ConversationContext + memoryDelta 포함 | 정확히 1회 |
| `error` | 처리 불가 에러 | 0~1회 |

### Error Response

```
event: error
data: { "code": "GEMINI_FAILED" | "TIMEOUT" | "INTERNAL_ERROR", "message": "..." }
```

에러 이벤트 후 SSE 연결은 즉시 닫힌다. FE는 로컬에서 사용자에게 음성 안내를 생성한다.

---

## 2.2 POST /api/token

Gemini Live 연결용 Ephemeral Token 발급.

### Request

```typescript
POST /api/token
Content-Type: application/json

{ "userId": "user_sungwoo" }
```

### Response

```typescript
{
  "token": "ephemeral_token_string",
  "expiresAt": 1709338200    // Unix timestamp, 발급 후 10분
}
```

### MVP 참고

- constraints 미사용 (보안 불필요)
- userId 하드코딩

---

## 2.3 POST /api/analyze

페이지 최초 방문 시 ThreadDoc → ThreadSemantics 변환.

### Request

```typescript
POST /api/analyze
Content-Type: application/json

{
  "userId": "user_sungwoo",
  "threadDoc": ThreadDoc,
  "articleUrl": string | null      // HN DOM에서 추출한 원문 URL
}
```

### Response

```typescript
{
  "threadSemantics": ThreadSemantics,
  "cached": boolean               // true면 Firestore 캐시 히트
}
```

### Side Effect

- `threads/{threadId}/semantics`에 ThreadSemantics 저장
- `threads/{threadId}/doc`에 ThreadDoc 저장 (Internal Tool이 나중에 조회)
- `threads/{threadId}/meta`에 articleUrl, platform 저장
- `users/{userId}/threadHistory/{threadId}` 생성 또는 lastAccessedAt 업데이트

---

# 3. Data Types

## 3.1 StateSnapshot

FE가 Intent별 센서를 조합하여 조립하는 단일 입력.

```typescript
interface StateSnapshot {
  intent: Intent

  page: {
    url: string
    title: string
    content: PageContent
  }

  user: {
    speech: string | null
    selection: SelectedText | null
    focus: FocusedElement | null
  }

  viewport: string | null         // base64 JPEG, 필요시만

  // 원문 아티클 (사용자가 브라우저에서 열어본 경우만)
  sourceArticle: ArticleContext | null

  semantics: ThreadSemantics | null

  conversationContext: ConversationContext | null
}
```

### ArticleContext

```typescript
interface ArticleContext {
  url: string
  title: string
  text: string                    // 본문 텍스트 (최대 5000자)
  structure: PageStructure        // 접근성 트리 기반
  readAt: number                  // 사용자가 원문 탭을 방문한 시점
}
```

sourceArticle은 사용자가 HN에서 원문 링크를 클릭하여 해당 탭을 열었을 때만 채워진다. FE(Side Panel)가 ContentGraph에서 현재 스레드의 원문 노드를 찾아 포함한다. 사용자가 원문을 열지 않았으면 null이며, Agent Brain은 원문에 대한 단정적 진술을 하지 않는다.

### PageContent

```typescript
interface PageContent {
  threadDoc: null                 // evaluate에서는 항상 null
                                  // BE가 필요시 Firestore에서 조회

  structure: PageStructure        // 접근성 트리 기반 (항상 포함)

  visibleComments: VisibleComment[]  // 현재 뷰포트에 보이는 댓글 (항상 포함)
}

interface PageStructure {
  headings: { level: number; text: string }[]
  landmarks: { role: string; label: string }[]
  commentCount: number
  nestingDepth: number
}

interface VisibleComment {
  commentId: string
  author: string
  textPreview: string             // 첫 150자
  depth: number
  scoreIfAvailable: number | null
}
```

### User Context

```typescript
interface SelectedText {
  text: string
  commentId: string | null
  surroundingContext: string       // 선택 전후 100자
}

interface FocusedElement {
  commentId: string | null
  text: string
  source: "hover" | "keyboard" | "proximity"
}
```

### Intent

```typescript
interface Intent {
  type: "UserSpeech" | "UserSelection" | "PageNavigation"
  transcript?: string
  intentType?: IntentType
}

type IntentType =
  | "briefing_request"
  | "contextual_query"
  | "memory_query"
  | "navigation_request"
  | "clarification_response"
  | "general"
```

### ConversationContext

```typescript
interface ConversationContext {
  turns: TurnSummary[]            // 최대 10턴, FIFO 삭제
  activeTopics: string[]          // 최대 10개
  pendingClarification?: string   // clarify 후 대기 중인 질문
  threadUrl: string
}

interface TurnSummary {
  intent: {
    type: string
    summary: string               // transcript 대신 1줄 요약
  }
  action: string                  // "respond(suggest)", "search + focus + respond"
  result: string                  // "3-claim overview", "c45 context explained"
  timestamp: number
}
```

---

## 3.2 StateSnapshot 조립 규칙

FE가 Intent의 intentType에 따라 결정하는 포함 여부.

```
                     speech  selection  focus  viewport  semantics  sourceArticle  visibleComments  structure
briefing_request       ✓                                   ✓           ✓*             ✓              ✓
contextual_query       ✓                  ✓       ✓        ✓           ✓*             ✓              ✓
memory_query           ✓        ✓*       ✓*                ✓           ✓*             ✓              ✓
navigation_request     ✓                                   ✓           ✓*             ✓              ✓
clarification_resp     ✓                                   ✓           ✓*             ✓              ✓
general                ✓        ✓*       ✓*      ✓        ✓           ✓*             ✓              ✓

✓* = 있으면 포함, 없으면 null
threadDoc: evaluate에서는 항상 null
viewport: contextual_query와 general에서만 포함
sourceArticle: ContentGraph에 원문 노드가 있으면 포함 (모든 intentType 공통)
```

FE 조립 의사코드:

```typescript
function assembleSnapshot(intent: Intent): StateSnapshot {
  const base = {
    intent,
    page: { url: currentUrl(), title: currentTitle(), content: getPageContent() },
    sourceArticle: contentGraph.getSourceArticle(currentThreadId),  // null if not visited
    semantics: cachedSemantics,
    conversationContext: currentContext,
  }

  switch (intent.intentType) {
    case "contextual_query":
      return {
        ...base,
        viewport: await captureViewport(),
        user: { speech: intent.transcript, selection: getSelection(), focus: getFocusedComment() }
      }

    case "memory_query":
      return {
        ...base,
        viewport: null,
        user: { speech: intent.transcript, selection: getSelection(), focus: getFocusedComment() }
      }

    case "general":
      return {
        ...base,
        viewport: await captureViewport(),
        user: { speech: intent.transcript, selection: getSelection(), focus: getFocusedComment() }
      }

    case "briefing_request":
    case "navigation_request":
    case "clarification_response":
    default:
      return {
        ...base,
        viewport: null,
        user: { speech: intent.transcript, selection: null, focus: null }
      }
  }
}
```

---

## 3.3 ThreadSemantics

POST /api/analyze의 결과물. 스레드의 의미론적 분석.

```typescript
interface ThreadSemantics {
  topic: string
  claims: Claim[]
  keyComments: KeyComment[]
  generatedAt: number
}

interface Claim {
  id: string                      // "claim_1", "claim_2", ...
  statement: string
  stance: "for" | "against" | "neutral"
  evidence: string[]
  supportingComments: string[]    // commentId[]
  counters: string[]              // 반박하는 다른 claimId[]
}

interface KeyComment {
  commentId: string
  role: "defines_argument" | "provides_evidence" | "pivotal_rebuttal"
    | "introduces_topic" | "summarizes"
  claimId: string
}
```

## 3.4 ThreadDoc

HN DOM 파서가 추출하는 원본 댓글 구조.

```typescript
interface ThreadDoc {
  url: string
  title: string
  submitter: string
  score: number
  comments: Comment[]
}

interface Comment {
  id: string                      // "c1", "c2", ...
  author: string
  text: string                    // 댓글 전문
  depth: number                   // 들여쓰기 깊이 (0 = top-level)
  score: number | null
  parentId: string | null
  timestamp: number
}
```

---

# 4. Tool Definitions

Agent Brain의 System Prompt에 주입되는 도구 정의. 총 11개.

## 4.1 Projection Tools (7개)

FE에 SSE로 전달되어 브라우저에서 실행된다. Agent Brain은 의도를 선언하고 FE가 실현한다.

### respond

```yaml
name: respond
description: |
  사용자에게 음성으로 말한다.
  사용자는 이 응답을 자연스러운 음성으로 듣게 된다.

parameters:
  text:
    type: string
    required: true
    description: |
      사용자에게 전달할 내용.
      자연스러운 구어체 한국어로 작성한다.
      30초 이내로 읽을 수 있는 분량 (약 3-5문장).
      길면 여러 번의 respond로 나눈다.

  mode:
    type: enum ["answer", "clarify", "suggest"]
    required: true
    description: |
      answer: 정보를 전달하거나 질문에 답한다.
      clarify: 사용자의 의도가 불명확할 때 되묻는다.
               되묻기 전에 추측 가능한 선택지를 제시한다.
      suggest: 답변 끝에 다음 행동 선택지를 제안한다.
               텍스트 안에 선택지를 자연스럽게 포함한다.

when_to_use:
  - 사용자에게 분석 결과를 전달할 때 (answer)
  - 사용자의 의도가 불명확할 때 (clarify)
  - 검색 결과가 없거나, 다음 행동을 제안할 때 (suggest)
  - Internal Tool로 데이터를 충분히 모은 후에 사용한다
  - 한 턴에 여러 번 호출 가능 (먼저 핵심, 나중에 상세)

when_not_to_use:
  - 데이터가 더 필요한데 사용자에게 먼저 말하려 할 때
    → Internal Tool을 먼저 호출하라
  - 단, 확신이 있는 부분은 먼저 respond하고 추가 분석을 이어가도 좋다

fe_realization:
  answer → Gemini Live Function Result → 음성 출력
  clarify → 음성 출력 + ConversationContext에 pendingClarification 자동 기록
  suggest → 음성 출력 + 선택지 UI 칩 표시
```

### focus

```yaml
name: focus
description: |
  특정 댓글에 사용자의 주의를 집중시킨다.
  해당 댓글로 화면이 스크롤되고, 시각적으로 강조된다.

parameters:
  commentId:
    type: string
    required: true
    description: |
      대상 댓글의 ID.
      StateSnapshot의 page.visibleComments 또는
      semantics.keyComments에서 확인 가능한 ID.

  options:
    type: object
    required: false
    properties:
      label:
        type: string
        description: 댓글 옆에 표시될 설명 태그. 예: "핵심 근거", "반박", "출발점"
      style:
        type: enum ["primary", "secondary", "warning"]
        description: |
          primary: 주요 참조 대상 (파란색 계열)
          secondary: 보조 참조 (회색 계열)
          warning: 반박, 약점, 주의 (빨간색 계열)
      duration:
        type: number
        description: 초 단위. 해당 시간 후 자동 해제. 미지정 시 다음 focus까지 유지.
      scroll:
        type: boolean
        default: true
        description: false면 하이라이트만 하고 스크롤하지 않음.

when_to_use:
  - 사용자에게 특정 댓글을 참조시킬 때
  - respond로 설명하면서 동시에 해당 댓글을 보여줄 때
  - 하나의 댓글만 강조할 때 (여러 개면 focusMultiple)

when_not_to_use:
  - commentId를 모를 때 → search_thread로 먼저 찾아라
  - 여러 댓글을 동시에 보여주고 싶을 때 → focusMultiple

fe_realization:
  1. 이전 focus가 있고 다른 commentId → 이전 것을 secondary로 전환
  2. scroll: true → smooth scroll
  3. 하이라이트 CSS 주입
  4. label → 배지 DOM 삽입
  5. duration → 타이머 후 자동 해제
```

### focusMultiple

```yaml
name: focusMultiple
description: |
  여러 댓글을 동시에 강조하여 논쟁 구조를 시각화한다.
  각 댓글에 서로 다른 라벨과 스타일을 부여할 수 있다.
  대상이 아닌 댓글은 자동으로 시각적 비중이 낮아진다.

parameters:
  targets:
    type: array
    required: true
    items: { commentId: string, label?: string, style?: "primary" | "secondary" | "warning" }
    description: 2개 이상의 댓글을 지정한다.

  options:
    type: object
    required: false
    properties:
      scrollTo:
        type: string
        description: 어떤 commentId로 스크롤할지. 미지정 시 첫 번째 target.
      duration:
        type: number

when_to_use:
  - 논쟁 구조를 한눈에 보여줄 때 (주장 vs 반론 vs 절충)
  - 비교 분석 결과를 시각화할 때
  - 근거들의 관계를 동시에 표시할 때

when_not_to_use:
  - 단일 댓글만 참조할 때 → focus

fe_realization:
  1. 이전 모든 하이라이트 제거
  2. scrollTo 위치로 이동
  3. 각 target에 스타일별 하이라이트 + 라벨
  4. 비 대상 댓글 opacity 50% dimming
```

### navigate

```yaml
name: navigate
description: |
  다른 페이지로 이동한다. 기본적으로 새 탭에서 열린다.

parameters:
  target:
    type: string
    required: true
    description: URL 또는 "back" 또는 "forward"
  options:
    type: object
    properties:
      newTab:
        type: boolean
        default: true
      activate:
        type: boolean
        default: true
        description: false면 백그라운드 탭

when_to_use:
  - 사용자가 명시적으로 다른 페이지를 요청할 때
  - 과거 메모리에서 찾은 관련 스레드를 열어줄 때
  - 사용자가 "뒤로 가줘" 같은 네비게이션을 요청할 때

when_not_to_use:
  - 사용자가 요청하지 않았는데 자의적으로 페이지를 바꿀 때
  - 현재 페이지의 특정 댓글로 이동할 때 → focus
  - navigate 전에 반드시 respond로 어디로 가는지 알려줘라
```

### present

```yaml
name: present
description: |
  구조화된 정보를 시각적 패널로 표시한다.
  비교 분석, 과거 스레드 목록, 상세 요약 등에 사용한다.

parameters:
  content:
    type: object
    required: true
    properties:
      title: string
      items: array of { source: string, summary: string, url?: string, relevance?: string, timestamp?: string }

  options:
    type: object
    properties:
      position:
        type: enum ["sidebar", "overlay", "inline"]
        description: |
          sidebar: 측면 패널 (많은 정보)
          overlay: 페이지 위 떠다니는 패널 (간단한 정보)
          inline: 관련 댓글 근처 (컨텍스트 보존)
      persistent:
        type: boolean
        default: false

when_to_use:
  - 과거 스레드와의 비교 결과를 보여줄 때
  - respond로 전달하기엔 너무 구조적인 정보일 때
  - 여러 출처를 나란히 비교할 때

when_not_to_use:
  - 단순한 정보는 respond로 충분
  - 댓글 하나를 참조하는 것은 focus로 충분
```

### notify

```yaml
name: notify
description: |
  비침투적 상태 알림을 표시한다. 사용자의 활동을 방해하지 않는다.

parameters:
  message:
    type: string
    required: true
  level:
    type: enum ["status", "info", "success", "error"]
    required: true

when_to_use:
  - 처리 상태를 알릴 때 (status)
  - 보조 정보 — 지원 범위, 제한 사항 (info)
  - 작업 완료 (success)
  - 오류 발생 (error)

when_not_to_use:
  - 핵심 분석 결과는 respond로 전달하라
  - 사용자 질문에 대한 답을 notify로 하지 마라
```

### copy

```yaml
name: copy
description: |
  텍스트를 사용자의 클립보드에 복사한다.

parameters:
  text:
    type: string
    required: true
    description: 복사할 텍스트. Markdown 포맷 가능.

when_to_use:
  - 사용자가 명시적으로 "복사해줘", "메모로 남기고 싶어" 등을 요청할 때

when_not_to_use:
  - 사용자가 요청하지 않았는데 자의적으로 복사하지 마라
  - copy 전에 respond로 무엇을 복사하는지 알려줘라
```

---

## 4.2 Internal Tools (4개)

BE 내부에서 실행되어 결과가 Gemini에 반환된다. 사용자에게 직접 보이지 않는다.

### search_thread

```yaml
name: search_thread
description: |
  현재 스레드에서 관련 댓글이나 claim을 검색한다.
  sourceArticle이 제공된 경우, 원문의 주장과 매칭되는 댓글도
  검색 결과에 포함한다.
  결과는 사용자에게 직접 전달되지 않고, 판단에 사용된다.

parameters:
  query:
    type: string
    required: true
    description: 검색 키워드 또는 자연어 질의

returns:
  matches: array of { commentId, role, claimId, summary, parentChain }
  conclusion: string

when_to_use:
  - 사용자가 특정 댓글이나 주제를 언급했을 때
  - "이 댓글"의 논쟁 구조 내 위치가 필요할 때
  - user.focus나 visibleComments에서 대상을 식별했지만 상세 정보가 없을 때

when_not_to_use:
  - semantics의 claims와 keyComments에 이미 충분한 정보가 있을 때
  - 과거 스레드를 찾을 때 → search_memory

implementation:
  데이터 소스: StateSnapshot.semantics (인메모리) + Firestore threads/{threadId}/doc
  레이턴시: < 50ms (semantics만), < 300ms (ThreadDoc 조회 포함)
```

### search_memory

```yaml
name: search_memory
description: |
  사용자의 과거 읽기 이력에서 관련 스레드와 claim을 검색한다.

parameters:
  query:
    type: string
    required: true

returns:
  matches: array of { url, topic, readAt, relevantClaim }

when_to_use:
  - 사용자가 "전에 본 것 같다", "기억나?" 등을 말할 때
  - search_thread에서 매칭이 없었을 때, 과거로 확장

when_not_to_use:
  - 현재 스레드 내에서 검색할 때 → search_thread
  - 사용자가 메모리 언급을 하지 않았고, 현재 정보로 충분할 때

implementation:
  데이터 소스: Firestore users/{userId}/threadHistory
  검색: topic + claims[].statement 매칭, readAt 내림차순 가중치
  레이턴시: 100-300ms
```

### analyze_claims

```yaml
name: analyze_claims
description: |
  특정 claim을 심화 분석한다.
  각 근거의 강도, 반박 현황, 가장 약한/강한 근거를 판단한다.

parameters:
  claimIds:
    type: string[]
    required: true

returns:
  각 claim의 evidenceAnalysis: { evidence, strength, rebuttals, strongestRebuttal }

when_to_use:
  - 사용자가 근거의 강도, 약점, 비교를 물을 때
  - "가장 약한 근거", "가장 설득력 있는 주장" 같은 질문
  - semantics의 기본 정보로는 부족한 심화 질문

when_not_to_use:
  - 단순 브리핑이나 요약에서는 불필요
  - semantics에 이미 충분한 정보가 있을 때
  - 비용이 높은 도구이므로 꼭 필요할 때만

implementation:
  데이터 소스: Firestore threads/{threadId}/doc에서 관련 댓글 추출
  Gemini sub-call: gemini-2.5-flash, JSON only, max_tokens 500, temperature 0.1
  입력: 관련 댓글 최대 10개 × 500자 = ~5000자
  레이턴시: 1-3초
  fallback: sub-call 실패 시 rebuttal 수 카운팅 (규칙 기반)
```

### compare_claims

```yaml
name: compare_claims
description: |
  두 claim의 유사점, 차이점, 맥락 변화를 분석한다.

parameters:
  claimA: string (필수)
  claimB: string (필수)

returns:
  similarity, commonGround, differences, evolution

when_to_use:
  - search_memory에서 과거 claim을 찾았고 현재와의 비교가 필요할 때
  - 사용자가 두 주장의 차이를 물을 때

when_not_to_use:
  - 비교 대상이 하나뿐일 때
  - 비용이 높은 도구이므로 꼭 필요할 때만

implementation:
  Gemini sub-call: gemini-2.5-flash, JSON only, max_tokens 500, temperature 0.1
  레이턴시: 1-2초
  fallback: sub-call 실패 시 Gemini 메인 루프에 { error: "comparison failed" } 반환
```

---

# 5. System Prompt

매 /api/evaluate 요청마다 조립되는 Gemini 프롬프트 구조.

## 5.1 고정 부분

```
[1] Persona

"You are the brain of ThreadAtlas, a voice-based thinking partner
 that helps users navigate complex online discussions.
 You reason about thread structure, identify key arguments,
 and remember what the user has read before.
 You have access to Internal Tools (for data gathering) and
 Projection Tools (for communicating with the user)."


[2] Behavioral Rules

"Rules:
 - Respond in the same language as the user's speech.
   Korean question → Korean answer.
 - respond text must be speakable in under 30 seconds (3-5 sentences).
   Split longer explanations into multiple respond calls.
 - Use Internal Tools to gather data BEFORE using Projection Tools.
   Exception: if you are already confident about part of the answer,
   you may respond first and continue gathering data.
 - Always call respond BEFORE navigate (tell the user where you're going).
 - Always call respond BEFORE copy (tell the user what you're copying).
 - Distinguish between claims and evidence when explaining.
 - Express uncertainty with '~로 보입니다', '~일 수 있어요'.
 - When search results are empty, suggest alternatives with respond(mode: suggest).
 - Never call Internal Tools when semantics already contains sufficient information.
 - If sourceArticle is provided, cross-reference the article's arguments
   with the thread's claims. Connect what the author wrote with how
   commenters responded.
 - If sourceArticle is null, the user has not opened the original article.
   Infer from comments only. Never make definitive statements about the article.
   Use forms like '댓글들의 반응으로 봤을 때 ~에 관한 글 같아요'.
 - If the user asks a specific question about the article and sourceArticle is null,
   suggest: '원문을 열어보시면 더 정확한 분석을 해드릴 수 있어요'."


[3] Tool Definitions

  Projection Tools (7개) + Internal Tools (4개)
  각각의 name, description, parameters, when_to_use, when_not_to_use 포함.
  (Section 4에서 정의한 그대로)
```

## 5.2 동적 부분

매 요청마다 StateSnapshot에서 조립.

```
[4] Current State

  {
    intent: {
      type: "UserSpeech",
      transcript: "이 스레드 핵심이 뭐야?",
      intentType: "briefing_request"
    },
    page: {
      url: "...",
      title: "...",
      visibleComments: [ ... ]
    },
    user: {
      speech: "이 스레드 핵심이 뭐야?",
      selection: null,
      focus: null
    }
  }

  + viewport 이미지가 있으면 multimodal 입력으로 별도 전달.


[5] Source Article

  sourceArticle이 있을 때:
  {
    url: "https://techblog.com/world-models",
    title: "Why AI Agents Need World Models",
    text: "In this post, we argue that...(본문 최대 5000자)...",
    structure: { headings: [...], landmarks: [...] },
    readAt: 1709337000
  }

  sourceArticle이 null일 때:
  "Not available — user has not opened the original article."


[6] Thread Analysis

  {
    topic: "AI agents and world models",
    claims: [ claim_1, claim_2, claim_3 ],
    keyComments: [ c12, c45, c78 ]
  }

  500+ 댓글의 대형 스레드: keyComments 중심으로 압축.
  압축 기준: score 상위 + defines_argument/pivotal_rebuttal 우선.


[7] Conversation History

  {
    turns: [
      { intent: { summary: "briefing request" }, action: "respond(suggest)", result: "3-claim overview" },
      { intent: { summary: "c45 context query" }, action: "search + focus + respond", result: "c45 context explained" }
    ],
    activeTopics: ["AI agents", "world models"],
    pendingClarification: null
  }
```

## 5.3 조립 순서

```
systemInstruction =
  [1] Persona
  + "\n\n"
  + [2] Behavioral Rules
  + "\n\n## Current State\n" + JSON.stringify([4])
  + "\n\n## Source Article\n" + (sourceArticle ? JSON.stringify([5]) : "Not available — user has not opened the original article.")
  + "\n\n## Thread Analysis\n" + JSON.stringify([6])  // null이면 생략
  + "\n\n## Conversation History\n" + JSON.stringify([7])  // null이면 생략

tools = [3] Tool Definitions → Gemini functionDeclarations 형태로

contents = viewport가 있으면 [{ inlineData: { mimeType: "image/jpeg", data: base64 } }]
           없으면 []
```

---

# 6. Agentic Loop

## 6.1 제어 상수

```typescript
const MAX_LOOPS = 8             // 최대 Gemini 호출 횟수
const LOOP_TIMEOUT = 30_000     // 전체 evaluate 처리 최대 시간 (ms)
const TOOL_TIMEOUT = 10_000     // 개별 Internal Tool 실행 최대 시간 (ms)
```

## 6.2 루프 의사코드

```typescript
async function agenticLoop(
  systemPrompt: string,
  tools: FunctionDeclaration[],
  initialContents: Content[],
  sseWriter: SSEWriter
): Promise<{ conversationContext: ConversationContext; memoryDelta: MemoryDelta | null }> {

  const messages: Content[] = [...initialContents]
  let loopCount = 0
  const startTime = Date.now()
  const projections: Projection[] = []     // 이번 사이클에서 전송된 Projection 추적

  while (loopCount < MAX_LOOPS) {
    // 타임아웃 체크
    if (Date.now() - startTime > LOOP_TIMEOUT) {
      sseWriter.write({
        event: "projection",
        data: {
          type: "respond",
          payload: {
            text: "시간이 좀 걸리고 있어요. 질문을 좀 더 좁혀주시겠어요?",
            mode: "clarify"
          }
        }
      })
      break
    }

    // Gemini 호출 (streaming)
    const stream = await gemini.generateContentStream({
      systemInstruction: systemPrompt,
      contents: messages,
      tools,
      toolConfig: { functionCallingConfig: { mode: "AUTO" } }
    })

    let hasToolCall = false

    for await (const chunk of stream) {
      if (chunk.functionCalls && chunk.functionCalls.length > 0) {
        for (const toolCall of chunk.functionCalls) {

          if (isInternalTool(toolCall.name)) {
            // Internal Tool: 즉시 실행 → 결과를 messages에 추가
            hasToolCall = true
            try {
              const result = await withTimeout(
                executeInternalTool(toolCall.name, toolCall.args),
                TOOL_TIMEOUT
              )
              messages.push(functionResponse(toolCall.name, result))
            } catch (error) {
              messages.push(functionResponse(toolCall.name, { error: error.message }))
            }

          } else if (isProjectionTool(toolCall.name)) {
            // Projection Tool: SSE로 FE에 즉시 전송
            const projection = { type: toolCall.name, payload: toolCall.args }
            sseWriter.write({ event: "projection", data: projection })
            projections.push(projection)
            // Projection은 루프를 멈추지 않음
            messages.push(functionResponse(toolCall.name, { delivered: true }))
          }
        }

        if (hasToolCall) {
          break  // inner loop → Gemini 재호출
        }

      } else if (chunk.candidates?.[0]?.finishReason === "STOP") {
        // Gemini가 stop → 루프 종료
        const memoryDelta = extractMemoryDelta(projections, messages)
        return { conversationContext: buildContext(messages, projections), memoryDelta }
      }
    }

    loopCount++
    hasToolCall = false
  }

  // MAX_LOOPS 초과
  const memoryDelta = extractMemoryDelta(projections, messages)
  return { conversationContext: buildContext(messages, projections), memoryDelta }
}
```

## 6.3 Internal Tool 실행

```typescript
async function executeInternalTool(name: string, args: any): Promise<any> {
  switch (name) {
    case "search_thread":
      return await searchThread(args.query, currentSemantics, currentThreadId)

    case "search_memory":
      return await searchMemory(args.query, userId)

    case "analyze_claims":
      return await analyzeClaims(args.claimIds, currentThreadId)

    case "compare_claims":
      return await compareClaims(args.claimA, args.claimB)

    default:
      return { error: `Unknown tool: ${name}` }
  }
}
```

## 6.4 Projection 분류

```typescript
const INTERNAL_TOOLS = new Set(["search_thread", "search_memory", "analyze_claims", "compare_claims"])
const PROJECTION_TOOLS = new Set(["respond", "focus", "focusMultiple", "navigate", "present", "notify", "copy"])

function isInternalTool(name: string): boolean { return INTERNAL_TOOLS.has(name) }
function isProjectionTool(name: string): boolean { return PROJECTION_TOOLS.has(name) }
```

## 6.5 Parallel Tool Calling

MVP에서는 **순차 실행**. Gemini가 한 응답에서 여러 tool_call을 동시에 발생시켜도 하나씩 처리한다.

```
이유:
  - 병렬 실행의 에러 핸들링 복잡
  - search_thread < 50ms, search_memory < 300ms → 순차로도 충분
  - 가장 무거운 analyze_claims/compare_claims는 보통 단독 호출

프로덕션 마이그레이션:
  Internal Tool들을 Promise.all로 병렬 실행
  에러 시 개별 fallback
```

---

# 7. Gemini Live Configuration

## 7.1 FE에서의 연결

```typescript
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
```

## 7.2 Audio 설정

```
Input:  16kHz PCM mono (MediaStream → AudioWorklet)
Output: 24kHz PCM mono (Gemini Live Native Audio)
Barge-in: Native 지원 (Gemini Live가 자동 감지)
```

## 7.3 Token 갱신

```
TTL: 10분
선제 갱신: 만료 2분 전
재시도: 3회 (1초 간격)
실패 시: Phase → error → notify("세션이 만료됐어요. 다시 시작해주세요.", "error")
갱신 중 대화: 대화 완료 후 갱신. 대화 중이면 큐잉.
```

---

# 8. Firestore Schema

## 8.1 컬렉션 구조

```
firestore/
├── users/{userId}/
│   ├── profile
│   │   { displayName, createdAt, settings }
│   │
│   ├── interestProfile
│   │   { topics: { "AI agent": 12, ... }, updatedAt }
│   │
│   └── threadHistory/{threadId}
│         {
│           url: string
│           title: string
│           topic: string
│           claims: Claim[]
│           readAt: Timestamp
│           lastAccessedAt: Timestamp
│           highlights: string[]
│           turnCount: number
│         }
│
└── threads/{threadId}/
    ├── semantics
    │   { ThreadSemantics 전체 }
    │
    ├── doc
    │   { ThreadDoc 전체 }
    │
    └── meta
        {
          articleUrl: string | null,    // HN DOM에서 추출한 원문 URL
          platform: "hn"               // MVP: HN만
        }
```

## 8.2 threadId 생성

```typescript
import { createHash } from "crypto"

function threadId(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16)
}

// "https://news.ycombinator.com/item?id=39900001" → "a3f8c2e1b7d04f69"
```

## 8.3 크기 제한

```
ThreadDoc: 180개 댓글 × 500자 = ~90KB (Firestore 1MB 제한 내)
500+ 댓글: top-level + score 상위 200개만 저장
ThreadSemantics: 일반적으로 < 10KB
threadHistory 엔트리: 사용자당 최대 관리 필요 없음 (MVP 12일간)
```

## 8.4 인덱스

```
users/{userId}/threadHistory → readAt DESC (최근 순 조회)
threads/{threadId}           → threadId 자체가 키 (단일 조회)
```

## 8.5 MVP 단순화

```
TTL: 설정 안 함 (12일간 데이터 적음)
userId: 하드코딩 ("user_sungwoo")
보안 규칙: 개방 (rules: allow read, write: if true)
```

---

# 9. Memory System

## 9.1 memoryDelta 생성

타이밍: 에이전틱 루프 종료 직후, done 이벤트 전송 전.
방식: 규칙 기반 추출 (LLM 호출 없음).

```typescript
function extractMemoryDelta(
  projections: Projection[],
  messages: Content[]
): MemoryDelta | null {
  const topicDeltas: Record<string, number> = {}
  const highlights: string[] = []

  // 1. 참조된 claim의 topic 키워드 추출
  for (const msg of messages) {
    if (msg.role === "function" && msg.parts) {
      const result = JSON.parse(msg.parts[0].text)
      if (result.claimId) {
        const keywords = extractKeywords(result.claim || result.statement)
        for (const kw of keywords) {
          topicDeltas[kw] = (topicDeltas[kw] || 0) + 1
        }
      }
    }
  }

  // 2. user.selection 텍스트를 highlights에 추가
  if (stateSnapshot.user.selection?.text) {
    highlights.push(stateSnapshot.user.selection.text)
  }

  // 3. focus/focusMultiple에서 참조된 댓글의 textPreview
  for (const proj of projections) {
    if (proj.type === "focus" || proj.type === "focusMultiple") {
      // 댓글 텍스트는 이미 Internal Tool 결과에 포함되어 있음
      // 필요시 추가
    }
  }

  if (Object.keys(topicDeltas).length === 0 && highlights.length === 0) {
    return null
  }

  return {
    interestProfile: { topicDeltas },
    threadHistory: {
      highlights,
      turnCountDelta: 1
    }
  }
}
```

## 9.2 memoryDelta 저장

```typescript
async function saveMemoryDelta(userId: string, threadId: string, delta: MemoryDelta): Promise<void> {
  // Fire and forget — 실패해도 사용자 응답에 영향 없음
  try {
    // interestProfile 업데이트
    if (delta.interestProfile?.topicDeltas) {
      const ref = db.doc(`users/${userId}/interestProfile`)
      for (const [topic, count] of Object.entries(delta.interestProfile.topicDeltas)) {
        await ref.update({ [`topics.${topic}`]: FieldValue.increment(count) })
      }
    }

    // threadHistory 업데이트
    const histRef = db.doc(`users/${userId}/threadHistory/${threadId}`)
    const updates: any = {
      lastAccessedAt: FieldValue.serverTimestamp(),
      turnCount: FieldValue.increment(delta.threadHistory?.turnCountDelta || 1)
    }
    if (delta.threadHistory?.highlights?.length) {
      updates.highlights = FieldValue.arrayUnion(...delta.threadHistory.highlights)
    }
    await histRef.update(updates)
  } catch (error) {
    console.error("memoryDelta save failed:", error)
    // 무시 — 다음 요청에서 재시도하지 않음
  }
}
```

---

# 10. Error Handling

## 10.1 에러 분류와 처리

### A. Gemini API 응답 실패

```
발생 시점: 에이전틱 루프의 generateContentStream 호출
원인: rate limit, 500, 모델 과부하

처리:
  BE → SSE: event: error { code: "GEMINI_FAILED", message: "..." }
  FE: 로컬에서 음성 안내 생성
    → respond("죄송해요, 분석 중 문제가 생겼어요. 다시 질문해주세요.", "answer")
  재시도: 안 함
```

### B. SSE 연결 끊김

```
발생 시점: FE의 fetch ReadableStream 또는 EventSource 에러
원인: 네트워크 불안정, Cloud Run 인스턴스 재시작

처리:
  FE: 이미 실행된 Projection은 유효 (되돌리지 않음)
  FE: notify("연결이 끊겼어요. 다시 질문해주세요.", "error")
  재시도: 안 함 (새 질문 = 새 SSE)
```

### C. Ephemeral Token 만료

```
처리: Section 7.3 참조
```

### D. Internal Tool 실행 실패

```
발생 시점: search_memory Firestore timeout, analyze_claims sub-call 실패

처리:
  BE: try-catch → Gemini에 { error: "..." } 반환
  Gemini: 에러를 인식하고 자율적으로 대안 선택
    예: search_memory 실패 → respond("과거 기록 검색에 문제가 있어요. 현재 스레드에서 답변드릴게요.")

analyze_claims fallback:
  sub-call 실패 → rebuttal 수만 카운팅 (규칙 기반)

compare_claims fallback:
  sub-call 실패 → { error: "comparison failed" } → Gemini가 직접 비교 시도
```

### E. MAX_LOOPS / LOOP_TIMEOUT 도달

```
처리:
  BE: 안전 응답 SSE 전송
  → respond("시간이 좀 걸리고 있어요. 질문을 좀 더 좁혀주시겠어요?", "clarify")
  → done 이벤트
```

---

# 11. Focus Lifecycle

FE가 관리하는 focus/focusMultiple 하이라이트 상태 전환 규칙.

## 11.1 연속 focus

```
focus(c45, primary) → focus(c89, warning)
  결과: c45 → secondary로 전환, c89 → warning으로 활성화

focus(c45, primary) → focus(c45, warning)
  결과: c45의 options만 업데이트 (primary → warning)

focus(c45, primary, duration: 5) → [3초 후] focus(c89, primary)
  결과: c45의 duration 타이머 취소, secondary로 전환, c89 활성화
```

## 11.2 focusMultiple 전환

```
focus(c45, primary) → focusMultiple([c12, c45, c78])
  결과: 이전 focus 전체 제거, focusMultiple로 완전 교체

focusMultiple([c12, c45]) → focus(c89, primary)
  결과: focusMultiple 전체 제거, c89만 활성화

focusMultiple([c12, c45]) → focusMultiple([c23, c78])
  결과: 이전 것 전체 제거, 새 것으로 교체
```

## 11.3 사이클 간

```
새 POST /api/evaluate 시작:
  이전 하이라이트 유지 (자동 정리 안 함)
  새 사이클에서 Agent Brain이 새 focus를 보내면 위 규칙에 따라 전환
  새 사이클에서 focus를 안 보내면 이전 것 유지
```

---

# 12. Barge-in Protocol

## 12.1 FE 처리 순서

```
1. Gemini Live: Barge-in 감지 → 현재 음성 출력 중단
2. Gemini Live: processUserIntent FC 발생
3. FE: AbortController.abort() → 진행 중인 SSE 연결 종료
4. FE: Projection 큐 비우기 (미실행 Projection 폐기)
5. FE: ConversationContext 업데이트
   → 마지막 턴의 action에 "(interrupted)" 추가
   → result에 "어디까지 전달됨" 기록
6. 새 Intent → 새 StateSnapshot 조립 → 새 POST /api/evaluate
```

## 12.2 ConversationContext 기록

```typescript
// 중단된 턴의 기록 예시
{
  intent: { type: "UserSpeech", summary: "full claim structure request" },
  action: "respond (interrupted)",
  result: "claim_1 partial explanation delivered, claim_2 and claim_3 not delivered",
  timestamp: 1709337650
}
```

## 12.3 BE 인식

Agent Brain은 ConversationContext의 마지막 턴에 "(interrupted)"가 포함되어 있으면 이전 응답이 중단되었음을 인식하고, 중단된 지점부터 이어가거나 사용자의 새 요청에 맞춰 방향을 전환한다.

---

# 13. Security (MVP)

```
인증: 없음
userId: 하드코딩 ("user_sungwoo")
Cloud Run: --allow-unauthenticated
Firestore Rules: allow read, write: if true
Ephemeral Token constraints: 미사용

프로덕션 마이그레이션:
  Firebase Auth → ID Token
  Cloud Run → IAM 인증
  Firestore → userId 기반 보안 규칙
  Ephemeral Token → server-side constraints로 System Instruction 잠금
```

---

# 14. Infrastructure

## 14.1 Cloud Run

```yaml
service: threadatlas-api
region: asia-northeast3        # Seoul
cpu: 1
memory: 512Mi
min-instances: 1               # cold start 방지 (~$10-15/12일)
max-instances: 3
timeout: 60s                   # SSE 스트리밍 고려
concurrency: 10
```

## 14.2 Dockerfile

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY apps/api/package.json .
COPY packages/shared/ ../packages/shared/
RUN npm install
COPY apps/api/ .
RUN npm run build
EXPOSE 8080
CMD ["node", "dist/index.js"]
```

## 14.3 환경 변수

```
GEMINI_API_KEY=...
GOOGLE_CLOUD_PROJECT=threadatlas
FIRESTORE_DATABASE=(default)
PORT=8080
NODE_ENV=production
```

---

# 15. Cost Estimation (12일 해커톤)

| 항목 | 비용 |
|------|------|
| Gemini API — /api/analyze (무료 티어) | $0 |
| Gemini API — /api/evaluate 루프 (무료 티어) | $0 |
| Gemini API — sub-call (analyze/compare, 무료 티어) | $0 |
| Gemini Live API — 데모/테스트 | < $5 |
| Cloud Run (min_instances=1, 12일) | < $15 |
| Firestore (read/write) | < $1 |
| **Total** | **< $25** |