# Sprint 4 — Semantic Primitive 기반 패턴 인식 파이프라인

> 선행 문서: SPEC.md, CODEX_REQUIREMENTS.md
> 목표: 사이트 무관하게 작동하는 범용 semantic extraction 엔진 구축
> 구조: **4A (라이브러리 즉시 수확)** → **4B (직접 DOM 패턴 매칭)**

---

## 1. 스프린트 목표

어떤 웹 페이지에서든, site-specific 코드 없이, **4개의 semantic primitive를 인식하고 구조를 추출**하는 generic 파이프라인을 완성한다.

Sprint 4A만으로 해커톤 데모가 가능한 수준, Sprint 4B까지 완료하면 SaaS/e-commerce까지 커버하는 수준을 목표로 한다.

---

## 2. 웹의 의미론적 수렴 — 7 Patterns, 4 Primitives

### 2.1 Seven Patterns of the Web

| # | Pattern | 구조 | 해당 사이트 |
|---|---------|------|------------|
| 1 | **Authored Content** | Title → Byline → Heading 계층 → Paragraph/Code/Quote | Medium, Substack, 뉴스, 블로그, Wikipedia |
| 2 | **Threaded Discussion** | Root post → nested comment tree (depth 변화) | HN, Reddit, Discourse, GitHub Issues |
| 3 | **Flat Feed** | 독립 item의 평면 리스트 (depth 변화 없음) | HN 프론트, Reddit 피드, Twitter 타임라인 |
| 4 | **Structured Listing** | 정형 필드(가격, 평점) 가진 item 목록 + filter/sort | Amazon, Airbnb, Google 검색, npm 검색 |
| 5 | **Documentation** | Sidebar nav + Breadcrumb + 본문 + Prev/Next | MDN, React docs, VueUse, Stripe docs |
| 6 | **Dashboard / Form** | Nav + Interactive controls + Metrics + Data table | GitHub dashboard, Jira, Notion, SaaS |
| 7 | **Profile / Entity** | Identity + Stats + Bio + Activity feed | GitHub 프로필, Twitter 프로필, npm 패키지 |

같은 사이트라도 페이지에 따라 패턴이 다르다. HN 프론트는 Flat Feed, 개별 글은 Threaded Discussion.

### 2.2 Four Semantic Primitives

7개 패턴을 분해하면 **4개 기본 단위의 조합**이다.

| # | Primitive | 정의 |
|---|-----------|------|
| ① | **Authored Block** | 한 저자가 쓴 텍스트 덩어리. heading으로 구조화. |
| ② | **Repeated Item** | 동일 패턴이 반복되는 목록. depth 있으면 tree, 없으면 list. |
| ③ | **Navigation Cluster** | 다른 페이지/섹션으로의 링크 집합. |
| ④ | **Interactive Block** | label + input, button, select 등 사용자 조작 가능한 요소의 집합. |

패턴 = Primitive 조합:

| Pattern | 조합 |
|---------|------|
| Authored Content | ① |
| Threaded Discussion | ① + ②(nested) |
| Flat Feed | ②(flat) |
| Structured Listing | ②(flat) + ④(filter/sort) |
| Documentation | ③ + ① |
| Dashboard / Form | ③ + ④ + ①(metrics) |
| Profile / Entity | ① + ② + ④(CTA) |

Primitive는 서로 내포(embedding)될 수 있다. Repeated Item의 각 item 내부가 다시 Authored Block + Interactive Block일 수 있다.

---

## 3. 라이브러리 커버리지 분석

### 3.1 @mozilla/readability가 주는 것

```ts
{
  title: string              // 페이지 제목
  byline: string | null      // 저자
  content: string            // article body HTML (정제됨)
  textContent: string        // plain text
  excerpt: string            // 요약
  siteName: string           // 사이트명
  publishedTime: string      // 발행일
  lang: string               // 언어
}
```

+ `isProbablyReaderable(document)` → article 페이지 여부 판별.

**커버리지**: Authored Block의 존재 여부, 경계, 메타데이터를 거의 완벽하게 제공.

### 3.2 dom-to-semantic-markdown AST가 주는 것

