# ThreadAtlas — Scenario Playbook

**Agent Brain 동작 시나리오 가이드**

Version: 1.0
Companion to: PRD v1.0

---

# 0. 공통 전제

## 사용자 프로필

```
사용자: 성우
InterestProfile:
  topics: { "AI agent": 12, "LLM scaling": 8, "world model": 5 }
  recentClaims: [...]
  updatedAt: 1709337600

ThreadHistory (최근 3개):
  - reddit.com/r/MachineLearning/comments/abc123
    topic: "LLM grounding problem"
    readAt: 3일 전
  - news.ycombinator.com/item?id=39847261
    topic: "Why agents fail in production"
    readAt: 6일 전
  - news.ycombinator.com/item?id=39801123
    topic: "Scaling laws and emergent behavior"
    readAt: 10일 전
```

## 현재 페이지

```
URL: news.ycombinator.com/item?id=39900001
제목: "Why AI Agents Need World Models"
댓글: 180개
Phase: conversing (분석 완료, Gemini Live 세션 활성)
```

## ThreadSemantics (사전 분석 완료)

```
topic: "AI agents and world models"

claims:
  claim_1:
    statement: "Agents need explicit world models for reliable behavior"
    stance: for
    evidence: ["cognitive science analogy", "robotics precedent"]
    supportingComments: [c12, c34, c67]
    counters: [claim_2]

  claim_2:
    statement: "Tool-based systems scale better without world models"
    stance: against
    evidence: ["API composition", "microservice analogy"]
    supportingComments: [c23, c45, c89]
    counters: [claim_1]

  claim_3:
    statement: "Hybrid approach — lightweight world model + tool augmentation"
    stance: neutral
    evidence: ["ReAct paper", "production case study"]
    supportingComments: [c56, c78]

keyComments:
  c12: defines_argument (claim_1의 원점)
  c45: provides_evidence (claim_2의 핵심 근거)
  c78: pivotal_rebuttal (claim_1과 claim_2의 절충)
```

## 시나리오 표기법

```
── FE ──    Semantic Relay (브라우저) 영역
── BE ──    Agent Brain (Cloud Run) 영역

Internal Tool:  BE 내부 실행, 결과가 Gemini에 반환됨
Projection Tool: SSE로 FE에 즉시 스트리밍됨

→ SSE:     BE → FE 스트리밍 이벤트
← POST:   FE → BE HTTP 요청
```

---

# 1. 단순 브리핑 (Single Projection)

**난이도:** ★☆☆☆☆
**패턴:** Internal Tool 0회 → Projection 1회
**핵심:** ThreadSemantics만으로 충분하면 도구를 호출하지 않는다

## 트리거

```
User: "이 스레드 핵심이 뭐야?"
```

## FE: Intent → StateSnapshot

```
Intent: UserSpeech {
  transcript: "이 스레드 핵심이 뭐야?",
  intentType: "briefing_request"
}

StateSnapshot:
  intent: UserSpeech
  threadSemantics: { topic: "AI agents and world models", claims: [3개] }
  viewport: [스크린샷 — 스레드 상단]
  selection: null
  conversationContext: null (첫 턴)

← POST /api/evaluate (SSE)
```

## BE: Agent Brain 에이전틱 루프

```
Gemini 수신 및 판단:
  "사용자가 브리핑을 요청했다.
   ThreadSemantics에 3개 claim이 있고 topic이 명확하다.
   추가 데이터 수집 필요한가? → 아니다. 바로 응답한다."

Step 1: Gemini → speak(...)                              ← Projection Tool
  "이 스레드는 AI 에이전트에 world model이 필요한지에 대한 토론이에요.
   크게 세 가지 입장이 있는데요 —
   첫 번째는 명시적인 world model이 필수라는 주장,
   두 번째는 tool 기반 시스템이 world model 없이도 확장된다는 반론,
   세 번째는 둘을 결합한 하이브리드 접근이에요.
   어떤 입장을 더 자세히 들어볼까요?"

→ SSE: event: projection { type: "speak", payload: "이 스레드는..." }

Step 2: Gemini → stop

→ SSE: event: done {
  conversationContext: {
    turns: [{
      intent: { type: "UserSpeech", summary: "briefing request" },
      action: "speak",
      result: "3-claim overview delivered",
      timestamp: ...
    }],
    activeTopics: ["AI agents", "world models"],
    threadUrl: "..."
  }
}
```

## FE: Projection 실행

```
1. speak → Gemini Live에 Function Result 전달 → 음성 출력
2. ConversationContext 저장 (다음 턴에 전달)
3. dormant (다음 Intent 대기)
```

## 주요 관찰

