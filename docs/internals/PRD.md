# PRD — ThreadAtlas

**Voice-Driven Thread Cognition Agent**

Version: 1.1
Owner: 정성우
Target Hackathon: Gemini Live Agent Challenge (Deadline: Mar 16, 2026)
Category: Live Agents 🗣️
Companion: Agent Brain Spec v1.1, Semantic Relay Spec v1.0, Scenario Playbook v3.0

---

# 1. Problem

## 1.1 Cognitive Overload

기술 커뮤니티(Hacker News, Reddit, LessWrong 등)의 스레드는 높은 정보 밀도를 가지고 있다.

- 수십~수백 개의 댓글과 중첩된 스레드 구조
- 여러 논점이 동시에 진행됨
- 핵심 논점, 실질적 근거, 논쟁의 전환점을 파악하기 어려움

## 1.2 Passive Reading

현재 사용자의 스레드 소비 방식은 수동적이다.

- 위에서 아래로 스크롤하며 순차적으로 읽음
- 읽는 도중 맥락을 잃으면 되돌아가서 다시 읽음
- 특정 댓글의 논쟁 구조 내 위치를 직관적으로 파악할 수 없음
- 과거에 읽었던 유사한 논점이나 근거를 기억하기 어려움

**사용자에게 필요한 것은 자동 요약이 아니라, 함께 읽으며 구조를 짚어주고 과거의 맥락을 기억하는 사고 파트너다.**

---

# 2. Vision

ThreadAtlas는 커뮤니티 스레드를 함께 읽는 **음성 기반 실시간 사고 파트너**다.

사용자가 스레드를 탐색하는 동안:

- **음성으로 질문**하면 스레드 구조를 분석하여 **음성으로 답한다**
- 현재 화면의 **스크린샷을 인식**하여 맥락을 파악한다
- 사용자의 중단(interruption)에 자연스럽게 대응한다
- 사용자의 **관심사와 과거 읽기 이력을 기억**하여 맥락화된 분석을 제공한다
- 매 순간 상태를 판단하여 **자율적으로 행동을 선택**한다

핵심 철학:

> 우리는 사용자의 브라우징을 자동화하지 않는다.
> 우리는 사용자의 **사고 구조를 실시간으로 안정화**한다.
> 에이전트는 사용자와 **같은 세계를 본다.**
> 사용자가 열지 않은 페이지는 모르고, 모르는 것은 모른다고 말한다.

---

# 3. Hackathon Alignment

## 3.1 Category: Live Agents 🗣️

| 요구사항 | ThreadAtlas 구현 |
|---------|-----------------|
| Real-time interaction (Audio/Vision) | 음성 대화 + 스크린샷 기반 Vision |
| Natural conversation | 스레드 탐색 중 자유로운 음성 질의 |
| Interruption handling | Gemini Live API 네이티브 Barge-in |
| Gemini Live API or ADK | Gemini Live API (Ephemeral Token, 클라이언트 직접 연결) |
| Google Cloud hosted | Cloud Run + Firestore |

## 3.2 Judging Criteria Mapping

| 심사 기준 (비중) | 전략 |
|----------------|------|
| Innovation & Multimodal UX (40%) | "text box" 패러다임 탈피. 음성으로 묻고, DOM 센서로 컨텍스트를 읽고, 음성+하이라이트로 답하는 루프. ContentGraph DAG로 원문↔토론 관계 추적. DOM 스냅샷 원칙: 사용자와 같은 세계를 보는 투명한 에이전트 |
| Technical Implementation (30%) | Semantic Relay + Agent Brain 분리. Gemini Live를 센서/프로젝션으로 추상화. BE 에이전틱 루프 + SSE 스트리밍. 동적 Content Script inject. Monorepo 공유 타입 시스템 |
| Demo & Presentation (30%) | 실제 HN 스레드에서 에이전트가 자율적으로 도구를 선택하며 음성 대화하는 4분 데모 |

---

# 4. Target Users

- Hacker News / LessWrong / Reddit을 자주 읽는 개발자
- 기술 리서처, AI 커뮤니티 참여자
- 영어 스레드를 읽으며 빠르게 논점을 파악하고 싶은 사용자

---

# 5. Core Features (MVP)

## 5.1 Voice Thread Briefing

사용자가 HN 스레드를 열고 "이 스레드 요약해줘"라고 말하면, 에이전트가 핵심 논점을 음성으로 브리핑한다.

```
Input: 음성 명령 + ThreadDoc + ThreadSemantics
Output (음성):
  "이 스레드는 AI agent와 tool-based system의 비교에 대한 토론이에요.
   크게 두 가지 입장이 있는데요 —
   첫 번째는 agent가 world model을 필요로 한다는 주장이고,
   두 번째는 tool 기반 시스템이 더 잘 확장된다는 주장이에요.
   더 자세히 들어볼까요?"
```

## 5.2 Contextual Comment Analysis

사용자가 특정 댓글 근처에서 "이 댓글은 어떤 맥락이야?"라고 물으면, 에이전트가 스크린샷을 인식하여 해당 댓글의 논쟁 구조 내 위치를 설명한다.

```
Input: 음성 질문 + 뷰포트 스크린샷 + ThreadSemantics
Output (음성 + 하이라이트):
  "지금 보고 계신 댓글은 user_x가 쓴 건데요,
   'tool 기반 시스템의 확장성' 주장에 대한 반박이에요."
  [해당 댓글 하이라이트]
```

## 5.3 Argument Navigation

사용자가 "가장 중요한 반론은 뭐야?"라고 물으면, 에이전트가 근거를 수집하고, 핵심 반론을 설명하며 해당 댓글을 하이라이트한다.

```
Input: 음성 질문 + ThreadSemantics
Agent Brain 내부: gatherEvidence → 근거 추출 → 판단
Output (음성 + 하이라이트):
  "가장 주목할 만한 반론은 comment #47인데요..."
  [해당 댓글 하이라이트 + 스크롤]
```

## 5.4 Source Article Cross-Reference

에이전트는 사용자가 브라우저에서 원문 아티클을 열어본 경우, 원문과 댓글을 크로스 참조하여 분석한다.