```
HeadingNode       heading level 1-6 + content
TextNode          plain text
LinkNode          href + content
ImageNode         src + alt
CodeNode          language + content + inline 여부
ListNode          ordered 여부 + ListItemNode[]
TableNode         TableRowNode[] → TableCellNode[]
BlockquoteNode    content
SemanticHtmlNode  htmlType: 'article'|'section'|'nav'|'aside'|'header'|'footer'|'main'|
                           'details'|'summary'|'figure'|'figcaption'|'mark'|'time'|'address'
VideoNode         src + poster
BoldNode / ItalicNode / StrikethroughNode
```

+ `overrideElementProcessing` 훅 → 원본 DOM Element 접근 가능.

### 3.3 Primitive별 커버리지 매핑

| Primitive | readability | AST | 직접 DOM 필요 | 난이도 |
|-----------|:-----------:|:---:|:------------:|:------:|
| **① Authored Block** | 경계 + 메타데이터 | 내부 구조 전체 | 거의 불필요 | **쉬움** |
| **③ Navigation Cluster** | — | `SemanticHtmlNode(nav)` + link 구조 | 보조적 | **쉬움** |
| **② Repeated Item (list/table)** | — | `ListNode`, `TableNode` | 불필요 | **쉬움** |
| **② Repeated Item (div 기반)** | — | 감지 불가 | **sibling 패턴 매칭** | **중간** |
| **④ Interactive Block** | — | 감지 불가 (strip됨) | **form/input/label 탐지** | **중간** |

---

## 4. Sprint 4A — 라이브러리 즉시 수확

> readability + dom-to-semantic-markdown만으로 되는 것들.
> 이것만으로 해커톤 데모 가능.

### 4A 스코프

| 항목 | 내용 |
|------|------|
| AuthoredBlockRecognizer | readability 경계 + AST 내부 구조 |
| NavigationClusterRecognizer | AST의 SemanticHtmlNode(nav) + link density |
| RepeatedItemRecognizer (list/table) | AST의 ListNode, TableNode |
| GenericSemanticExtractor 조립 | 위 세 개 오케스트레이션 |

### 4A-1. AuthoredBlockRecognizer

**입력**: Document
**출력**: RecognizedRegion[]

```
탐지:
  1. isProbablyReaderable(document) → article 존재 판별
  2. AST에서 SemanticHtmlNode('article'), SemanticHtmlNode('main') 탐지
  3. 둘 다 있으면 readability 결과를 우선 (경계가 더 정확)

추출:
  1. readability로 article body element 확보 (cloneNode 필수)
  2. dom-to-semantic-markdown AST 변환
  3. HeadingNode 계층으로 section 분할
  4. 각 section 내 TextNode, CodeNode, BlockquoteNode, ImageNode → ContentNode 변환
  5. readability의 byline, publishedTime → metadata

subtype:
  - 'article': heading 계층이 있는 장문 (HeadingNode 존재)
  - 'post': heading 없는 단문 (HeadingNode 부재)
```

**거의 공짜인 이유**: readability가 경계를 잡고, AST가 구조를 풀어주니까 조립만 하면 된다.

### 4A-2. NavigationClusterRecognizer

**입력**: Document
**출력**: RecognizedRegion[]

```
탐지:
  1. AST에서 SemanticHtmlNode('nav') 수집 → 각각이 region
  2. SemanticHtmlNode('header'), SemanticHtmlNode('footer') 내부에서 LinkNode 밀도 계산
     → link 비율 > 0.7이면 navigation region
  3. ListNode 내부가 전부 LinkNode이면 → menu 패턴

추출:
  1. 각 LinkNode의 href + content 수집
  2. 구조적 위치로 subtype 판별:
     - header 내부 → 'global'
     - aside/sidebar 내부 → 'local'
     - 순차적 짧은 링크 + separator (>, /, →) → 'breadcrumb'
     - 숫자 링크 + prev/next → 'pagination'

subtype: 'global' | 'local' | 'breadcrumb' | 'pagination'
```

**거의 공짜인 이유**: `<nav>`가 강한 signal이고, AST가 이미 `SemanticHtmlNode`으로 잡아준다.

### 4A-3. RepeatedItemRecognizer (list/table 한정)

**입력**: Document
**출력**: RecognizedRegion[]

