# Sprint 6 — Assembly, Layout Role, Normalization 파이프라인 확장

> 선행 문서: SPEC.md, CODEX_REQUIREMENTS.md, SPRINT_4.md, FE Semantic Scenario Report
> 선행 조건: Sprint 4A/4B 완료 (4개 Primitive Recognizer + GenericSemanticExtractor 작동)
> 목표: Detection 이후 빠진 3개 레이어를 추가하여 복합 페이지에서의 semantic 품질을 안정화한다.

---

## 1. 문제 정의

Sprint 4의 Detection은 "여기에 반복 구조가 있다", "여기에 article이 있다"를 잡는다. 하지만 시나리오 테스트 결과, Detection과 IR 사이에서 다음이 안 된다:

| 문제 | 예시 |
|------|------|
| raw 구조 → 실제 semantic unit 조립 안 됨 | HN title row + meta row가 따로 논다 |
| 페이지 내 역할 판별 안 됨 | docs landing에서 sidebar와 main이 구분 안 된다 |
| 구조 패턴별 의미 정규화 안 됨 | nested list가 discussion tree인지 TOC인지 모른다 |
| non-main 영역 억제 안 됨 | footer link cloud가 article과 동급으로 잡힌다 |
| 1933 LOC 단일 파일 | heuristic 충돌 추적 불가, 튜닝 비용 급증 |

핵심: "더 많은 페이지를 잡는 것"이 아니라, "잡힌 것을 올바르게 조립하고 우선순위를 매기는 것"이 이 스프린트의 문제다.

---

## 2. 파이프라인 확장

### 2.1 현재 (Sprint 4)

```
Detection → AST → IR
```

### 2.2 확장 (Sprint 6)

```
Phase 1: Detection (Sprint 4 — 변경 없음)
  4개 recognizer가 raw RecognizedRegion[]을 찾는다
  ↓
Phase 2: Assembly (신규)
  raw region 내부에서 실제 semantic unit을 조립한다
  ↓
Phase 3: Layout Role Assignment (신규)
  조립된 region들에 페이지 내 역할을 부여한다
  ↓
Phase 4: AST 변환 (변경 없음)
  dom-to-semantic-markdown으로 각 region 내부 구조화
  ↓
Phase 5: Normalization (신규)
  패턴 기반 후처리 정규화
  ↓
Phase 6: IR 변환 (변경 없음)
  AST + normalization 결과 → Semantic IR nodes
```

### 2.3 Lazy Expand 상태 보존 원칙

현재 runtime은 skeleton 단계에서 `SemanticRegionRef`만 저장하고, AST/IR은 `expandRegion()` 시점에 lazy하게 만든다.
그래서 Sprint 6의 신규 중간 결과도 expand 시점에 다시 찾아올 수 있어야 한다.

이번 스프린트 기본 원칙은 다음과 같다.

- `SemanticRegionRef`는 최소한으로 유지한다.
- `assembly`, `layout`, `normalization` 중간 결과는 `region.id` keyed `PipelineRegionState` side cache에 저장한다.

```ts
type PipelineRegionState = {
  assembled?: AssembledRegion
  layout?: RoledRegion
  normalized?: NormalizedMetadata
}
```

이유:
- 현재 lazy expand 구조를 유지할 수 있다.
- browser-runtime public contract를 과도하게 넓히지 않는다.
- observability와 동일한 keyed state를 재사용할 수 있다.

---

## 3. 구현 순서

리포트의 Option C → A → B를 따른다.

| 순서 | 항목 | 이유 |
|------|------|------|
| **6-1** | GenericSemanticExtractor 물리 분해 | 이후 모든 작업의 전제. 1933 LOC를 모듈로 나눈다. |
| **6-2** | Assembly pass 도입 | HN feed, card grid 품질이 가장 크게 올라간다. |
| **6-3** | Layout Role Assignment 도입 | docs landing, article 페이지의 main/sidebar 구분. |
| **6-4** | Normalization 도입 | discussion tree, article section, entity card 정규화. |
| **6-5** | Observability 도구 | corpus 기반 디버깅 환경 구축. |