- Internal Tool을 **한 번도 호출하지 않았다.** ThreadSemantics가 이미 충분한 정보를 담고 있기 때문.
- Gemini가 "도구를 쓰지 않는다"는 판단을 자율적으로 내렸다. 도구 사용은 필요할 때만.
- speak 끝에 "어떤 입장을 더 자세히 들어볼까요?"로 자연스럽게 후속 대화를 유도.

---

# 2. 뷰포트 기반 맥락 분석 (Internal → Projection)

**난이도:** ★★☆☆☆
**패턴:** Internal Tool 1회 → Projection 2회
**핵심:** 스크린샷에서 댓글을 식별하고, 논쟁 구조 내 위치를 설명한다

## 트리거

```
User: [c45 댓글이 보이는 위치로 스크롤한 상태]
      "이 댓글은 어떤 맥락이야?"
```

## FE: Intent → StateSnapshot

```
Intent: UserSpeech {
  transcript: "이 댓글은 어떤 맥락이야?",
  intentType: "contextual_query"
}

StateSnapshot:
  intent: UserSpeech
  threadSemantics: { ... }
  viewport: [스크린샷 — c45 댓글이 중앙에 보임]
  selection: null
  conversationContext: { turns: [Turn 1] }

← POST /api/evaluate (SSE)
```

## BE: Agent Brain 에이전틱 루프

```
Gemini 수신 및 판단:
  "사용자가 '이 댓글'이라고 했다. 어떤 댓글인지 식별해야 한다.
   스크린샷에서 c45가 보인다.
   c45의 논쟁 구조 내 위치를 파악해야 한다."

Step 1: Gemini → search_thread("c45 context position")  ← Internal Tool
  BE 실행: ThreadSemantics에서 c45 조회
  결과 → Gemini에 반환:
  {
    commentId: "c45",
    role: "provides_evidence",
    claimId: "claim_2",
    claim: "Tool-based systems scale better without world models",
    summary: "API composition과 마이크로서비스 비유로 tool 기반 확장성 주장",
    parentChain: ["c23 (claim_2 정의)", "c38 (확장성 논의)", "c45 (구체적 근거)"]
  }

Step 2: Gemini → 결과 평가
  "c45는 claim_2의 핵심 근거다. claim_2는 claim_1에 대한 반론이다.
   사용자에게 이 구조를 설명하고, 해당 댓글을 하이라이트하자."

Step 3: Gemini → highlight("c45")                        ← Projection Tool
→ SSE: event: projection { type: "highlight", payload: { commentId: "c45" } }

Step 4: Gemini → speak(...)                              ← Projection Tool
  "지금 보고 계신 댓글은 claim_2의 핵심 근거예요.
   'tool 기반 시스템이 world model 없이도 확장된다'는 주장을 뒷받침하는데,
   구체적으로 API composition과 마이크로서비스 아키텍처를 비유로 들고 있어요.
   이건 위쪽 c12에서 시작된 'world model 필수론'에 대한 직접적인 반론이에요."

→ SSE: event: projection { type: "speak", payload: "지금 보고 계신..." }

Step 5: Gemini → stop
→ SSE: event: done { conversationContext: { ... } }
```

## FE: Projection 실행

```
1. highlight → Content Script에 postMessage → c45 DOM 하이라이트 (즉시)
2. speak → Gemini Live 음성 출력 (하이라이트 후 바로 시작)
3. dormant
```

## 주요 관찰

- **highlight가 speak보다 먼저 도착한다.** 사용자는 댓글이 하이라이트되는 것을 보면서 설명을 듣게 된다.
- search_thread가 ThreadSemantics 내에서 O(1) 수준의 간단한 조회이므로 레이턴시가 거의 없다.
- parentChain 정보로 "이 댓글이 논쟁의 어디에 위치하는지"를 계층적으로 설명할 수 있다.

---

# 3. 근거 강도 분석 (Heavy Internal → Multi Projection)

**난이도:** ★★★☆☆
**패턴:** Internal Tool 1회 (무거운 분석) → Projection 3회
**핵심:** ThreadSemantics의 기존 분석만으로 부족할 때 심화 분석을 수행한다

## 트리거

```
User: "world model 필수론의 가장 약한 근거가 뭐야?"
```

## FE: Intent → StateSnapshot

```
Intent: UserSpeech {
  transcript: "world model 필수론의 가장 약한 근거가 뭐야?",
  intentType: "general"
}

StateSnapshot:
  intent: UserSpeech
  threadSemantics: { ... }
  viewport: [스크린샷]
  selection: null
  conversationContext: { turns: [Turn 1, Turn 2] }

← POST /api/evaluate (SSE)
```

## BE: Agent Brain 에이전틱 루프