```
사용자가 원문 탭을 열어본 경우:
  Input: 음성 질문 + sourceArticle + ThreadSemantics
  Output (음성):
    "이 글에서 주장하는 world model의 정의와
     댓글 c12에서 사용하는 정의가 미묘하게 달라요.
     원문은 environment state representation을 말하는데,
     c12는 cognitive science의 internal model을 말하고 있어요."

사용자가 원문을 열지 않은 경우:
  Output (음성):
    "아직 원문을 읽어보지 않아서 정확한 내용은 모르지만,
     댓글들의 반응으로 봤을 때 AI agent의 world model
     필요성에 대한 아티클 같아요.
     원문을 열어보시면 더 정확한 분석을 해드릴 수 있어요."
```

원문은 서버에서 가져오지 않는다. 사용자가 HN에서 원문 링크를 클릭하여 브라우저에서 열었을 때만, Content Script가 해당 탭의 DOM에서 텍스트를 추출한다. **DOM 스냅샷 원칙: 에이전트가 사용자 모르게 데이터를 가져오지 않는다.**

## 5.5 Memory-Aware Analysis

에이전트는 사용자의 과거 읽기 이력과 관심사를 기억하여 맥락화된 분석을 제공한다.

**Passive Memory (자동 축적):**
- 읽은 스레드의 ThreadSemantics가 자동으로 저장됨
- 반복적으로 읽는 토픽 패턴이 InterestProfile로 축적됨

**Active Memory (에이전트 자율 판단):**
- Agent Brain이 현재 논점과 과거 메모리의 관련성을 자율적으로 판단
- 텍스트 선택 + "이거 전에 본 거 아니야?" → 명시적 회상 트리거

```
Agent Brain 내부: search_memory → 매칭 → 비교 분석
Output (음성 + 페이지 이동 or 사이드바):
  "얼마 전에 레딧 r/MachineLearning에서 비슷한 논점이 있었어요.
   거기서는 LLM의 근본적 한계를 reasoning capacity 관점에서 논의했는데,
   지금 선택하신 부분과 거의 같은 주장이에요."
  [해당 페이지로 이동 or 사이드바에 요약 표시]
```

---

# 6. Out of Scope (MVP)

- Argument Map 시각화 (사이드패널 UI)
- Multi-platform 지원 (Reddit, LessWrong 등) — ContentGraph DAG 구조로 확장 준비됨
- 자동 댓글 작성 / 브라우징 자동화
- 벡터 검색 기반 시맨틱 유사도 매칭 (MVP에서는 키워드/토픽 기반 매칭)
- 서버사이드 원문 fetch (원문은 브라우저 탭에서만 읽음)
- HN 외 사이트의 Content Script inject (HN 컨텍스트의 원문 탭만 동적 inject)

---

# 7. Semantic Model

## 7.1 ThreadDoc (DOM 추출 결과)

```typescript
interface ThreadDoc {
  url: string
  title: string
  submitter: string
  score: number
  comments: Comment[]
}

interface Comment {
  id: string                  // HN 네이티브 ID 그대로 (예: "39900123")
  author: string
  text: string
  depth: number
  score: number | null        // 개별 댓글 점수는 본인 것만 보임
  parentId: string | null
  timestamp: number
}
```

## 7.2 ThreadSemantics (LLM 추론 결과)

```typescript
interface ThreadSemantics {
  topic: string
  claims: Claim[]
  keyComments: KeyComment[]
  generatedAt: number
}

interface Claim {
  id: string                       // "claim_1", "claim_2", ...
  statement: string
  stance: "for" | "against" | "neutral"
  supportingCommentIds: string[]   // HN 네이티브 ID
  evidence: string[]
  counters: string[]               // 반박하는 claim ids
}

interface KeyComment {
  commentId: string                // HN 네이티브 ID
  role: "defines_argument" | "provides_evidence" | "pivotal_rebuttal"
  summary: string
  claimId: string
}
```

## 7.3 ArticleContext (원문, 사용자가 열어본 경우만)

```typescript
interface ArticleContext {
  url: string
  title: string
  text: string                     // 본문 텍스트 (최대 5000자)
  structure: PageStructure
  readAt: number                   // 사용자가 원문 탭을 방문한 시점
}
```

## 7.4 ContentGraph (DAG)

Side Panel이 인메모리로 관리하는 콘텐츠 그래프. 사용자가 브라우저에서 열어본 페이지들의 관계를 추적한다.

```typescript
interface ContentGraph {
  nodes: Map<string, ContentNode>
  edges: ContentEdge[]
}

interface ContentNode {
  id: string                       // URL 해시 앞 16자
  url: string
  title: string
  type: "article" | "thread"
  snapshot: {
    text: string
    structure: PageStructure
    extractedAt: number
  } | null                         // 사용자가 방문하지 않았으면 null
}

interface ContentEdge {
  from: string                     // Node ID
  to: string                      // Node ID
  relation: "triggers"            // MVP: 원문 → 스레드
}
```

프로덕션 확장: Node 타입에 paper, reddit_thread, lesswrong_thread 추가. Edge relation에 references, discusses_same_topic 추가.

## 7.5 Memory Model

```typescript
interface ThreadHistory {
  url: string
  title: string
  topic: string
  claims: Claim[]
  readAt: number
  lastAccessedAt: number
  highlights: string[]
  turnCount: number
}

interface InterestProfile {
  topics: Record<string, number>
  updatedAt: number
}
```

---

# 8. Architecture

## 8.1 핵심 원칙

**FE는 Semantic Relay다.** 브라우저의 물리적 능력(센서로 읽고, 프로젝션으로 쓰기)을 BE에 노출한다. 판단하지 않는다.

**BE는 Agent Brain이다.** 현재 상태 스냅샷을 받아, Gemini로 판단하고, 실행할 Projection 시퀀스를 결정한다.

**Gemini Live는 센서이자 프로젝션이다.** 사용자 음성을 텍스트로 변환하는 센서이자, Agent Brain의 응답을 자연스러운 음성으로 변환하는 프로젝션이다. Gemini Live는 두뇌가 아니다.

**DOM 스냅샷 원칙.** 에이전트는 사용자와 같은 세계를 본다. 사용자가 브라우저에서 열어본 페이지의 DOM만 안다. 사용자가 열지 않은 원문은 모른다. "More"를 클릭하지 않은 댓글은 존재하지 않는다. 지식의 경계가 투명하다.

**Side Panel이 세션 주인이다.** Gemini Live 연결, SSE 연결, ConversationContext, ContentGraph — 세션의 모든 상태를 Side Panel이 보유한다. 탭이 전환되어도 Side Panel은 유지되므로 세션이 끊기지 않는다.

**Intent가 모든 것을 트리거한다.** 사용자 발화가 Intent를 발생시키고, Intent가 센서 수집을 트리거하고, 수집된 StateSnapshot이 BE로 전달되어 판단을 트리거한다. Intent 없이는 아무 일도 일어나지 않는다.