---

## 4. Phase 2: Assembly

### 4.1 문제

Detection이 찾은 raw candidate는 DOM 구조 단위이지 semantic 단위가 아니다.

```
Detection이 보는 것:         실제 semantic unit:
  row 1 (title)         →     Story Item 1
  row 2 (metadata)      →       (title + meta + spacer)
  row 3 (spacer)        →
  row 4 (title)         →     Story Item 2
  row 5 (metadata)      →       (title + meta + spacer)
  row 6 (spacer)        →
```

### 4.2 인터페이스

```ts
interface ItemAssembler {
  /**
   * raw repeated candidates에서 semantic item을 조립한다.
   * Detection 결과를 받아서, 의미 있는 단위로 묶어 반환한다.
   */
  assemble(regions: RecognizedRegion[]): AssembledRegion[]
}

type AssembledRegion = RecognizedRegion & {
  /** 조립된 하위 item들 (repeated-item의 각 item) */
  items?: AssembledItem[]

  /** 함께 묶인 companion elements (paired rows 등) */
  companions?: Element[]
}

type AssembledItem = {
  element: Element
  companions: Element[]           // 이 item에 묶인 companion rows
  links?: {
    primary?: string              // 콘텐츠 URL (story URL, article link)
    discussion?: string           // 토론 URL (comment page, issue page)
  }
  metadata?: {
    title?: string
    author?: string
    timestamp?: string
    score?: string
    commentCount?: string
  }
}
```

### 4.3 Assembly 규칙

**규칙 1: Paired Row Merge**

같은 parent 아래 반복되는 row가 `[A, B, (spacer)]` 패턴이면, A+B를 하나의 item으로 묶는다.

판별 기준:
- A row의 link density가 높고 (제목 역할)
- B row의 text density가 높고 link가 적으며 (메타데이터 역할)
- 이 패턴이 3회 이상 반복된다

```
[title_row, meta_row, spacer, title_row, meta_row, spacer, ...]
  → [Item(title+meta), Item(title+meta), ...]
```

**규칙 2: Companion Metadata Attach**

반복 item 바로 뒤에 비반복 element가 붙어 있으면 companion으로 attach한다.

예: 각 comment 아래의 reply 버튼, vote 버튼.

**규칙 3: Link Role 분리**

조립된 item 내부의 link를 역할별로 분류한다:
- item의 대표 text block 또는 title과 결합된 link → `primary`
- metadata row, trailing meta cluster, reply/comment CTA에서 발견되는 link → `discussion`
- `comments`, `discuss`, `reply`, `item?id=`, `issue`, `discussion` 같은 URL/anchor text 패턴은 `discussion` 가중치로만 사용한다

주의:
- `same-origin` 여부는 보조 힌트로만 사용한다.
- docs/blog/product 사이트의 same-origin primary link를 discussion으로 오인하면 안 된다.
- 도메인 기준보다 item 내부 상대 위치, anchor text, URL pattern을 우선한다.

**규칙 4: Variant Tolerance**

반복 구조에서 일부 item이 variant(필드 누락)여도 item으로 인정한다.

예: HN의 jobs 항목은 comments/points가 없지만 여전히 하나의 story item이다. signature 유사도 70% 이상이면 같은 반복 단위로 인정.

---

## 5. Phase 3: Layout Role Assignment

### 5.1 문제

조립된 region들이 페이지 안에서 "main인지 sidebar인지 footer인지"를 모른다. 같은 Navigation Cluster라도 global nav vs sidebar TOC vs footer links는 중요도와 처리가 전혀 다르다.

### 5.2 인터페이스