```
탐지:
  1. AST에서 ListNode 수집 → item이 3개 이상이면 반복 구조
  2. AST에서 TableNode 수집 → row가 3개 이상이면 반복 구조
  3. ListNode 내부에 중첩 ListNode이 있으면 → nested (tree)
     없으면 → flat (list)

추출:
  ListNode의 경우:
    1. 각 ListItemNode 내부의 AST를 ContentNode로 변환
    2. nested list면 parentId로 tree 구조 표현

  TableNode의 경우:
    1. 첫 row를 header로 판별 (th 태그 또는 첫 번째 row)
    2. 이후 row를 각각 item으로, cell을 field로 매핑

subtype: 'flat' | 'nested'
```

**거의 공짜인 이유**: AST가 `ListNode`, `TableNode`를 이미 구조화해서 돌려준다.

### 4A-4. GenericSemanticExtractor 조립

```ts
class GenericSemanticExtractor implements PageExtractor {
  readonly id = 'generic'

  private recognizers = [
    new AuthoredBlockRecognizer(),      // readability + AST
    new NavigationClusterRecognizer(),  // AST SemanticHtmlNode
    new RepeatedItemRecognizer(),       // AST ListNode/TableNode
  ]

  match(): boolean {
    return true  // 항상 매치. fallback이자 주력.
  }

  buildSkeleton(document: Document): SemanticSkeleton {
    // 1. 모든 recognizer.detect() 실행 → RecognizedRegion[] 수집
    // 2. 중복 해소: 한 element가 여러 recognizer에 잡히면 confidence 높은 쪽
    // 3. 포함 관계: 큰 region이 작은 region을 포함하면 parent-child
    // 4. 각 region의 anchor에 data-semantic-region 속성 부여
    // 5. SemanticSkeleton 반환 (regions는 전부 state: 'unloaded')
  }

  expandRegion(region: SemanticRegionRef): SemanticRegion {
    // region의 primitive에 맞는 recognizer.extract() 호출
  }
}
```

### 4A 완료 기준

site-specific 코드 0줄로 다음이 작동한다:

| 사이트 | 기대 인식 |
|--------|----------|
| 임의의 블로그/뉴스 기사 | Authored Block (heading 기반 section 분할) |
| MDN / VueUse 문서 | Navigation Cluster (sidebar) + Authored Block (content) |
| HN 개별 글 | Authored Block (story) + Repeated Item nested (comment list) |
| HN 프론트페이지 | Repeated Item flat (story list) |
| Wikipedia | Navigation Cluster (TOC sidebar) + Authored Block (article) |

시각적 하이라이트로 인식된 region의 경계와 primitive 타입이 화면에 표시된다.
단축키(Alt+Shift+S)로 캡처한 snapshot이 유의미한 구조를 포함한다.

---

## 5. Sprint 4B — 직접 DOM 패턴 매칭

> 라이브러리가 커버하지 못하는 영역. 4A 완료 후 진행.
> 완료하면 SaaS, e-commerce, 검색 결과까지 커버.

### 4B 스코프

| 항목 | 내용 |
|------|------|
| RepeatedItemRecognizer (div 기반) | DOM sibling 패턴 매칭 |
| InteractiveBlockRecognizer | form/input/label/button DOM 탐지 |
| 컴포넌트 경계 인식 | 구조적 자족성 + 보조 signal |
| Region 중복/포함 관계 정교화 | 4A의 단순 해소를 고도화 |

### 5.1 RepeatedItemRecognizer 확장 (div 기반 반복)

4A에서는 AST의 ListNode/TableNode만 잡았다. 현대 웹의 카드 레이아웃, 그리드 피드는 `<div>` 기반이라 AST에서 안 보인다. DOM 레벨에서 직접 탐지해야 한다.

```
탐지 알고리즘:

1. DOM tree를 순회하며 각 parent element의 children을 검사
2. children 간 "구조 유사도" 계산:
   - signature = tagName + className 조합 (CSS module hash는 정규화)
   - 또는: children의 subtree depth + child count + tagName 시퀀스
3. 동일 signature의 sibling이 3개 이상이면 → Repeated Item 후보
4. 후보의 내부에 다시 반복이 있으면 → nested

성능 제약:
  - DOM tree 전체를 순회하지만, depth 2까지만 children 비교 (O(n) 유지)
  - parent당 children이 50개 이상이면 sampling (처음 10개 + 마지막 5개로 패턴 판별)

예시:
  <div class="feed">           ← parent
    <div class="card sc-a1b2"> ← child 1 (signature: div.card)
    <div class="card sc-a1b2"> ← child 2 (signature: div.card)
    <div class="card sc-a1b2"> ← child 3 (signature: div.card)
  → "div.card" 패턴이 3회 반복 → Repeated Item (flat)
```