```
Gemini 수신 및 판단:
  "사용자가 claim_1의 '가장 약한 근거'를 물었다.
   ThreadSemantics에 claim_1의 evidence 목록은 있지만,
   '약한 근거'를 판단하려면 각 근거의 반박 상황까지 분석해야 한다.
   analyze_claims가 필요하다."

Step 1: Gemini → analyze_claims(["claim_1"])             ← Internal Tool
  BE 실행:
    - ThreadDoc에서 claim_1 관련 댓글 전체 추출 (c12, c34, c67 + 하위 댓글들)
    - Gemini 2.5 Flash에 심화 분석 요청 (내부 sub-call)
  결과 → Gemini에 반환:
  {
    claim: "claim_1",
    evidenceAnalysis: [
      {
        evidence: "cognitive science analogy",
        strength: "moderate",
        rebuttals: 3,
        strongestRebuttal: {
          commentId: "c89",
          summary: "비유는 증명이 아니다 — 인지과학의 world model과 AI의 world model은 다르다"
        }
      },
      {
        evidence: "robotics precedent",
        strength: "strong",
        rebuttals: 1,
        strongestRebuttal: {
          commentId: "c91",
          summary: "로보틱스의 물리적 world model과 LLM의 linguistic world model은 다른 문제다"
        }
      }
    ]
  }

Step 2: Gemini → 결과 평가
  "cognitive science analogy가 반박을 3번 받았고 strength가 moderate.
   이게 가장 약한 근거다. 사용자에게 설명하고, 핵심 반박 댓글을 보여주자."

Step 3: Gemini → speak(...)                              ← Projection Tool
  "world model 필수론의 근거 중 가장 취약한 건
   '인지과학에서의 비유'예요.
   이 근거는 반박을 세 번 받았는데,
   특히 c89에서 '비유는 증명이 아니다'라는 지적이 효과적이었어요.
   반면에 '로보틱스 선례' 근거는 비교적 견고한 편이에요."

→ SSE: event: projection { type: "speak", payload: "world model..." }

Step 4: Gemini → scrollTo("c89")                         ← Projection Tool
→ SSE: event: projection { type: "scrollTo", payload: { commentId: "c89" } }

Step 5: Gemini → highlight("c89")                        ← Projection Tool
→ SSE: event: projection { type: "highlight", payload: { commentId: "c89" } }

Step 6: Gemini → stop
→ SSE: event: done {
  conversationContext: { ... },
  memoryDelta: {
    interestProfile: { topicDeltas: { "world model criticism": 1 } }
  }
}
```

## FE: Projection 실행

```
1. speak → 음성 출력 시작 (즉시)
2. scrollTo → c89로 스크롤 (설명 듣는 중에 화면 이동)
3. highlight → c89 하이라이트 (스크롤 도착 후 하이라이트)
4. memoryDelta → ConversationContext에 반영
5. dormant
```

## 주요 관찰

- **analyze_claims는 무거운 도구다.** BE 내부에서 Gemini sub-call이 발생할 수 있으므로 1-3초 소요. 하지만 결과가 돌아온 뒤 speak이 SSE로 즉시 스트리밍되므로 사용자 체감 대기 시간은 최소화.
- speak → scrollTo → highlight 순서가 의도적이다. 사용자가 설명을 듣기 시작하고 → 화면이 이동하고 → 댓글이 하이라이트되는 시각적 시퀀스.
- memoryDelta로 "world model criticism"이라는 토픽이 사용자의 InterestProfile에 축적된다.

---

# 4. 모호한 질문 → Clarify → 후속 응답 (Multi-turn)

**난이도:** ★★★☆☆
**패턴:** 1턴(Projection 1회 clarify) → 2턴(Internal 2회 → Projection 4회)
**핵심:** 의도가 불명확하면 되묻고, pendingClarification으로 다음 턴에 맥락을 전달한다

## 트리거 (Turn 1)

```
User: "음... 이거 좀 이상한데"
```

## Turn 1: Clarify

### FE

```
Intent: UserSpeech {
  transcript: "음... 이거 좀 이상한데",
  intentType: "general"
}

StateSnapshot:
  intent: UserSpeech
  threadSemantics: { ... }
  viewport: [스크린샷 — c56과 c78이 보임]
  selection: null
  conversationContext: { turns: [...] }

← POST /api/evaluate (SSE)
```

### BE

