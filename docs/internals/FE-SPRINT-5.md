# Sprint 5 — Interactive Primitive와 Enhancement Layer

> 선행 문서: FE-SPEC.md, FE-SPRINT-3.md, FE-SPRINT-4.md
> 목표: Sprint 4의 generic primitive engine을 실제 제품 커버리지 수준으로 끌어올린다.
> 구조: **5A (Interactive Primitive)** → **5B (div 기반 Repeated Item)** → **5C (Site Enhancer Layer)**

---

## 1. 스프린트 목표

Sprint 4에서 semantic capture path는 `PrimitiveRecognizer[] -> GenericSemanticExtractor` 구조로 절체됐다.

Sprint 5의 목표는 이 generic engine을 다음 3가지 방향으로 완성하는 것이다.

1. **Interactive Block을 실제 primitive로 승격**
2. **div 기반 반복 구조를 안정적으로 인식**
3. **generic extraction 위에 얇은 Site Enhancer 레이어 도입**

이 스프린트가 끝나면 semantic capture는 더 이상 article/list/nav 위주 데모가 아니라,
검색/쇼핑/SaaS/dashboard/form/documentation/discussion까지 커버 가능한 엔진이 된다.

---

## 2. 왜 Sprint 5가 별도 스프린트여야 하는가

Sprint 4의 hard cut은 extraction engine의 주도권을 generic primitive로 옮기는 데 초점이 있었다.
그 결과 semantic runtime은 단순해졌지만, 아직 실제 웹 커버리지에는 3개의 큰 공백이 남아 있다.

| 공백 | Sprint 4 상태 | Sprint 5 이유 |
|------|---------------|---------------|
| **Interactive UI** | 타입/스캐폴드만 존재 | 대다수 SaaS, 검색, 폼, 필터 UI는 interactive primitive 없이는 의미론이 비어 있음 |
| **div 기반 반복 구조** | list/table 중심 | 실제 피드, 카드 그리드, 검색 결과, dashboard row는 대부분 div 기반 |
| **site-specific quality lift** | pure generic only | generic만으로는 usable baseline은 되지만, 제품 품질에는 enhancer가 필요 |

즉 Sprint 5는 기능 추가가 아니라,
**generic engine을 production-grade coverage로 끌어올리는 스프린트**다.

---

## 3. Sprint 5의 핵심 질문

이번 스프린트는 아래 질문들에 답해야 한다.

1. 어떤 interactive DOM을 semantic primitive로 인정할 것인가?
2. div/card/grid 기반 반복 구조를 list/table처럼 어떻게 일반화할 것인가?
3. generic extractor를 훼손하지 않으면서 site-specific 품질 보정을 어디에 둘 것인가?
4. interactive primitive를 `SemanticSnapshot -> ContextPack -> Projection` 경로에 어떻게 태울 것인가?

---

## 4. Sprint 5 전체 구조

```text
DOM
  -> PrimitiveRecognizer[]
       - AuthoredBlockRecognizer
       - NavigationClusterRecognizer
       - RepeatedItemRecognizer
       - InteractiveBlockRecognizer
  -> GenericSemanticExtractor
  -> SiteEnhancer[]            // optional, additive only
  -> SemanticSnapshot
  -> ContextPack
  -> Projection
```

중요한 원칙:

1. `GenericSemanticExtractor`가 여전히 주력이다.
2. `SiteEnhancer`는 extraction을 대체하지 않는다. 오직 refine/add/rename만 한다.
3. `InteractiveNode`는 이제 snapshot에 실제로 들어간다.
4. selection/highlight는 region root가 아니라 **selectable item** 기준으로 유지한다.

---

## 5. 5A — InteractiveBlockRecognizer 실구현

### 5A-1. 목표

폼, 검색 박스, 필터 바, 정렬 컨트롤, 액션 영역을 semantic primitive로 인식한다.

### 5A-2. Primitive 정의

`interactive-block`은 다음 요소들의 의미 있는 묶음이다.

- `form`
- `search`
- `filter`
- `sort`
- `action-group`
- `toolbar`

이 primitive는 단일 input 하나가 아니라, **사용자 의도를 형성하는 control cluster**를 의미한다.

### 5A-3. 탐지 규칙

직접 DOM 패턴 매칭이 필요하다.