overrideElementProcessing 훅을 활용하면 AST 변환 과정에서도 이 탐지를 삽입할 수 있다:

```ts
overrideElementProcessing: (el, options, indent) => {
  if (isRepeatedItemContainer(el)) {
    return el.children.map(child => processAsRepeatedItem(child))
  }
  return undefined
}
```

### 5.2 InteractiveBlockRecognizer

라이브러리 범위 밖이지만 HTML form semantics가 이미 풍부하다.

```
탐지:

강한 signal (단독 판별):
  - <form> 요소
  - role="form", role="search"

중간 signal (밀집도 기반):
  - 특정 subtree 내 <input>, <select>, <textarea>, <button> 비율
  - 해당 요소가 3개 이상 + 전체 children의 50% 이상이면 Interactive Block

추출:
  1. <label>과 <input>의 for/id 매핑으로 label-input 쌍 구성
     - for/id가 없으면 DOM proximity로 추론 (label 직후의 input)
  2. 각 input의 type, placeholder, required, disabled, name 수집
  3. <select>의 <option> 목록 수집
  4. <button>의 textContent + type(submit/reset/button) 수집
  5. aria-label, aria-describedby 수집

privacy filter (필수):
  - type="password" → value 제외
  - type="hidden" → value 제외
  - autocomplete="cc-number", "cc-exp", "cc-csc" → value 제외
  - name에 'ssn', 'social', 'secret', 'token' 포함 → value 제외

subtype:
  - 'form': 데이터 입력 폼 (<form> 내부)
  - 'search': 검색 폼 (role="search" 또는 type="search" input)
  - 'filter': 목록 필터 (Repeated Item region과 인접)
  - 'action': 독립 버튼 그룹 (form 없이 button만 모여 있는 경우)
```

### 5.3 컴포넌트 경계 인식

primitive가 "이 영역이 무슨 종류인가"를 판별한다면, 컴포넌트 경계는 "이 영역 안에서 의미 단위의 경계가 어디인가"를 판별한다.

```
탐지 signal (우선순위):

1. 반복 패턴 (이미 RepeatedItemRecognizer가 처리)
   → 각 반복 item = 하나의 컴포넌트

2. 구조적 자족성:
   subtree 내에 다음 중 2개 이상 있으면 독립 컴포넌트 후보
   - heading 또는 strong text (제목 역할)
   - body text (본문)
   - metadata (time, author, 수치)
   - image + text 조합
   - label + input 조합

3. data attribute 힌트:
   - data-testid, data-component, data-cy → 직접적 경계 signal
   - data-id, data-key → item 단위 signal

4. Framework 흔적 (보조):
   - React: data-reactroot, data-reactid
   - Vue: data-v-*
   - Svelte: class에 svelte- prefix
   - Web Components: shadow DOM boundary

5. 시각적 경계 (lazy — 트리거 시점에만):
   - getComputedStyle()로 background-color, border, box-shadow 변화 탐지
   - 부모와 다른 배경 + padding + border → 독립 시각 단위
   - skeleton 구축 시에는 skip (성능), expandRegion 시에만 실행
```

### 4B 완료 기준

4A 기준에 더해 다음이 추가로 작동한다:

| 사이트 | 기대 인식 |
|--------|----------|
| Amazon 검색 결과 | Repeated Item flat (상품 카드) + Interactive Block (filter) |
| GitHub dashboard | Navigation Cluster + Interactive Block (search) + Repeated Item (activity) |
| Google 검색 결과 | Repeated Item flat (결과 카드) + Interactive Block (search bar) |
| Notion 페이지 | Authored Block + Interactive Block (controls) |
| Twitter/X | Repeated Item flat (tweets, div 기반) |

---

## 6. Semantic IR 확장 (4B 시점)

### 6.1 InteractiveNode 추가

```ts
type InteractiveNode = {
  id: string
  type: 'input' | 'select' | 'button' | 'checkbox' | 'radio' | 'textarea'
  label?: string
  inputType?: string
  placeholder?: string
  value?: string              // privacy filter 적용됨
  required?: boolean
  disabled?: boolean
  options?: string[]           // select의 option 목록
  attributes?: Record<string, string>
}
```