```
Gemini 수신 및 판단:
  "사용자가 '이거'라고 했지만 대상이 불명확하다.
   스크린샷에 c56과 c78이 보인다.
   selection은 null.
   대상을 특정해야 한다 → clarify."

Step 1: Gemini → clarify(...)                            ← Projection Tool
  "어떤 부분이 이상하신 건가요?
   지금 보이는 댓글 중 하이브리드 접근을 제안하는 부분인가요,
   아니면 그 아래 절충안을 논의하는 부분인가요?"

→ SSE: event: projection { type: "clarify", payload: "어떤 부분이..." }

Step 2: Gemini → stop
→ SSE: event: done {
  conversationContext: {
    turns: [..., {
      intent: { type: "UserSpeech", summary: "ambiguous complaint" },
      action: "clarify",
      result: "asked to specify c56 vs c78"
    }],
    pendingClarification: "c56 vs c78 대상 특정",
    activeTopics: [...]
  }
}
```

### FE

```
1. clarify → Gemini Live 음성 출력
2. dormant (사용자 답변 대기)
```

## Turn 2: 후속 응답

### 트리거

```
User: "c78이. 이게 진짜 절충안이 되는 건지 모르겠어."
```

### FE

```
Intent: UserSpeech {
  transcript: "c78이. 이게 진짜 절충안이 되는 건지 모르겠어.",
  intentType: "clarification_response"
}

StateSnapshot:
  intent: UserSpeech
  threadSemantics: { ... }
  viewport: [스크린샷]
  selection: null
  conversationContext: {
    pendingClarification: "c56 vs c78 대상 특정",
    turns: [... Turn 1 포함 ...]
  }

← POST /api/evaluate (SSE)
```

### BE

```
Gemini 수신 및 판단:
  "이전 턴에서 clarify했고 사용자가 c78을 지목했다.
   c78이 절충안으로서 유효한지 분석해야 한다."

Step 1: Gemini → search_thread("c78 hybrid validity")    ← Internal Tool
  BE: c78의 전체 텍스트 + 하위 댓글 (c79, c80, c81) 조회
  결과 → Gemini에 반환:
  {
    comment: c78,
    text: "We should combine a lightweight world model with tool augmentation...",
    citedSource: "ReAct paper (Yao et al. 2023)",
    replies: [
      { id: "c79", text: "ReAct's 'world model' is just a trace buffer, not what c12 means...", score: 45 },
      { id: "c80", text: "This is a reasonable middle ground...", score: 12 },
      { id: "c81", text: "The definitions need to be aligned first...", score: 28 }
    ]
  }

Step 2: Gemini → analyze_claims(["claim_3"])             ← Internal Tool
  BE: claim_3 심화 분석
  결과 → Gemini에 반환:
  {
    claim: "claim_3",
    validity: "weak",
    reason: "ReAct 논문에서의 'world model' 정의가 claim_1의 'explicit world model'과 불일치.
             c79에서 이 불일치를 지적했으나 반박(c80, c81)이 정의 문제를 해소하지 못함.",
    definitionGap: {
      claim1_definition: "explicit, structured representation of environment state",
      claim3_definition: "implicit trace buffer that records action-observation history"
    }
  }

Step 3: Gemini → 결과 평가
  "c78의 절충안은 정의 불일치 문제가 있다.
   사용자의 직감이 맞았다. 구체적으로 설명하자."

Step 4: Gemini → highlight("c78")                        ← Projection Tool
→ SSE: event: projection { type: "highlight", payload: { commentId: "c78" } }

Step 5: Gemini → speak(...)                              ← Projection Tool
  "좋은 포인트예요. c78의 절충안은 사실 약점이 있어요.
   이 댓글이 인용하는 ReAct 논문에서의 'world model'은
   action-observation 히스토리를 기록하는 trace buffer에 가까운데,
   위쪽 c12에서 주장하는 'explicit world model'은
   환경 상태의 구조화된 표현을 의미해요.
   정의가 다른 개념을 같은 이름으로 묶고 있는 셈이에요."

→ SSE: event: projection { type: "speak", payload: "좋은 포인트예요..." }

Step 6: Gemini → highlight("c79")                        ← Projection Tool
→ SSE: event: projection { type: "highlight", payload: { commentId: "c79" } }

Step 7: Gemini → speak(...)                              ← Projection Tool
  "c79에서 이 불일치를 정확히 지적했는데, 반박이 없었어요.
   한번 읽어보시는 걸 추천드려요."

→ SSE: event: projection { type: "speak", payload: "c79에서 이 불일치를..." }

Step 8: Gemini → scrollTo("c79")                         ← Projection Tool
→ SSE: event: projection { type: "scrollTo", payload: { commentId: "c79" } }

Step 9: Gemini → stop
→ SSE: event: done {
  conversationContext: {
    pendingClarification: undefined,  // 해소됨
    turns: [... Turn 1, Turn 2 ...],
    activeTopics: ["hybrid approach", "world model definition", "ReAct"]
  }
}
```

### FE

```
1. highlight c78 → 하이라이트
2. speak (Step 5) → 음성 출력 (정의 불일치 설명)
3. highlight c79 → 추가 하이라이트
4. speak (Step 7) → 음성 출력 (추천)
5. scrollTo c79 → 스크롤
6. dormant
```