**상태는 유지되지 않고 매번 계산된다.** BE는 stateless다. 매 요청마다 StateSnapshot + ConversationContext로부터 현재 상태를 재구성하고 판단한다. Manifesto의 Snapshot 철학과 동일하다.

## 8.2 System Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│              Browser Extension — Semantic Relay (Manifest V3)         │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                        Side Panel (세션 주인)                    │ │
│  │                                                                 │ │
│  │   Gemini Live WebSocket ←→ 마이크/스피커                         │ │
│  │     processUserIntent FC → Intent 생성                          │ │
│  │                                                                 │ │
│  │   StateSnapshot 조립:                                           │ │
│  │     Content Script 센서 + Service Worker viewport               │ │
│  │     + ContentGraph sourceArticle + cachedSemantics              │ │
│  │                                                                 │ │
│  │   SSE 수신 → Projection 라우팅:                                  │ │
│  │     respond → Gemini Live (음성)                                │ │
│  │     focus/focusMultiple → Content Script (DOM)                   │ │
│  │     present/notify → Side Panel 내부 렌더링                      │ │
│  │     navigate → Service Worker (새 탭)                            │ │
│  │     copy → clipboard API                                        │ │
│  │                                                                 │ │
│  │   ContentGraph (DAG) 관리                                       │ │
│  │   ConversationContext 보유                                      │ │
│  │   Phase FSM 관리                                                │ │
│  └────────┬──────────────────────────────────┬─────────────────────┘ │
│           │                                  │                       │
│  ┌────────┴──────────┐           ┌───────────┴───────────┐          │
│  │   Service Worker  │           │    Content Scripts     │          │
│  │                   │           │                        │          │
│  │ captureVisibleTab │           │ content-hn.js (정적)   │          │
│  │ tabs.onActivated  │           │   HN DOM 파서          │          │
│  │ tabs.onUpdated    │           │   원문 URL 추출         │          │
│  │  → 동적 inject    │           │   센서 수집             │          │
│  │ token 요청        │           │   Projection 실행       │          │
│  │ 메시지 라우팅      │           │                        │          │
│  │                   │           │ content-article.js     │          │
│  │ knownArticleUrls  │           │   (동적, 원문 탭에만)   │          │
│  │  관리             │           │   텍스트/구조 추출       │          │
│  └───────────────────┘           └────────────────────────┘          │
│                                                                      │
│  Gemini Live API Session                                             │
│    Model: gemini-2.5-flash-native-audio-preview-12-2025              │
│    Audio: Input 16kHz PCM mono / Output 24kHz PCM mono               │
│    Ephemeral Token, Direct WebSocket, Native Barge-in                 │
└──────────────────────────┬───────────────────────────────────────────┘
                           │
                           │  POST /api/evaluate (SSE Stream)
                           │  { stateSnapshot, conversationContext }
                           │
                           │  ← event: projection { type, payload }
                           │  ← event: done { conversationContext, memoryDelta }
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│                   Google Cloud (Agent Brain)                          │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                    Cloud Run                                    │  │
│  │                                                                │  │
│  │  POST /api/evaluate (SSE Stream)                               │  │
│  │  ┌──────────────────────────────────────────────────────────┐  │  │
│  │  │         Gemini 2.5 Flash (tool_use mode)                  │  │  │
│  │  │                                                          │  │  │
│  │  │  Input: StateSnapshot (sourceArticle 포함)                │  │  │
│  │  │         + ConversationContext                             │  │  │
│  │  │                                                          │  │  │
│  │  │  Internal Tools (BE가 즉시 실행):                          │  │  │
│  │  │    search_thread(query)    → ThreadDoc/Semantics 검색     │  │  │
│  │  │    search_memory(query)    → Firestore 메모리 검색        │  │  │
│  │  │    analyze_claims(ids)     → Claim 심화 분석              │  │  │
│  │  │    compare_claims(a, b)    → Claim 비교 분석              │  │  │
│  │  │                                                          │  │  │
│  │  │  Projection Tools (FE 전달용, SSE로 즉시 스트리밍):        │  │  │
│  │  │    respond(text, mode)     → 음성 응답/제안/되묻기        │  │  │
│  │  │    focus(commentId)        → 댓글 하이라이트 + 스크롤     │  │  │
│  │  │    focusMultiple(targets)  → 복수 댓글 하이라이트          │  │  │
│  │  │    navigate(url)           → 페이지 이동                  │  │  │
│  │  │    present(content)        → 사이드바/오버레이 표시        │  │  │
│  │  │    notify(message)         → 알림 표시                    │  │  │
│  │  │    copy(text)              → 클립보드 복사                 │  │  │
│  │  └──────────────────────────────────────────────────────────┘  │  │
│  │                                                                │  │
│  │  POST /api/token — Ephemeral Token 발급                        │  │
│  │  POST /api/analyze — ThreadDoc → ThreadSemantics 생성          │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                      Firestore                                  │  │
│  │                                                                │  │
│  │  threads/{threadId}/                                           │  │
│  │    ├── semantics   { ThreadSemantics }                         │  │
│  │    ├── doc         { ThreadDoc }                               │  │
│  │    └── meta        { articleUrl, platform }                    │  │
│  │                                                                │  │
│  │  users/{userId}/                                               │  │
│  │    ├── profile          { displayName, settings }              │  │
│  │    ├── interestProfile  { topics, updatedAt }                  │  │
│  │    └── threadHistory/{threadId}                                │  │
│  │          { url, title, topic, claims, readAt, highlights }     │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

## 8.3 Content Script 전략

```
정적 inject: content-hn.js
  manifest의 content_scripts에 선언
  matches: ["*://news.ycombinator.com/*"]
  역할: HN DOM 파서, 원문 URL 추출, 센서 수집, Projection 실행

동적 inject: content-article.js
  Service Worker가 chrome.scripting.executeScript로 주입
  조건: HN에서 추출한 원문 URL의 탭이 열렸을 때만
  역할: 원문 텍스트 + 구조 추출 → Side Panel에 전달

inject 안 함:
  HN과 무관한 모든 페이지 (네이버, 유튜브, 구글 등)
```

## 8.4 Intent System

모든 인지 사이클의 기원은 사용자 발화다. Intent 없이는 아무 일도 일어나지 않는다.

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