### 6.2 SemanticCategory 확장

```ts
// 4B에서 추가
| 'interactive.form'
| 'interactive.search'
| 'interactive.filter'
| 'interactive.action'
```

### 6.3 SemanticRegion nodes 확장

```ts
type SemanticRegion = {
  id: string
  kind: string
  category: SemanticCategory
  nodes: (ContentNode | CommentNode | InteractiveNode)[]  // InteractiveNode 추가
  structure?: {
    type: 'flat' | 'tree' | 'sequence'
    rootIds?: string[]
  }
}
```

### 6.4 Privacy Filter

```ts
const SENSITIVE_INPUT_TYPES = ['password', 'hidden']
const SENSITIVE_AUTOCOMPLETE = ['cc-number', 'cc-exp', 'cc-csc', 'cc-name']
const SENSITIVE_NAME_PATTERNS = /ssn|social|secret|token|password|credit/i

function sanitizeInteractiveNode(node: InteractiveNode): InteractiveNode {
  const isSensitive =
    SENSITIVE_INPUT_TYPES.includes(node.inputType ?? '') ||
    SENSITIVE_AUTOCOMPLETE.includes(node.attributes?.autocomplete ?? '') ||
    SENSITIVE_NAME_PATTERNS.test(node.attributes?.name ?? '')

  if (isSensitive) {
    return { ...node, value: undefined }
  }
  return node
}
```

---

## 7. 추출 파이프라인 (최종)

```
DOM
 ↓
Phase 1: Primitive Recognition
  ├─ AuthoredBlockRecognizer.detect()     ← readability + AST  [4A]
  ├─ NavigationClusterRecognizer.detect() ← AST SemanticHtmlNode [4A]
  ├─ RepeatedItemRecognizer.detect()      ← AST ListNode/TableNode [4A] + DOM sibling 매칭 [4B]
  └─ InteractiveBlockRecognizer.detect()  ← DOM form/input/label [4B]
  → RecognizedRegion[] (primitive 타입 + confidence + anchor)
 ↓
Phase 2: Semantic AST 변환
  각 RecognizedRegion의 DOM subtree
  → dom-to-semantic-markdown의 htmlToMarkdownAST()
  → SemanticMarkdownAST[]
  (Interactive Block은 AST skip → 직접 DOM 추출)
 ↓
Phase 3: IR 변환
  AST → Semantic IR (ContentNode, CommentNode, InteractiveNode)
  primitive 타입에 따라 적절한 IR node로 매핑
 ↓
Phase 4: Enhancement (optional, 후속 Sprint)
  SiteEnhancer.enhance()로 도메인 메타데이터 보강
 ↓
SemanticSkeleton + Lazy Region Extraction 준비 완료
```

---

## 8. Recognizer 인터페이스

```ts
interface PrimitiveRecognizer {
  readonly primitive: 'authored-block' | 'repeated-item' | 'navigation-cluster' | 'interactive-block'

  /** 이 primitive에 해당하는 region 탐지 */
  detect(root: Element): RecognizedRegion[]

  /** 탐지된 region의 내부를 Semantic IR로 변환 */
  extract(region: RecognizedRegion): SemanticRegion
}

type RecognizedRegion = {
  element: Element
  primitive: 'authored-block' | 'repeated-item' | 'navigation-cluster' | 'interactive-block'
  confidence: number          // 0-1
  signals: string[]           // 판별에 사용된 signal 설명
  subtype?: string            // 예: 'flat' | 'nested' | 'global' | 'local'
}
```

---

## 9. Site-Specific Enhancer (후속 Sprint)

generic 결과를 받아서 도메인 메타데이터만 보강하는 후처리 레이어.

```ts
interface SiteEnhancer {
  match(url: string): boolean
  enhance(snapshot: SemanticSnapshot): SemanticSnapshot
}
```

GenericSemanticExtractor가 주력이고, SiteEnhancer는 optional enhancement다. **generic 없이는 SiteEnhancer도 작동하지 않는다.**

---

## 10. 이 스프린트에서 하지 않는 것

- SiteEnhancer 구현 (HN, Reddit 메타데이터 보강)
- Side Panel UI 정교화
- Cross-page semantic graph
- AI integration
- 서드파티 plugin 시스템