```ts
type LayoutRole =
  | 'main-content'          // 주요 콘텐츠 (article body, discussion thread)
  | 'sidebar'               // 보조 네비게이션 또는 관련 콘텐츠
  | 'global-nav'            // 사이트 전체 네비게이션 (header)
  | 'section-nav'           // 현재 섹션 네비게이션 (docs sidebar)
  | 'footer-resources'      // footer의 링크/정보
  | 'hero'                  // 히어로 섹션 / 상단 프로모션
  | 'search-bar'            // 검색 UI
  | 'utility'               // 기능적이지만 의미적으로 부가적 (theme toggle 등)

interface LayoutRoleAssigner {
  assign(regions: AssembledRegion[], document: Document): RoledRegion[]
}

type RoledRegion = AssembledRegion & {
  layoutRole: LayoutRole
  dominanceScore: number      // 0-1, main-content 판별용
  roleRank: 'primary' | 'supporting' | 'peripheral'
  suppressed: boolean         // derived: autoSuppressed || !explicitSelectionAllowed
  autoSuppressed: boolean
  explicitSelectionAllowed: boolean
}
```

### 5.3 Layout Role 판별 규칙

**규칙 1: Position-based 역할 추론**

```
DOM 위치 → 역할 추론:

document.body 최상위 children 기준:
  - 첫 번째 region이 nav이면 → 'global-nav'
  - 마지막 region이 nav이면 → 'footer-resources'

CSS layout 기준 (getComputedStyle — lazy):
  - position: fixed/sticky + 상단 → 'global-nav'
  - position: fixed/sticky + 측면 → 'sidebar'
  - display: flex/grid의 aside 역할 child → 'sidebar'
```

**규칙 2: Main-Content Dominance Scoring**

각 region에 dominance score를 매긴다:

```ts
function dominanceScore(region: AssembledRegion): number {
  let score = 0

  // text content 비율 (전체 페이지 대비)
  score += textRatio(region) * 0.4

  // viewport 면적 비율
  score += areaRatio(region) * 0.2

  // primitive 가중치
  if (region.primitive === 'authored-block') score += 0.2
  if (region.primitive === 'repeated-item' && region.subtype === 'nested') score += 0.15

  // semantic HTML 가중치
  if (isInsideMain(region.element)) score += 0.15
  if (isInsideArticle(region.element)) score += 0.1

  return Math.min(score, 1.0)
}
```

dominance score는 single winner를 강제하기 위한 값이 아니라 역할 우선순위를 정하기 위한 값이다.

- 가장 높은 score를 가진 핵심 region은 `layoutRole = 'main-content'`, `roleRank = 'primary'`
- strong secondary region은 `roleRank = 'supporting'`
- footer/nav/utility는 `roleRank = 'peripheral'`

즉, `main-content`는 하나일 수 있지만 supporting region은 여러 개일 수 있다.

예:
- HN item page: discussion tree = primary main, story header = supporting
- docs landing: main docs content = primary main, sidebar nav = supporting
- article page: article body = primary main, search/nav = peripheral

**규칙 3: Utility Suppression**

다음 조건에 해당하는 region은 `suppressed: true`로 마킹한다:
- `layoutRole === 'utility'`
- `layoutRole === 'footer-resources'`이면서 link만 잔뜩 있는 경우
- text content가 전체 페이지의 3% 미만인 navigation region

suppressed region은 skeleton에는 포함하되, **auto-generated context slice에서는 제외**된다. 하이라이트에서는 흐리게 표시한다.

단, suppression은 두 단계로 나눈다:

1. `autoSuppressed`
   - auto focus resolution
   - automatic context expansion
   - default ranking
   에서 제외된다.

2. `explicitSelectionAllowed`
   - 사용자가 semantic selection mode로 직접 클릭하면 선택 가능
   - explicit selection일 때는 snapshot/context에 포함할 수 있다

기본 정책:
- `footer-resources`, `utility`는 `autoSuppressed = true`
- `search-bar`, `section-nav`, `sidebar`는 `explicitSelectionAllowed = true`
- 사용자가 직접 고른 region은 suppression보다 selection intent가 우선한다

**규칙 4: Overlap Resolution**