**UserSpeech:** 가장 빈번한 Intent. Gemini Live 세션에서 사용자 발화가 끝나면 processUserIntent Function Call이 발생하고, 이것이 Intent로 변환된다. intentType은 Gemini Live가 분류한다.

**UserSelection / PageNavigation:** MVP에서는 UserSpeech만 evaluate를 트리거한다. selection과 focus는 Intent가 아니라 센서 데이터로 StateSnapshot에 포함된다.

## 8.5 Sensors & Projections

### Sensors (FE → BE 방향, 상태 읽기)

모든 센서는 **조립 시점 스냅샷**이다. 실시간 추적하지 않는다. 사용자가 말하는 순간의 세계를 찍는다.

| Sensor | 역할 | 구현 | 실행 주체 |
|--------|------|------|-----------|
| visibleComments | 뷰포트 내 댓글 목록 | getBoundingClientRect | content-hn.js |
| user.focus | 마지막 hover 대상 | mousemove 변수 기록 | content-hn.js |
| user.selection | 텍스트 선택 | window.getSelection | content-hn.js |
| structure | 페이지 접근성 구조 | headings, landmarks 추출 | content-hn.js |
| viewport | 뷰포트 스크린샷 | captureVisibleTab | Service Worker |
| sourceArticle | 원문 아티클 | ContentGraph 조회 | Side Panel |
| semantics | 캐시된 ThreadSemantics | 인메모리 캐시 | Side Panel |

### Projections (BE → FE 방향, 효과 실행)

BE가 SSE 스트림을 통해 Projection을 순차적으로 전달하면, Side Panel이 라우팅하여 실행한다.

| Projection | 역할 | 실행 주체 |
|-----------|------|-----------|
| respond(text, mode) | 음성 응답 (answer/suggest/clarify) | Side Panel → Gemini Live |
| focus(commentId, options) | 댓글 하이라이트 + 스크롤 | content-hn.js |
| focusMultiple(targets, options) | 복수 댓글 하이라이트 + dimming | content-hn.js |
| navigate(url, options) | 페이지 이동 | Service Worker |
| present(content, target) | 사이드바/오버레이 표시 | Side Panel |
| notify(message, level) | 알림 토스트 | Side Panel |
| copy(text) | 클립보드 복사 | Side Panel |

## 8.6 Agent Brain (BE 내부 구조)

Agent Brain Spec v1.1에 상세 정의. 요약:

```
POST /api/evaluate 수신
  → StateSnapshot (sourceArticle 포함) + ConversationContext 파싱
  → System Prompt 조립 (Persona + Rules + State + Source Article + Thread Analysis + History)
  → Gemini 2.5 Flash 에이전틱 루프 (최대 8회)
    → Internal Tool 호출 → BE 즉시 실행 → 결과 Gemini에 반환
    → Projection Tool 호출 → SSE로 FE에 즉시 스트리밍
    → 반복 until 판단 종료
  → done 이벤트 (ConversationContext + memoryDelta)
```

## 8.7 Session Lifecycle (Phase FSM)

```
Phases:
  initializing  — HN 댓글 페이지 진입, ThreadDoc 추출, /api/analyze 호출 중
  ready         — ThreadSemantics 수신 완료, Gemini Live 연결됨, 발화 대기
  conversing    — 사용자 발화 감지, SSE 진행 중
  dormant       — HN이 아닌 탭으로 전환 (Gemini Live 세션은 유지)
  error         — API 실패, 토큰 만료 등

Transitions:
  initializing → ready       : ThreadSemantics + Gemini Live 연결 완료
  initializing → error       : /api/analyze 또는 Gemini Live 연결 실패
  ready → conversing         : processUserIntent FC 수신
  conversing → ready         : SSE done 이벤트 수신
  ready → dormant            : 활성 탭이 HN 아님
  dormant → ready            : 활성 탭이 HN 댓글 페이지 (cachedSemantics 있으면)
  dormant → initializing     : 활성 탭이 새로운 HN 스레드
  * → error                  : 복구 불가능한 에러
```

## 8.8 Data Flow

### Flow 1: 초기 분석 (initializing → ready)

```
1. Side Panel 열림 → Gemini Live 연결 시작
2. Content Script (content-hn.js): HN DOM에서 ThreadDoc + 원문 URL 추출
3. Side Panel: ContentGraph에 thread 노드 추가
4. Side Panel: 원문 URL → Service Worker에 knownArticleUrls 등록
5. Side Panel → BE: POST /api/analyze { threadDoc, articleUrl }
6. BE: Gemini 2.5 Flash로 ThreadSemantics 생성 → Firestore 캐시
7. BE → Side Panel: ThreadSemantics 반환
8. Side Panel: cachedSemantics에 저장, Phase → ready
```

### Flow 2: 음성 대화 (Intent-Driven Cycle)

```
1. User: "이 댓글 맥락이 뭐야?"
2. Gemini Live: processUserIntent FC 발생
   → { transcript: "이 댓글 맥락이 뭐야?", intentType: "contextual_query" }
3. Side Panel: Phase → conversing
4. Side Panel: Content Script에 센서 요청 → 수집 → StateSnapshot 조립
   → sourceArticle: ContentGraph에서 조회 (있으면 포함)
5. Side Panel → BE: POST /api/evaluate (SSE)
6. BE 에이전틱 루프:
   6a. search_thread("이 댓글") → Internal Tool
   6b. respond("지금 보고 계신 댓글은...") → SSE 즉시 스트리밍
   6c. focus("39900123", { style: "primary" }) → SSE 즉시 스트리밍
   6d. done → SSE 완료
7. Side Panel Projection 실행:
   → respond: Gemini Live에 전달 → 음성 출력
   → focus: Content Script에 전달 → DOM 하이라이트 + 스크롤
8. Phase → ready (다음 발화 대기)
```

### Flow 3: 원문 크로스 참조

```
1. User: HN 댓글 페이지에서 원문 링크 클릭 → 원문 탭 열림
2. Service Worker: tabs.onUpdated → URL이 knownArticleUrls에 매칭
3. Service Worker: chrome.scripting.executeScript → content-article.js 주입
4. content-article.js: 텍스트 + 구조 추출 → Side Panel에 전달
5. Side Panel: ContentGraph에 article 노드 추가
6. User: HN 탭으로 돌아옴 → "원문에서 뭐라고 했어?"
7. Side Panel: StateSnapshot 조립 → sourceArticle: { url, title, text, ... }
8. Agent Brain: sourceArticle + semantics 크로스 참조 → 분석 응답
```

### Flow 4: Barge-in