## 주요 관찰

- **pendingClarification이 턴 간 맥락을 전달한다.** BE는 stateless인데도 "이전에 뭘 물었고 사용자가 뭘 답했는지"를 안다.
- **Gemini가 2개의 Internal Tool을 순차적으로 사용했다.** search_thread로 원시 데이터를 모은 뒤, analyze_claims로 심화 분석. 이 순서도 Gemini가 자율적으로 결정.
- **"사용자의 직감이 맞았다"**는 판단을 Gemini가 내렸다. "좋은 포인트예요"로 시작하는 것은 사용자의 관찰이 분석적으로 타당했음을 확인해주는 것.

---

# 5. 크로스 스레드 메모리 회상 (Full Agentic Chain)

**난이도:** ★★★★★
**패턴:** Internal 4회 (search_thread → search_memory → compare_claims) → Projection 3회
**핵심:** 현재 스레드 검색 → 실패 → 메모리 검색 → 성공 → 비교 분석 → 복합 응답. SSE 스트리밍으로 첫 응답이 분석 완료 전에 도달한다.

## 트리거

```
User: [텍스트 선택: "the fundamental limitation is not compute but grounding"]
      "이런 주장 전에도 본 것 같은데, 기억나?"
```

## FE: Intent → StateSnapshot

```
Intent: UserSpeech + UserSelection

StateSnapshot:
  intent: UserSpeech {
    transcript: "이런 주장 전에도 본 것 같은데, 기억나?",
    intentType: "memory_query"
  }
  threadSemantics: { ... }
  viewport: [스크린샷]
  selection: {
    text: "the fundamental limitation is not compute but grounding",
    commentId: "c67",
    surroundingContext: "...argues that the fundamental limitation is not compute but grounding, which requires..."
  }
  conversationContext: { turns: [...] }

← POST /api/evaluate (SSE)
```

## BE: Agent Brain 에이전틱 루프