한 element가 여러 region에 속할 때의 해소 정책:
- 구체적 primitive가 일반적 primitive를 이긴다 (interactive > navigation)
- 높은 confidence가 낮은 confidence를 이긴다
- 작은 region이 큰 region에 내포되면 parent-child 관계로 유지 (제거하지 않음)

---

## 6. Phase 5: Normalization

### 6.1 문제

Detection + Assembly + Layout Role로 "무엇이 어디에 있는지"는 알게 되었다. 하지만 같은 primitive라도 맥락에 따라 semantic 해석이 달라진다:
- nested repeated-item이 discussion tree인지 nested menu인지
- authored-block 안의 inline tags가 metadata인지 navigation인지
- flat repeated-item이 feed인지 card grid인지

### 6.2 인터페이스

```ts
interface SemanticNormalizer {
  /** 이 normalizer가 적용 가능한 region인지 판별 */
  canNormalize(region: RoledRegion): boolean

  /** region의 semantic metadata를 정규화하여 반환 */
  normalize(region: RoledRegion, ast: SemanticMarkdownAST[]): NormalizedMetadata
}

type NormalizedMetadata = {
  /** 정규화로 발견된 추가 semantic 정보 */
  threadInfo?: ThreadMetadata
  articleInfo?: ArticleMetadata
  cardInfo?: CardMetadata
}

type ThreadMetadata = {
  /** tree에서 collapsed된 branch가 있는지 */
  hasCollapsedBranches: boolean
  collapsedBranchIds: string[]

  /** explicit navigation hints (parent, root, next 링크) */
  explicitHints: {
    parentLink?: string
    rootLink?: string
    nextLink?: string
  }[]

  /** reply affordance 존재 여부 */
  hasReplyAffordance: boolean
}

type ArticleMetadata = {
  /** heading 기반 section 구조 */
  sections: { level: number, title: string, nodeIds: string[] }[]

  /** inline tag/category chips */
  tags: string[]

  /** 본문에서 분리된 부가 navigation (related articles 등) */
  separatedNavigation: string[]
}

type CardMetadata = {
  /** card 내부 필드 위치 template */
  fieldTemplate: {
    title?: 'first-heading' | 'first-link' | 'first-strong'
    image?: 'first-image' | 'background'
    metadata?: 'after-title' | 'bottom'
    cta?: 'last-button' | 'last-link'
  }
}
```

### 6.3 구체적 Normalizer

**ThreadNormalizer**

적용 대상: `repeated-item`이면서 `subtype === 'nested'`이고 `layoutRole === 'main-content'`

```
수행하는 일:
1. collapsed branch 감지
   - "[n more]", "show more replies" 등의 텍스트 패턴
   - 또는: 동일 depth에서 갑자기 끊기는 subtree

2. explicit hint 읽기
   - 각 item 내부에서 "parent", "root", "prev", "next" 텍스트를 가진 link 탐지
   - 이 link들을 ThreadMetadata에 기록

3. reply affordance 감지
   - "reply" 텍스트를 가진 link 또는 button
   - 존재하면 hasReplyAffordance = true

4. branch root 계산 보정
   - indent fallback (DOM depth/margin-left) + explicit root/parent hint 조합
   - indent만으로 tree를 만들되, explicit hint가 있으면 override
```

**ArticleNormalizer**

적용 대상: `authored-block`이면서 `layoutRole === 'main-content'`

```
수행하는 일:
1. heading 기반 section 분할
   - AST의 HeadingNode 계층에서 section tree 구축
   - 각 section에 포함되는 ContentNode id 목록 매핑

2. inline tag/category 분리
   - article body 내부에서 tag chip 패턴 감지 (짧은 text + link의 반복)
   - tag로 판별되면 ArticleMetadata.tags에 기록하고 본문에서 분리

3. related navigation 분리
   - article body 말미에서 "Related posts", "See also" 등의 패턴
   - link 목록이면 separatedNavigation에 기록하고 본문에서 분리
```

**CardNormalizer**