#### 강한 signal

- `form`
- `input`, `select`, `textarea`, `button`
- `[role="search"]`, `[role="searchbox"]`, `[role="button"]`, `[role="tablist"]`, `[role="toolbar"]`
- `fieldset`, `label`

#### 보조 signal

- placeholder 또는 accessible name에 `search`, `filter`, `sort`, `price`, `category`, `date`
- checkbox/radio cluster
- chip/toggle/button group
- 검색 결과 상단의 sort/filter strip

#### region 경계 규칙

- 서로 가깝고 같은 parent/fieldset/form 안에 있는 control은 같은 region으로 묶는다.
- unrelated control이 섞인 큰 container는 분할한다.
- modal/dialog 전체를 interactive region으로 잡지 말고, control cluster 수준에서 끊는다.

### 5A-4. InteractiveNode 설계

Interactive region 내부 node는 `InteractiveNode`로 표현한다.

```ts
type InteractiveNode = {
  id: string
  type: "interactive"
  controlType: "input" | "select" | "textarea" | "checkbox" | "radio" | "button" | "link-button" | "chip"
  label?: string
  role?: string
  action?: "search" | "filter" | "sort" | "submit" | "toggle" | "navigate" | "unknown"
  state?: "checked" | "unchecked" | "selected" | "expanded" | "collapsed" | "disabled"
  valuePreview?: string
  metadata?: Record<string, string>
}
```

### 5A-5. Privacy / Sanitization

interactive primitive는 개인정보 위험이 높으므로, raw DOM value를 그대로 넣지 않는다.

규칙:

- password, email, tel, credit card 추정 input은 항상 redacted
- token, API key, secret, session, auth 관련 name/id/input은 redacted
- text input은 최대 80자 preview만 허용
- textarea는 기본적으로 value 비포함
- hidden input은 무시
- file input은 파일명 비포함
- checkbox/radio/select는 현재 state만 노출

기본 sanitizer:

```text
raw DOM -> sanitizeInteractiveNode() -> InteractiveNode
```

### 5A-6. subtype 분류

| subtype | 조건 |
|---------|------|
| `search` | search role / searchbox / placeholder or label match |
| `filter` | checkbox/radio/select/chip cluster with narrowing semantics |
| `sort` | ordering keyword or single select/button cluster for ordering |
| `form` | multi-field submit flow |
| `action-group` | toolbar/button cluster |

---

## 6. 5B — div 기반 Repeated Item 인식

### 6B-1. 목표

`ListNode`, `TableNode` 없이도 반복되는 item/card/row/grid/tree를 안정적으로 인식한다.

### 6B-2. 왜 필요한가

현대 웹의 대부분은 semantic list/table을 쓰지 않는다.

- 검색 결과
- 쇼핑 카드 그리드
- SaaS dashboard rows
- docs sidebar trees
- feed cards
- comment rows

따라서 Sprint 4의 list/table 중심 recognizer는 coverage ceiling이 낮다.

### 6B-3. 탐지 원리

div 기반 repeated item은 다음 특징을 조합해 잡는다.

1. **Sibling repetition**
   - 같은 parent 아래 유사한 tag/class/child shape의 sibling이 3개 이상
2. **Layout regularity**
   - bounding box 크기/배치가 비슷
3. **Content signature similarity**
   - heading + metadata + link / avatar + text / label + value 패턴이 반복
4. **Depth variation**
   - indent/margin/padding/aria-level/data-depth로 nested tree 추정
5. **Action density**
   - 각 item에 비슷한 CTA/button/menu가 붙어 있으면 repeated structure 가능성 증가

### 6B-4. flat vs nested 판별

| subtype | 판별 규칙 |
|---------|-----------|
| `flat` | sibling item 간 depth 변화 없음 |
| `nested` | indent/aria-level/data-depth/child repeated group으로 parent-child 추정 가능 |
| `grid` | 2차원 배치지만 item signature가 반복됨 |

`grid`는 region subtype로 유지하되, snapshot coverage는 `focus-section`으로 처리한다.

### 6B-5. item scope 규칙

selection/highlight/snapshot은 region root가 아니라 **item root**를 기준으로 한다.

- `nested`면 focus item + branch scope
- `flat`/`grid`면 focus item + local section scope