```
1. Agent Brain이 respond 중 (음성 출력 진행 중)
2. User: 끼어듦 (새 발화)
3. Gemini Live: barge-in 감지 → 음성 중단 → 새 processUserIntent FC
4. Side Panel: currentAbortController.abort() → 진행 중 SSE 종료
5. Side Panel: ConversationContext에 interrupted 기록
6. Side Panel: 새 StateSnapshot 조립 → 새 POST /api/evaluate
```

## 8.9 ConversationContext (Stateless Round-trip)

BE는 stateless다. 멀티턴 대화의 맥락은 ConversationContext에 담겨 FE ↔ BE를 왕복한다.

```typescript
interface ConversationContext {
  turns: TurnSummary[]          // 최근 10턴, FIFO 삭제
  activeTopics: string[]        // 최대 10개
  pendingClarification?: string
  threadUrl: string
}

interface TurnSummary {
  intent: { type: string; summary: string }
  action: string
  result: string
  timestamp: number
}
```

BE의 `/api/evaluate`는 매 응답에 업데이트된 ConversationContext를 반환한다. FE는 다음 요청에 이것을 그대로 전달한다.

---

# 9. Gemini Configuration

## 9.1 Gemini Live (FE — 음성 인터페이스)

```
Model: gemini-2.5-flash-native-audio-preview-12-2025
Role: 센서 (음성→텍스트) + 프로젝션 (텍스트→음성)
Auth: Ephemeral Token (BE에서 발급)

System Instruction:
  "You are a voice interface for ThreadAtlas.
   When the user speaks, call processUserIntent with their request.
   When you receive a function result, speak it naturally in the user's language.
   You do NOT analyze or think — just relay."

Registered Function:
  processUserIntent(transcript: string, intentType: string)
    transcript: 사용자가 말한 내용
    intentType: "briefing_request" | "contextual_query" | "memory_query" |
                "navigation_request" | "clarification_response" | "general"

Config:
  responseModalities: ["AUDIO"]
  proactivity: { proactiveAudio: false }  // 자발적 발화 비활성화
```

## 9.2 Gemini 2.5 Flash (BE — Agent Brain)

```
Model: gemini-2.5-flash
Role: 판단 (Evaluate) + 도구 선택
Mode: tool_use, streaming

System Prompt (매 요청마다 조립):

  "You are the brain of ThreadAtlas, a thinking partner for reading
   online discussions.

   ## Current State
   {StateSnapshot — JSON}

   ## Conversation History
   {ConversationContext.turns — 최근 N턴}

   ## Your Tools

   ### Internal Tools (data gathering — results come back to you)
   - search_thread: Search current thread for relevant comments/claims.
     When sourceArticle is available, also match article claims with comments.
   - search_memory: Search user's reading history for related discussions
   - analyze_claims: Deep-analyze specific claims with full evidence
   - compare_claims: Compare two claims from different sources

   ### Projection Tools (user-facing — sent to user immediately)
   - respond: Respond to the user (answer, suggest options, or clarify)
   - focus: Highlight a specific comment on screen with scroll
   - focusMultiple: Highlight multiple comments with dimming
   - navigate: Open a URL in the browser
   - present: Show content in sidebar or overlay
   - notify: Show a notification message
   - copy: Copy text to clipboard

   ## Guidelines
   - Gather data with Internal Tools BEFORE projecting to user
   - You can call multiple Projection Tools in sequence
   - Distinguish claims from evidence when explaining
   - If past memory is relevant, proactively connect it
   - If user intent is ambiguous, use respond(mode: clarify)
   - Match the user's language (Korean question → Korean answer)
   - Keep spoken responses under 30 seconds each
   - Express uncertainty with '~로 보입니다'
   - If sourceArticle is provided, cross-reference the article's arguments
     with the thread's claims
   - If sourceArticle is null, never make definitive statements about the article.
     Infer from comments only. Suggest opening the article for more detail."
```

---

# 10. API Contract

상세 스펙은 Agent Brain Spec v1.1을 참조. 아래는 요약.

## 10.1 POST /api/evaluate (SSE Stream)

```typescript
// Request
interface EvaluateRequest {
  stateSnapshot: StateSnapshot
  conversationContext?: ConversationContext
}

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
  viewport: string | null
  sourceArticle: ArticleContext | null    // 사용자가 원문 탭을 열어본 경우만
  semantics: ThreadSemantics | null
  conversationContext: ConversationContext | null
}

// Response (SSE Stream)
// event: projection
// data: Projection

// event: done
// data: { conversationContext, memoryDelta }

type Projection =
  | { type: "respond"; payload: { text: string; mode: "answer" | "suggest" | "clarify" } }
  | { type: "focus"; payload: { commentId: string; options?: FocusOptions } }
  | { type: "focusMultiple"; payload: { targets: FocusTarget[]; options?: FocusMultipleOptions } }
  | { type: "navigate"; payload: { url: string; options?: NavigateOptions } }
  | { type: "present"; payload: { target: "sidebar" | "overlay"; content: PresentContent } }
  | { type: "notify"; payload: { message: string; level: "status" | "info" | "success" | "error" } }
  | { type: "copy"; payload: { text: string } }
```

## 10.2 POST /api/token

```typescript
// Request
{ userId: string }

// Response
{ token: string, expiresAt: number }
```

## 10.3 POST /api/analyze

```typescript
// Request
{
  userId: string,
  threadDoc: ThreadDoc,
  articleUrl: string | null     // HN DOM에서 추출한 원문 URL
}

// Response
{
  threadSemantics: ThreadSemantics,
  cached: boolean
}
```

---

# 11. Project Structure (Monorepo)

Turbo + Pnpm 기반 TypeScript 모노레포. Vitest로 테스트.