적용 대상: `repeated-item`이면서 `subtype === 'flat'`이고 items가 3개 이상

```
수행하는 일:
1. 첫 3개 item의 내부 구조를 비교하여 field template 학습
   - 첫 번째 heading/link/strong → title 위치
   - 첫 번째 image → image 위치
   - time, 숫자, author 패턴 → metadata 위치
   - 마지막 button/link → CTA 위치

2. 학습된 template을 모든 item에 적용하여 field 추출 정규화
```

---

## 7. 물리 분해 계획 (6-1)

현재 `generic-semantic-extractor.ts` (1933 LOC)를 다음으로 분해한다:

```
src/core/
├── detection/
│   ├── AuthoredBlockRecognizer.ts
│   ├── NavigationClusterRecognizer.ts
│   ├── RepeatedItemRecognizer.ts
│   └── InteractiveBlockRecognizer.ts
│
├── assembly/
│   ├── ItemAssembler.ts              // Phase 2
│   ├── PairedRowMerger.ts            // 규칙 1
│   ├── CompanionAttacher.ts          // 규칙 2
│   └── LinkRoleClassifier.ts         // 규칙 3
│
├── layout/
│   ├── LayoutRoleAssigner.ts         // Phase 3
│   ├── DominanceScorer.ts            // main-content 판별
│   ├── UtilitySuppressor.ts          // non-main 억제
│   └── OverlapResolver.ts            // region 겹침 해소
│
├── normalization/
│   ├── ThreadNormalizer.ts           // Phase 5: discussion tree
│   ├── ArticleNormalizer.ts          // Phase 5: article sections
│   └── CardNormalizer.ts             // Phase 5: entity cards
│
├── pipeline/
│   └── SemanticPipeline.ts           // Phase 1-6 오케스트레이션
│
└── observability/
    ├── RegionDumper.ts               // region dump 도구
    └── PipelineLogger.ts             // confidence, decisions 기록
```

`SemanticPipeline.ts`가 전체 파이프라인의 오케스트레이터:

```ts
class SemanticPipeline {
  constructor(
    private recognizers: PrimitiveRecognizer[],
    private assembler: ItemAssembler,
    private layoutAssigner: LayoutRoleAssigner,
    private normalizers: SemanticNormalizer[],
    private astBuilder: SemanticASTBuilder,
    private pipelineState: Map<string, PipelineRegionState>,
  ) {}

  run(document: Document): SemanticSkeleton {
    // Phase 1: Detection
    const raw = this.recognizers.flatMap(r => r.detect(document.body))

    // Phase 2: Assembly
    const assembled = this.assembler.assemble(raw)

    // Phase 3: Layout Role
    const roled = this.layoutAssigner.assign(assembled, document)

    for (const region of roled) {
      this.pipelineState.set(region.id, {
        assembled: region,
        layout: region
      })
    }

    // Phase 4 + 5 + 6: expand 시점에 lazy 실행
    // skeleton은 roled regions의 ref만 들고 있음
    return this.buildSkeleton(roled)
  }

  expandRegion(region: SemanticRegionRef): SemanticRegion {
    const state = this.pipelineState.get(region.id)

    // Phase 4: AST
    const ast = this.astBuilder.build(region.anchor.deref()!)

    // Phase 5: Normalization
    const normalizer = state?.layout
      ? this.normalizers.find((n) => n.canNormalize(state.layout!))
      : undefined
    const normalized = state?.layout ? normalizer?.normalize(state.layout, ast) : undefined

    // Phase 6: IR
    return this.toSemanticRegion(region, ast, normalized, state)
  }
}
```

---

## 8. Observability (6-5)

### 8.1 Region Dumper