```
Gemini 수신 및 판단:
  "사용자가 텍스트를 선택하고 '전에도 본 것 같다'고 했다.
   메모리 검색 요청이다.
   먼저 현재 스레드에서 비슷한 논점을 확인하고,
   그다음 과거 메모리를 검색하자."


Step 1: Gemini → search_thread(                          ← Internal Tool
  "fundamental limitation grounding not compute"
)
  BE: ThreadSemantics 검색
  결과 → Gemini에 반환:
  {
    matches: [{
      commentId: "c67",
      claim: "claim_1",
      note: "선택된 텍스트가 속한 댓글 자체. 같은 주장을 하는 다른 댓글은 없음."
    }],
    conclusion: "현재 스레드 내에서 동일한 주장은 c67 하나뿐"
  }


Step 2: Gemini → 판단
  "현재 스레드에는 같은 주장이 하나뿐이다.
   사용자가 '전에도 본 것 같다'고 했으니 과거 메모리를 검색해야 한다."


Step 3: Gemini → search_memory(                          ← Internal Tool
  "grounding limitation LLM agents fundamental"
)
  BE: Firestore ThreadHistory 검색 (토픽/키워드 매칭)
  결과 → Gemini에 반환:
  {
    matches: [
      {
        url: "reddit.com/r/MachineLearning/comments/abc123",
        topic: "LLM grounding problem",
        readAt: "3일 전",
        relevantClaim: {
          statement: "LLMs lack grounding — they manipulate symbols without understanding",
          stance: "for",
          evidence: ["Harnad's symbol grounding problem", "embodied cognition literature"]
        }
      },
      {
        url: "news.ycombinator.com/item?id=39847261",
        topic: "Why agents fail in production",
        readAt: "6일 전",
        relevantClaim: {
          statement: "Production agent failures stem from insufficient world modeling",
          stance: "for",
          evidence: ["case study: autonomous coding agent", "error taxonomy"]
        }
      }
    ]
  }


Step 4: Gemini → 판단
  "과거에 비슷한 논점이 두 번 나왔다.
   Reddit 스레드(3일 전)가 가장 직접적으로 관련된다.
   사용자에게 바로 알려주자 — 비교 분석은 그 다음에 해도 된다."


Step 5: Gemini → speak(...)                              ← Projection Tool
  "네, 비슷한 주장을 본 적 있으세요.
   3일 전에 레딧 r/MachineLearning에서 읽으셨던 스레드에서
   거의 같은 논점이 나왔어요."

→ SSE: event: projection { type: "speak", payload: "네, 비슷한..." }

  ┌─────────────────────────────────────────────────────────────┐
  │ 이 시점에서 FE는 즉시 Gemini Live 음성 출력을 시작한다.       │
  │ 사용자는 "네, 비슷한 주장을 본 적 있으세요..." 를 듣고 있다.  │
  │ BE는 동시에 다음 단계(compare_claims)를 실행하고 있다.        │
  └─────────────────────────────────────────────────────────────┘


Step 6: Gemini → compare_claims(                         ← Internal Tool
  "the fundamental limitation is not compute but grounding",
  "LLMs lack grounding — they manipulate symbols without understanding"
)
  BE: 두 claim 비교 분석
  결과 → Gemini에 반환:
  {
    similarity: "high",
    commonGround: "두 주장 모두 grounding을 LLM의 근본적 한계로 지목",
    differences: [
      "현재 스레드(c67): compute와의 대비에 초점. 'compute가 아니라 grounding이 문제'라는 프레이밍",
      "Reddit: Harnad의 symbol grounding problem이라는 학술적 프레임. 기호 조작 vs 이해의 구분"
    ],
    evolution: "Reddit에서는 이론적/철학적 논의였지만, 현재 스레드에서는 agent 실패 사례와 연결되어 더 실용적 맥락으로 전환됨"
  }


Step 7: Gemini → speak(...)                              ← Projection Tool
  "그때 레딧에서는 Harnad의 symbol grounding problem이라는
   학술적 프레임으로 논의했었는데,
   지금 이 스레드에서는 같은 주장이 agent 실패 사례와 연결되어
   좀 더 실용적인 맥락에서 다뤄지고 있어요.
   논점의 핵심은 같지만, 근거의 성격이 달라진 셈이에요."

→ SSE: event: projection { type: "speak", payload: "그때 레딧에서는..." }


Step 8: Gemini → 판단
  "두 과거 스레드 모두 관련이 있다.
   사이드바로 비교 뷰를 보여주는 게 직접 이동보다 유용하다."


Step 9: Gemini → openSidebar({                           ← Projection Tool
  title: "관련 과거 스레드",
  items: [
    {
      source: "Reddit r/MachineLearning",
      url: "reddit.com/r/MachineLearning/comments/abc123",
      readAt: "3일 전",
      relevantClaim: "LLMs lack grounding — they manipulate symbols without understanding",
      connection: "같은 grounding 한계론, 학술적 프레임 (Harnad)"
    },
    {
      source: "Hacker News",
      url: "news.ycombinator.com/item?id=39847261",
      readAt: "6일 전",
      relevantClaim: "Production agent failures stem from insufficient world modeling",
      connection: "agent 실패 → world model 부재 귀인"
    }
  ]
})

→ SSE: event: projection { type: "openSidebar", payload: { ... } }


Step 10: Gemini → stop
→ SSE: event: done {
  conversationContext: {
    turns: [..., {
      intent: { type: "UserSpeech+UserSelection", summary: "memory query about grounding" },
      action: "search_thread → search_memory → speak → compare_claims → speak → openSidebar",
      result: "2 past threads found, comparison delivered"
    }],
    activeTopics: ["grounding", "world model", "symbol grounding problem"]
  },
  memoryDelta: {
    interestProfile: {
      topicDeltas: { "grounding": 1, "symbol grounding problem": 1 }
    },
    threadHistory: {
      highlights: ["the fundamental limitation is not compute but grounding"]
    }
  }
}
```

## FE: Projection 실행 (시간 축)

```
T+0.0s  POST /api/evaluate 전송
T+0.3s  BE: search_thread 실행 (빠름)
T+0.8s  BE: search_memory 실행 (Firestore 조회)
T+1.2s  SSE: speak #1 수신 → Gemini Live 음성 출력 시작
        "네, 비슷한 주장을 본 적 있으세요..."
        ★ 사용자는 여기서부터 듣기 시작
T+1.2s  BE: compare_claims 실행 중 (백그라운드)
T+3.5s  SSE: speak #2 수신 → 음성 출력 이어서
        "그때 레딧에서는 Harnad의..."
T+4.0s  SSE: openSidebar 수신 → 사이드바에 비교 뷰 표시
T+4.2s  SSE: done 수신 → ConversationContext 업데이트
        dormant

총 체감 대기 시간: ~1.2초 (첫 speak까지)
총 처리 시간: ~4.2초
```

## 주요 관찰