### 6B-6. generic field extraction

item 내부에서 generic하게 뽑을 수 있는 최소 필드는 다음과 같다.

- primary text / heading
- secondary metadata
- primary link
- thumbnail/image
- action affordance 존재 여부

이 단계에서는 site-specific semantics를 추론하지 않는다.
예: `price`, `rating`, `author` 같은 라벨은 enhancer 전까지 generic metadata로만 둔다.

---

## 7. 5C — Site Enhancer Layer

### 7C-1. 목적

generic engine은 페이지 구조를 보편적으로 잡고,
enhancer는 특정 사이트/패턴에서 **품질을 올리는 얇은 후처리**만 담당한다.

### 7C-2. 금지선

Site Enhancer는 다음을 해서는 안 된다.

- region을 처음부터 새로 만들기
- generic recognizer를 우회하기
- page 전체를 selector 기반으로 다시 파싱하기
- snapshot format을 site마다 다르게 만들기

### 7C-3. 허용되는 역할

- region subtype refinement
- display label refinement
- metadata enrichment
- branch root 보정
- primitive conflict resolution 보조
- selection label 개선

### 7C-4. 인터페이스

```ts
type SiteEnhancer = {
  id: string
  match(url: URL, document: Document): boolean
  refineSkeleton?(input: SemanticSkeleton, ctx: EnhancerContext): SemanticSkeleton
  refineRegion?(input: SemanticRegion, ctx: EnhancerContext): SemanticRegion
  refineSelection?(input: SemanticSelectionTarget, ctx: EnhancerContext): SemanticSelectionTarget
}
```

### 7C-5. 초기 enhancer 후보

| enhancer | 목적 |
|----------|------|
| `HackerNewsEnhancer` | repeated-item nested discussion의 branch root/label 정교화 |
| `DocsEnhancer` | breadcrumb/pagination/article section label 개선 |
| `SearchEnhancer` | filter/sort/result-list subtype refinement |

Sprint 5에서는 enhancer framework와 `HackerNewsEnhancer` 1개만 목표로 한다.

---

## 8. Snapshot / Selection / ContextPack 변화

### 8.1 Selection state

selected target payload는 최소 다음 필드를 유지한다.

```ts
type SemanticSelectionTarget = {
  regionId: string
  primitive: SemanticPrimitive
  subtype?: string
  category: SemanticCategory
  nodeId?: string
  scopeRootId?: string
  displayLabel: string
  textPreview?: string
}
```

### 8.2 Coverage 정책

| primitive/subtype | coverage.kind |
|-------------------|---------------|
| repeated-item nested | `focus-branch` |
| repeated-item flat | `focus-section` |
| repeated-item grid | `focus-section` |
| authored-block | `focus-section` |
| navigation-cluster | `focus-section` |
| interactive-block | `focus-section` |

### 8.3 ContextPack interactive 정책

interactive snapshot도 기존 `SemanticSnapshot -> ContextPack -> Projection` 규칙을 유지한다.

단, projection 정책은 다음을 따른다.

- `branch-summary`: interactive에서는 `focus + sibling controls + container metadata`
- `reply-assist`: interactive primitive에는 기본 비권장. UI에서는 disabled 가능
- `claim-extraction`: interactive primitive에는 기본 비권장. UI에서는 disabled 가능

즉 Sprint 5에서는 interactive snapshot이 projection 가능한 상태까지만 보장하고,
task profile의 제품 정책은 보수적으로 유지한다.

### 8.4 Friendly label 정책

사용자-facing 라벨은 primitive raw name 대신 다음 식으로 보여준다.

| primitive/subtype | label 예시 |
|-------------------|-----------|
| repeated-item nested | `Thread branch`, `Comment`, `Reply` |
| repeated-item flat | `Feed item`, `Result item`, `List item` |
| repeated-item grid | `Card`, `Result card` |
| authored-block | `Article section`, `Post body` |
| navigation-cluster breadcrumb | `Breadcrumb` |
| navigation-cluster pagination | `Pagination` |
| interactive-block search | `Search` |
| interactive-block filter | `Filter controls` |
| interactive-block sort | `Sort controls` |
| interactive-block form | `Form` |

primitive/subtype/category는 debug UI에서만 추가 노출한다.

---