```ts
interface RegionDump {
  url: string
  timestamp: string
  regions: {
    id: string
    primitive: string
    subtype?: string
    layoutRole: LayoutRole
    dominanceScore: number
    roleRank: 'primary' | 'supporting' | 'peripheral'
    suppressed: boolean
    autoSuppressed: boolean
    explicitSelectionAllowed: boolean
    confidence: number
    signals: string[]
    nodeCount: number
    textLength: number
    boundingRect: DOMRect
  }[]
  decisions: {
    overlapResolutions: string[]    // "region A superseded region B: higher confidence"
    assemblyMerges: string[]        // "merged title row + meta row → story item"
    suppressions: string[]          // "suppressed footer-resources: text ratio 1.2%"
  }
}
```

### 8.2 활용

- 개발 시 `Alt+Shift+D`로 current page의 RegionDump를 콘솔에 출력
- corpus 기반 regression 테스트: 저장된 dump와 새 결과를 비교

---

## 9. 완료 기준

### 6-1 (물리 분해) 완료 기준
- `generic-semantic-extractor.ts`가 삭제되고 위 디렉토리 구조로 분해
- 기존 동작이 regression 없이 유지 (4A/4B 완료 기준 통과)

### 6-2 (Assembly) 완료 기준
- HN 프론트페이지: title+meta row가 하나의 story item으로 묶인다
- HN 프론트페이지: jobs variant가 item으로 인식된다
- card grid 사이트: 각 card가 독립 item으로 조립된다
- 조립된 item에서 primary link과 discussion link이 구분된다

### 6-3 (Layout Role) 완료 기준
- docs landing: sidebar가 'sidebar' 또는 'section-nav', main content가 'main-content'로 역할 부여
- article 페이지: footer link cloud가 'footer-resources'로 역할 부여되고 suppressed
- header search가 'search-bar'로 역할 부여
- dominance score 기반으로 primary/supporting/peripheral roleRank가 일관되게 부여
- supporting region이 context와 selection에서 main과 분리되어 유지

### 6-4 (Normalization) 완료 기준
- HN item 페이지: collapsed branch가 ThreadMetadata에 기록
- HN item 페이지: explicit parent/root link가 hint로 수집
- article 페이지: heading 기반 section 분할이 ArticleMetadata에 기록
- article 페이지: inline tag chips가 tags에 분리

### 6-5 (Observability) 완료 기준
- `Alt+Shift+D`로 RegionDump 콘솔 출력
- dump에 overlap resolution, assembly merge, suppression decision이 기록

---

## 10. 추가 정책 메모

### 10.1 Selection vs Suppression

selection intent는 suppression보다 우선한다.

- auto capture: suppressed region은 기본 제외 가능
- explicit semantic selection: suppressed region이어도 snapshot 생성 가능

즉 suppression은 "선택 불가"가 아니라 "자동 우선순위 낮춤"이다.

### 10.2 Main Region 단일화 금지

문서 어디에서도 "페이지에는 오직 하나의 의미 있는 region만 있다"는 전제를 두지 않는다.

- `primary main`
- `supporting`
- `peripheral`

의 3단 구조를 기본으로 본다.

---

## 10. 시나리오 리포트 발견 ↔ 해결 매핑

| 리포트 발견 | 해결 위치 |
|------------|----------|
| HN title+meta row 페어링 안 됨 | 6-2 Assembly: PairedRowMerger |
| HN collapsed branch, parent/root hint 없음 | 6-4 Normalization: ThreadNormalizer |
| article footer/nav 노이즈 | 6-3 Layout Role: UtilitySuppressor |
| docs landing 복합 페이지 역할 구분 안 됨 | 6-3 Layout Role: LayoutRoleAssigner |
| interactive cluster semantics 얕음 | 6-4 Normalization: 향후 ControlNormalizer |
| 1933 LOC 단일 파일 | 6-1 물리 분해 |
| heuristic 충돌 추적 불가 | 6-5 Observability: PipelineLogger |

---

## 11. 이 스프린트에서 하지 않는 것

- SiteEnhancer 구현 (여전히 후속)
- ControlNormalizer (interactive cluster 고도화 — 향후)
- Cross-page semantic graph
- AI integration
- 서드파티 plugin 시스템
- Side Panel UI 정교화