- **SSE 스트리밍의 핵심 가치가 여기서 드러난다.** compare_claims(Step 6)가 2초 이상 걸리지만, 그 전에 이미 첫 speak(Step 5)이 FE에 도달해서 사용자가 듣기 시작한다. 사용자 체감 대기 시간은 1.2초.
- **Gemini가 Internal과 Projection을 인터리빙한다.** search → search → **speak** → compare → **speak** → **openSidebar** 순서. 정보를 일부 모으고, 일부 전달하고, 나머지를 모으고, 나머지를 전달하는 자연스러운 패턴.
- **navigateTo가 아닌 openSidebar를 선택했다.** Gemini가 "두 과거 스레드 모두 관련이 있으므로 비교 뷰가 더 유용하다"고 판단. Projection 도구 선택의 자율성.
- **memoryDelta가 양방향으로 작동한다.** 사용자가 과거 메모리를 조회하는 동시에, 이번 대화 자체가 새로운 메모리(highlight, topic delta)로 축적된다.

---

# 6. Barge-in (사용자 중단)

**난이도:** ★★★☆☆
**패턴:** 진행 중인 사이클 중단 → 새 사이클 즉시 시작
**핵심:** FE가 SSE 연결을 abort하고, ConversationContext에 중단 이력을 기록한다

## 트리거

```
User: "이 스레드의 전체 claim 구조를 설명해줘"
      [에이전트가 응답하는 도중]
User: "잠깐, 두 번째 claim부터 설명해줘"    ← Barge-in
```

## Phase 1: 원래 요청 처리 중

```
← POST /api/evaluate (SSE) — claim 구조 전체 설명 요청

BE 처리 중, SSE 스트리밍:
  → event: projection { type: "speak", payload: "첫 번째 claim은 world model이..." }
  → event: projection { type: "speak", payload: "이 주장의 핵심 근거는..." }
  (... 아직 claim_2, claim_3 설명이 남아있음 ...)

FE:
  speak #1 → Gemini Live 음성 출력 중
  speak #2 → 큐에 대기 중
```

## Phase 2: Barge-in 발생

```
User: "잠깐, 두 번째 claim부터 설명해줘"

Gemini Live:
  1. Barge-in 감지 → 현재 음성 출력 즉시 중단
  2. processUserIntent FC 발생:
     { transcript: "두 번째 claim부터 설명해줘", intentType: "navigation_request" }

FE:
  1. 진행 중인 SSE 연결 abort (AbortController.abort())
  2. Projection 큐 비우기 (미실행 Projection 폐기)
  3. 새 Intent 생성
  4. ConversationContext 업데이트:
     이전 턴에 "interrupted" 마킹
```

## Phase 3: 새 사이클

### FE

```
Intent: UserSpeech {
  transcript: "두 번째 claim부터 설명해줘",
  intentType: "navigation_request"
}

StateSnapshot:
  intent: UserSpeech
  threadSemantics: { ... }
  viewport: [스크린샷]
  selection: null
  conversationContext: {
    turns: [..., {
      intent: { type: "UserSpeech", summary: "full claim structure request" },
      action: "speak (interrupted)",
      result: "claim_1 partial explanation delivered, interrupted by user"
    }],
    activeTopics: [...]
  }

← POST /api/evaluate (SSE) — 새 요청
```

### BE

```
Gemini 수신 및 판단:
  "이전 턴에서 claim 구조 설명 중 사용자가 중단했다.
   claim_1은 일부 설명됨 (interrupted).
   사용자가 claim_2부터 시작하라고 요청했다."

Step 1: Gemini → speak(...)                              ← Projection Tool
  "알겠어요. 두 번째 claim은
   'tool 기반 시스템이 world model 없이도 확장된다'는 주장이에요.
   핵심 근거가 두 가지인데요 —
   하나는 API composition이 world model보다 유연하다는 것이고,
   다른 하나는 마이크로서비스 아키텍처에서의 성공 사례예요."

→ SSE: event: projection { type: "speak", payload: "알겠어요..." }

Step 2: Gemini → highlight("c23")                        ← Projection Tool
→ SSE: event: projection { type: "highlight", payload: { commentId: "c23" } }

Step 3: Gemini → speak(...)                              ← Projection Tool
  "c23에서 이 주장이 처음 제기됐고,
   c45에서 구체적인 근거가 추가됐어요.
   세 번째 claim인 하이브리드 접근도 들어볼까요?"

→ SSE: event: projection { type: "speak", payload: "c23에서..." }

Step 4: Gemini → stop
→ SSE: event: done { conversationContext: { ... } }
```

## 주요 관찰

- **Barge-in 처리의 핵심은 세 가지 동시 작업이다:** Gemini Live가 음성 출력을 멈추고, FE가 SSE 연결을 끊고, ConversationContext에 "interrupted"를 기록.
- **Agent Brain은 중단을 인식한다.** ConversationContext에 "claim_1 partial explanation, interrupted"가 기록되어 있으므로, Gemini가 claim_1을 다시 설명하지 않고 claim_2부터 시작.
- **AbortController를 사용한 SSE 연결 중단**이 FE 구현의 핵심. 미실행 Projection을 깨끗하게 폐기해야 한다.