## 9. 구현 순서

### Phase 1. Shared contracts

1. `InteractiveNode` 실사용 필드 확정
2. `sanitizeInteractiveNode()` 정책 고정
3. `SiteEnhancer` 인터페이스 추가
4. `ContextPackNode.kind = "interactive"` 경로 점검

### Phase 2. Interactive recognizer

1. DOM control clustering
2. subtype classification
3. sanitization
4. snapshot/context selection integration

### Phase 3. div repeated item

1. sibling pattern matcher
2. signature similarity scoring
3. nested/flat/grid 판별
4. item root / branch root 계산

### Phase 4. Enhancer layer

1. enhancer orchestration 추가
2. HN enhancer 1차 구현
3. label / branch root / subtype refinement

### Phase 5. UI / Context / QA

1. sidepanel debug 정보 확장
2. interactive projection 정책 가드
3. selection/highlight regression QA

---

## 10. Acceptance Criteria

Sprint 5 완료 기준은 다음과 같다.

### Interactive

- search/filter/sort/form/action-group이 실제 region으로 잡힌다
- selection mode에서 개별 interactive cluster를 선택할 수 있다
- snapshot에 redacted interactive node가 들어간다
- 민감 정보가 raw text로 노출되지 않는다

### div Repeated Item

- semantic list/table이 아닌 feed/result/card/tree에서도 repeated-item이 잡힌다
- nested discussion/trees에서 item 기준 selection과 branch scope가 일관된다
- flat/grid 결과에서는 focus item 중심 section snapshot이 나온다

### Enhancer

- enhancer가 generic extraction을 대체하지 않고 refine만 한다
- HN enhancer 적용 시 branch label/selection 품질이 개선된다
- enhancer가 없는 사이트에서도 generic path가 정상 동작한다

### Context / UI

- interactive snapshot도 sidepanel에서 표시 가능하다
- `ContextPack` builder와 projection이 interactive node 포함 snapshot에서 깨지지 않는다
- selection/highlight/capture/history 흐름이 유지된다

---

## 11. 테스트 계획

### Shared / Contract

- `InteractiveNode`, `sanitizeInteractiveNode`, `SiteEnhancer` export
- `SemanticRegion.nodes` / `FocusResult.node` / `ContextPackNode.kind` widened union
- interactive category 확장

### Recognizer

- search bar detection
- filter chip / checkbox group detection
- sort select/button cluster detection
- multi-field form detection
- div list/card/grid repeated item detection
- nested repeated item tree detection
- false positive 억제 테스트

### Privacy

- password/email/token-like input redaction
- textarea omission
- hidden/file input omission
- long text input preview truncation

### Enhancer

- HN enhancer가 branch root와 display label을 refine하는지
- enhancer 미적용 사이트에서 generic output이 동일한지

### Runtime / UI

- interactive cluster hover / selection / capture
- repeated-item flat/grid/nested coverage 계산
- sidepanel friendly label + debug info 표시
- `LLM Context` projection guard

### Regression

- Sprint 4 authored/navigation/repeated-item(list/table) 경로 유지
- Sprint 3 ContextPack / projection 유지
- legacy `content-hn.ts` / `ThreadDoc` / voice path 유지
- `pnpm -w typecheck`
- `pnpm -w test`
- `pnpm -w build`

---

## 12. Out of Scope

이번 스프린트에서는 다음을 하지 않는다.

1. provider/backend LLM 호출 연결
2. Reddit 전용 enhancer 구현
3. cross-page workspace
4. sidepanel 전체 redesign
5. vector memory / semantic graph persistence
6. 완전한 component boundary inference

---

## 13. 최종 구조 요약

Sprint 5가 끝나면 Thread Atlas의 semantic 계층은 아래처럼 된다.

```text
Primitive Recognizers
  - authored-block
  - navigation-cluster
  - repeated-item (list/table/div)
  - interactive-block

GenericSemanticExtractor
  -> SiteEnhancer[]
  -> SemanticSnapshot
  -> ContextPack
  -> Projection
  -> Sidepanel / future LLM actions
```

Sprint 4가 “generic engine으로 절체”였다면,
Sprint 5는 그 generic engine을 **실제 웹 커버리지와 제품 품질 기준으로 완성**하는 스프린트다.