```
threadatlas/
├── apps/
│   ├── extension/                    # Chrome Extension (Semantic Relay)
│   │   ├── src/
│   │   │   ├── sidepanel/            # Side Panel (세션 주인)
│   │   │   │   ├── index.ts          # Side Panel 초기화 + Phase FSM
│   │   │   │   ├── state-assembler.ts # StateSnapshot 조립
│   │   │   │   ├── sse-client.ts     # POST /api/evaluate SSE 연결
│   │   │   │   ├── projection-router.ts # Projection 라우팅
│   │   │   │   ├── content-graph.ts  # ContentGraph (DAG) 관리
│   │   │   │   ├── gemini-live.ts    # Gemini Live 세션 관리
│   │   │   │   ├── audio.ts          # 오디오 I/O (AudioWorklet)
│   │   │   │   ├── token-manager.ts  # Token 갱신 관리
│   │   │   │   └── ui.ts            # Side Panel UI (present, notify, suggest)
│   │   │   ├── content/
│   │   │   │   ├── content-hn.ts     # HN 전용 Content Script (정적 inject)
│   │   │   │   │                     #   DOM 파서, 센서 수집, Projection 실행
│   │   │   │   └── content-article.ts # 원문 추출 Content Script (동적 inject)
│   │   │   ├── background/
│   │   │   │   └── service-worker.ts # Service Worker
│   │   │   │                         #   탭 감지, viewport 캡처, 메시지 라우팅
│   │   │   └── styles/
│   │   │       └── highlight.css     # Projection 하이라이트 스타일
│   │   ├── sidepanel.html
│   │   ├── manifest.json
│   │   ├── vitest.config.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── api/                          # Cloud Run (Agent Brain)
│       ├── src/
│       │   ├── server.ts             # Express + SSE 설정
│       │   ├── routes/
│       │   │   ├── evaluate.ts       # POST /api/evaluate (SSE stream)
│       │   │   ├── token.ts          # POST /api/token
│       │   │   └── analyze.ts        # POST /api/analyze
│       │   ├── agent/                # Agent Brain 핵심
│       │   │   ├── loop.ts           # Gemini tool-use 에이전틱 루프
│       │   │   ├── internal-tools.ts # search_thread, search_memory, ...
│       │   │   ├── projection.ts     # Projection SSE 스트리밍 로직
│       │   │   └── prompt.ts         # System Prompt 조립
│       │   ├── services/
│       │   │   ├── gemini.ts         # Gemini API 클라이언트
│       │   │   └── firestore.ts      # Firestore CRUD
│       │   └── index.ts
│       ├── Dockerfile
│       ├── vitest.config.ts
│       ├── tsconfig.json
│       └── package.json
│
├── packages/
│   └── shared/                       # 공유 타입, 유틸리티, 팩토리
│       ├── src/
│       │   ├── types/
│       │   │   ├── thread.ts         # ThreadDoc, Comment
│       │   │   ├── semantics.ts      # ThreadSemantics, Claim, KeyComment
│       │   │   ├── article.ts        # ArticleContext, ContentGraph
│       │   │   ├── memory.ts         # ThreadHistory, InterestProfile
│       │   │   ├── intent.ts         # Intent, IntentType
│       │   │   ├── state.ts          # StateSnapshot
│       │   │   ├── projection.ts     # Projection union type
│       │   │   ├── context.ts        # ConversationContext, TurnSummary
│       │   │   └── api.ts            # EvaluateRequest/Response, etc.
│       │   ├── utils/
│       │   │   ├── snapshot.ts       # StateSnapshot 빌더/직렬화
│       │   │   ├── context.ts        # ConversationContext 조작 유틸리티
│       │   │   └── hash.ts           # URL → nodeId 해싱
│       │   ├── factories/
│       │   │   ├── intent.ts         # Intent 팩토리 함수
│       │   │   ├── projection.ts     # Projection 팩토리 함수
│       │   │   └── memory.ts         # Memory 초기화/업데이트 팩토리
│       │   ├── constants/
│       │   │   ├── limits.ts         # 연쇄 제한, 토큰 TTL 등
│       │   │   └── defaults.ts       # 기본값 정의
│       │   └── index.ts
│       ├── vitest.config.ts
│       ├── tsconfig.json
│       └── package.json
│
├── turbo.json
├── pnpm-workspace.yaml
├── vitest.workspace.ts
├── tsconfig.base.json
└── package.json
```

### 핵심 설계 결정

**shared 패키지에 타입뿐 아니라 유틸리티와 팩토리도 포함한다.** FE와 BE가 동일한 직렬화/역직렬화 로직, 동일한 팩토리 함수를 사용하면 API 계약 위반이 빌드 타임에 잡힌다.

**core 패키지를 별도로 분리하지 않는다.** Agent Brain 로직은 apps/api 안에, Relay 로직은 apps/extension 안에 둔다. 12일 해커톤에서 패키지 경계를 최소화한다.

---

# 12. Tech Stack

| Layer | Technology | 용도 | 담당 |
|-------|-----------|------|------|
| Monorepo | Turbo + Pnpm | 빌드 오케스트레이션, 패키지 관리 | 공동 |
| Language | TypeScript (전체 통일) | FE/BE/shared 단일 타입 시스템 | 공동 |
| Test | Vitest | 단위/통합 테스트 | 공동 |
| Extension | Chrome Extension (Manifest V3) | Semantic Relay | FE |
| Voice I/O | Gemini Live API (@google/genai) | 센서 + 프로젝션 | FE |
| Auth | Ephemeral Token | Gemini Live 클라이언트 인증 | FE+BE |
| Backend | Cloud Run (Express + SSE) | Agent Brain | BE |
| AI (분석) | Gemini 2.5 Flash (일반 API) | ThreadDoc → ThreadSemantics | BE |
| AI (판단) | Gemini 2.5 Flash (tool_use, streaming) | 에이전틱 루프 + 도구 선택 | BE |
| Storage | Firestore | ThreadSemantics 캐시, 사용자 메모리 | BE |
| Deploy | Cloud Build | CI/CD | BE |

---

# 13. Team Responsibilities

## FE (정성우)

**Semantic Relay 전체:**
- Chrome Extension 셋업 (Manifest V3, Side Panel, Content Scripts, Service Worker)
- Side Panel: 세션 관리, Phase FSM, StateSnapshot 조립, ContentGraph
- content-hn.js: HN DOM 파서, 센서 수집, Projection 실행 (하이라이트, 배지, dimming)
- content-article.js: 원문 텍스트/구조 추출 (동적 inject)
- Service Worker: 탭 감지, viewport 캡처, 원문 탭 동적 inject, 메시지 라우팅
- Gemini Live 세션 관리 (Ephemeral Token 기반 WebSocket 연결)
- processUserIntent Function 등록 + FC 수신 → Intent 변환
- Audio I/O (MediaStream → AudioWorklet → PCM 16bit)
- SSE 클라이언트 (POST /api/evaluate → Projection 스트림 수신 → 라우팅)
- ConversationContext 왕복 관리
- Barge-in 처리 (SSE abort, Projection 큐 폐기)

## BE (팀원)