---

# 7. 사용자 질문에 데이터 없음 → 대안 제시 (Graceful Fallback)

**난이도:** ★★☆☆☆
**패턴:** Internal 2회 (둘 다 결과 없음) → Projection 2회 (speak + suggest)
**핵심:** 요청된 정보가 없을 때 에이전트가 대안을 자율적으로 제안한다

## 트리거

```
User: [텍스트 선택: "transformer attention is fundamentally limited"]
      "이 주장과 비슷한 댓글 있어?"
```

## BE: Agent Brain

```
Step 1: Gemini → search_thread(                          ← Internal Tool
  "transformer attention fundamentally limited"
)
  결과: { matches: [], conclusion: "현재 스레드에 유사한 주장 없음" }

Step 2: Gemini → search_memory(                          ← Internal Tool
  "transformer attention limitation"
)
  결과: { matches: [], conclusion: "과거 메모리에도 유사한 논점 없음" }

Step 3: Gemini → 판단
  "현재 스레드에도, 과거 메모리에도 매칭이 없다.
   하지만 사용자가 선택한 텍스트의 핵심 주제는 'attention의 한계'이고,
   현재 스레드의 claim_1('world model 필요성')과 간접적 관련이 있다.
   대안을 제안하자."

Step 4: Gemini → speak(...)                              ← Projection Tool
  "transformer attention의 한계에 대한 동일한 주장은
   현재 스레드에서도, 이전에 읽으셨던 스레드에서도 찾지 못했어요.
   다만 현재 스레드에서 world model의 필요성을 주장하는 논점이
   간접적으로 관련될 수 있어요."

→ SSE: event: projection { type: "speak", payload: "transformer attention의..." }

Step 5: Gemini → suggest([                               ← Projection Tool
  "world model 관점에서 attention 한계 분석",
  "이 주장을 새로운 관심 토픽으로 기억",
  "다른 관점에서 비슷한 댓글 검색"
])

→ SSE: event: projection { type: "suggest", payload: [...] }

Step 6: Gemini → stop
→ SSE: event: done { conversationContext: { ... } }
```

## 주요 관찰

- **"없다"가 답이 아니라 대안 제안이 답이다.** Gemini가 매칭 실패를 인식하고 자율적으로 관련 가능한 논점과 선택지를 제안.
- **suggest Projection**으로 사용자에게 다음 행동의 선택지를 제공. UI에 선택지 버튼이 표시되거나, 음성으로 옵션을 제시.

---

# 8. 시나리오 패턴 요약

| # | 시나리오 | Internal | Projection | 핵심 패턴 |
|---|---------|----------|-----------|----------|
| 1 | 단순 브리핑 | 0 | 1 (speak) | 도구 없이 즉답 |
| 2 | 뷰포트 맥락 | 1 (search_thread) | 2 (highlight, speak) | 식별 → 설명 |
| 3 | 근거 강도 분석 | 1 (analyze_claims) | 3 (speak, scrollTo, highlight) | 심화 분석 → 복합 응답 |
| 4 | 모호 → Clarify | 0 → 2 (search, analyze) | 1 (clarify) → 4 | 2턴 대화, 맥락 전달 |
| 5 | 메모리 회상 | 4 (search×2, compare, search_thread) | 3 (speak×2, openSidebar) | SSE 인터리빙 |
| 6 | Barge-in | — | — | SSE abort + 새 사이클 |
| 7 | 데이터 없음 | 2 (결과 없음) | 2 (speak, suggest) | Graceful fallback |

## Agent Brain 판단의 공통 원칙

1. **충분하면 바로 응답한다.** ThreadSemantics만으로 답할 수 있으면 Internal Tool을 호출하지 않는다. (Scenario 1)

2. **부족하면 모은 뒤 응답한다.** 추가 데이터가 필요하면 Internal Tool로 수집하고, 수집이 끝난 뒤 Projection으로 응답한다. (Scenario 2, 3)

3. **모호하면 되묻는다.** 사용자 의도가 불명확하면 clarify를 선택하고, pendingClarification으로 다음 턴에 맥락을 전달한다. (Scenario 4)

4. **중간 결과를 먼저 전달한다.** 전체 분석이 끝나기 전에 확신이 있는 부분을 SSE로 먼저 스트리밍한다. (Scenario 5, Step 5 → Step 6)

5. **없으면 대안을 제안한다.** 매칭 실패를 빈 응답으로 끝내지 않고, 관련 가능한 논점이나 행동 선택지를 제시한다. (Scenario 7)

6. **Projection 순서에 의미가 있다.** highlight → speak (시각적 참조 후 설명), speak → scrollTo (설명 시작 후 화면 이동). 이 순서를 Gemini가 자율적으로 결정한다.