**Agent Brain 전체:**
- Cloud Run 서비스 (Express + SSE 설정)
- POST /api/evaluate (에이전틱 루프 + SSE 스트리밍)
- Internal Tools 구현 (search_thread, search_memory, analyze_claims, compare_claims)
- Projection Tool → SSE 스트리밍 로직
- System Prompt 조립 (StateSnapshot → Gemini 프롬프트)
- POST /api/token (Ephemeral Token 발급, live_connect_constraints)
- POST /api/analyze (Gemini API로 ThreadSemantics 생성)
- Firestore 스키마 + CRUD
- Dockerfile + Cloud Build 배포
- Cloud 배포 증명 영상 촬영

## 공동

- packages/shared 타입/유틸리티/팩토리 정의 (Day 1)
- API 계약 확정 (Section 10)
- Gemini System Prompt 설계 (Section 9)
- 데모 시나리오 설계 및 리허설
- 아키텍처 다이어그램
- README 및 프로젝트 설명

---

# 14. UI (Minimal)

에이전트의 가치는 음성 대화와 자율적 행동 선택에 있다. UI는 최소화한다.

### Side Panel

```
┌──────────────────────────────────────┐
│ ThreadAtlas                    [●]   │  ← 상태 인디케이터
│                                      │    (Phase별 색상)
├──────────────────────────────────────┤
│                                      │
│  [present 콘텐츠 영역]               │  ← present(sidebar) 시
│                                      │    카드 렌더링
│                                      │
├──────────────────────────────────────┤
│  [suggest 선택지 칩]                 │  ← respond(suggest) 시
│  [ claim_1 상세 ] [ claim_2 상세 ]   │    클릭 → 텍스트 입력 대체
├──────────────────────────────────────┤
│  [notify 토스트]                     │  ← 하단 토스트
│                                      │    3초 후 자동 사라짐
└──────────────────────────────────────┘

Phase별 인디케이터:
  initializing: 노란색 ● "분석 중..."
  ready:        초록색 ● "준비됨"
  conversing:   파란색 ● (펄스) "듣는 중..."
  dormant:      회색 ● "대기 중"
  error:        빨간색 ● "오류" + 재시도 버튼
```

### In-Page Elements (content-hn.js)

- 댓글 하이라이트 (focus/focusMultiple Projection 실행 시)
  - primary: 파란색 좌측 보더 + 연한 배경
  - secondary: 회색 좌측 보더
  - warning: 빨간색 좌측 보더
- 라벨 배지 (댓글 헤더 옆에 인라인 표시)
- Dimming (focusMultiple 시 비 대상 댓글 opacity 40%)

---

# 15. Success Metrics (MVP)

### Qualitative

- 음성 질문 → 음성 응답 루프가 자연스러운가
- Agent Brain이 상황에 맞는 도구를 자율적으로 선택하는가
- SSE 스트리밍으로 첫 응답이 빠르게 도달하는가
- 스크린샷 기반 컨텍스트가 현재 보고 있는 댓글을 정확히 식별하는가
- Barge-in이 자연스럽게 처리되는가
- 메모리 기반 회상이 과거 맥락을 연결하는가

### Quantitative

| Metric | Target |
|--------|--------|
| 초기 분석 (ThreadSemantics 생성) | < 8s |
| 첫 Projection 도달 (SSE first event) | < 2s |
| Focus 컨텍스트 정확도 (hover/visible 기반) | > 80% |
| Claim 추출 | >= 2 per thread |
| Ephemeral Token 발급 | < 500ms |
| Internal Tool 실행 (Firestore 조회) | < 300ms |
| Agent Brain 전체 응답 (evaluate 완료) | < 10s |
| 원문 추출 (content-article.js) | < 1s |
| sourceArticle 크로스 참조 정확도 | > 70% |

---

# 16. Demo Scenario (4분 영상)

### Act 1: Problem (20초)

"HN에서 200개 댓글이 달린 스레드를 열었습니다. 어디서부터 읽어야 할까요?"

### Act 2: Thread Briefing (50초)

- 스레드를 열면 ThreadAtlas가 자동 분석 (initializing → ready)
- 사용자: "이 스레드 핵심이 뭐야?"
- Agent Brain: search_thread → respond → focusMultiple
- 에이전트가 핵심 논점을 음성 브리핑 + 주요 댓글 하이라이트

### Act 3: Source Article Cross-Reference (40초)

- 사용자가 원문 링크 클릭 → 원문 탭 열림 → content-article.js 동적 inject
- 원문 읽고 HN 탭으로 복귀
- "원문에서 뭐라고 했어?"
- Agent Brain: sourceArticle + semantics 크로스 참조
- "글에서 주장하는 world model 정의와 댓글 c12의 정의가 달라요"

### Act 4: Contextual Analysis (40초)

- 사용자가 스크롤하며 특정 댓글에서 멈춤
- "이 댓글은 어떤 맥락이야?"
- Agent Brain: search_thread (focus 기반 식별) → respond + focus
- 해당 댓글의 논쟁 구조 내 위치 설명 + 하이라이트

### Act 5: Agent Autonomy — Barge-in (30초)

- "가장 설득력 있는 반론 보여줘"
- Agent Brain: analyze_claims → respond + focus + 스크롤
- 사용자가 중간에 끼어들어 추가 질문 → Barge-in → 새 Intent → 즉시 대응

### Act 6: Wrap-up (20초)

- 아키텍처 다이어그램 (Semantic Relay + Agent Brain 분리, ContentGraph DAG)
- DOM 스냅샷 원칙 강조
- One Sentence Pitch

---

# 17. Submission Checklist

| 항목 | 내용 | 담당 |
|------|------|------|
| 📃 Text Description | 프로젝트 요약, Semantic Relay + Agent Brain 아키텍처 설명 | 공동 |
| 👨‍💻 Public Repository | GitHub monorepo (spin-up 지침 포함 README) | 공동 |
| 🖥️ Cloud Deployment 증명 | Cloud Run 콘솔 화면 녹화 | BE |
| 🏗️ Architecture Diagram | Semantic Relay + Agent Brain + SSE 스트리밍 다이어그램 | 공동 |
| 📹 Demo Video | 4분 이내, Agent Brain 자율 도구 선택 데모 | FE 주도 |
| ⭐ Bonus: Blog Post | Semantic Relay 아키텍처 블로그 + #GeminiLiveAgentChallenge | 공동 |
| ⭐ Bonus: IaC Deployment | Cloud Build + Dockerfile 기반 자동 배포 | BE |

---

# 18. Development Plan

### Phase 1: Foundation (Day 1-3)

**공동**
- [ ] GitHub monorepo 셋업 (Turbo + Pnpm + Vitest)
- [ ] packages/shared 타입 정의 (Section 7 + Section 10 전체)
  - ArticleContext, ContentGraph, Projection union type 등 포함
- [ ] packages/shared 유틸리티/팩토리 구현
- [ ] API 계약 확정 + Mock 서버 작성

**FE**
- [ ] Chrome Extension 셋업 (Manifest V3, Side Panel, Service Worker)
- [ ] content-hn.js: HN DOM Parser 구현 (ThreadDoc + 원문 URL 추출)
- [ ] Side Panel 기본 구조 (Phase FSM, 상태 인디케이터)
- [ ] Service Worker: 활성 탭 감지 + 메시지 라우팅

**BE**
- [ ] Cloud Run 프로젝트 셋업 (Express + SSE)
- [ ] Dockerfile 작성
- [ ] POST /api/analyze 구현 (Gemini API 연동, articleUrl 포함)
- [ ] Firestore 스키마 생성 (threads/{threadId}/semantics,doc,meta) + CRUD

### Phase 2: Agent Core (Day 4-7)

**FE**
- [ ] Gemini Live 세션 연결 (Ephemeral Token, AudioWorklet)
- [ ] processUserIntent Function 등록 + Intent 변환
- [ ] StateSnapshot 조립 (센서 수집 → 조립 → sourceArticle 포함)
- [ ] SSE 클라이언트 (POST /api/evaluate → Projection 수신 → 라우팅)
- [ ] content-hn.js: Projection 실행 (focus, focusMultiple — 하이라이트, 배지, dimming)
- [ ] content-article.js: 원문 텍스트 추출 (동적 inject)
- [ ] ContentGraph 관리 (addThread, addArticle, getSourceArticle)

**BE**
- [ ] POST /api/token (Ephemeral Token 발급) 구현
- [ ] POST /api/evaluate 구현 — Gemini tool-use 에이전틱 루프
- [ ] Internal Tools 구현 (search_thread, search_memory)
- [ ] Projection → SSE 스트리밍 로직
- [ ] System Prompt 조립 로직 (sourceArticle + Thread Analysis 포함)
- [ ] Cloud Build 배포 파이프라인

### Phase 3: Memory + Polish (Day 8-10)

**FE**
- [ ] Side Panel UI (present 카드, suggest 칩, notify 토스트)
- [ ] ConversationContext 왕복 관리
- [ ] Barge-in 처리 (SSE abort, interrupted 기록)
- [ ] Token 갱신 (만료 2분 전 선제 갱신, 3회 재시도)
- [ ] Edge case 처리 (빈 스레드, content-article.js inject 실패 등)
- [ ] Focus Lifecycle 전환 규칙 구현

**BE**
- [ ] Internal Tools 추가 (analyze_claims, compare_claims)
- [ ] Memory CRUD + 자동 축적 로직 (memoryDelta 처리)
- [ ] System Prompt 튜닝 (sourceArticle 크로스 참조 정확도)
- [ ] Firestore 인덱싱 최적화
- [ ] 에이전틱 루프 안전장치 (MAX_LOOPS=8, LOOP_TIMEOUT=30s)

### Phase 4: Demo (Day 11-12)

**공동**
- [ ] 데모 시나리오 리허설 (Act 1-6, 원문 크로스 참조 포함)
- [ ] 4분 데모 영상 촬영 및 편집
- [ ] Cloud 배포 증명 영상 촬영
- [ ] 아키텍처 다이어그램 정리 (ContentGraph DAG 포함)
- [ ] README + 프로젝트 설명 작성
- [ ] (Bonus) 블로그 포스트 작성

---

# 19. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| SSE 스트리밍 + 에이전틱 루프 레이턴시 | 대화 부자연스러움 | Projection을 즉시 스트리밍하여 첫 응답 빠르게 전달. Internal Tool 결과 캐싱 |
| Gemini tool_use 도구 선택 부정확 | 잘못된 Projection 실행 | Tool description 정교화. MAX_LOOPS=8, LOOP_TIMEOUT=30s |
| Cloud Run 콜드 스타트 | 첫 요청 ~2-5초 지연 | min_instances=1 설정 (해커톤 기간 비용 미미) |
| Ephemeral Token 갱신 실패 | Gemini Live 세션 끊김 | 만료 2분 전 선제적 갱신. 3회 재시도. Phase → error |
| FE ↔ BE 병렬 개발 시 인터페이스 불일치 | 통합 시 버그 | packages/shared 타입으로 빌드 타임 검증. Day 1 API 계약 확정 |
| content-article.js CSP 차단 | 원문 텍스트 추출 불가 | sourceArticle: null fallback. Agent Brain이 "원문을 아직 파악하지 못했어요" 응답 |
| HN DOM 구조 변경 | content-hn.js 파서 깨짐 | Adapter 패턴으로 파서 분리. MVP에서는 하드코딩 허용 |
| 긴 스레드 (500+ 댓글) | StateSnapshot 크기 초과 | visibleComments만 전송 (전체 댓글 아님). ThreadSemantics 요약 형태 |
| ConversationContext 크기 증가 | 매 요청 페이로드 증가 | 최근 10턴 FIFO. activeTopics 최대 10개 |
| Side Panel ↔ Content Script 메시지 유실 | 센서 수집 실패 / Projection 미실행 | 빈 SensorData graceful fallback. Projection 실패는 비치명적 |
| 원문 텍스트 5000자 제한 | 긴 아티클 내용 손실 | MVP 허용. 프로덕션에서 Readability.js + 청크 분할 |
| AudioWorklet 리샘플링 이슈 | 마이크 입력 품질 저하 | Gemini Live SDK 내장 처리 먼저 확인. 필요시만 커스텀 구현 |

---

# 20. Cost Estimation (Hackathon Period)

| 항목 | 예상 비용 |
|------|----------|
| Gemini API — 분석 (무료 티어) | $0 |
| Gemini Live API — 데모/테스트 | < $5 |
| Gemini API — evaluate 루프 (무료 티어) | $0 |
| Cloud Run (min_instances=1, 12일) | < $15 |
| Firestore (읽기/쓰기) | < $1 |
| **총 예상 비용** | **< $25** |

---

# 21. One Sentence Pitch

> ThreadAtlas is a voice-powered thinking partner that sees your screen, remembers what you've read, and autonomously decides how to help you navigate complex online discussions — turning passive scrolling into active understanding.