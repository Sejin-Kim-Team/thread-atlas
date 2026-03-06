# Sprint 7 — Quality Tuning, Corpus Regression, Site Coverage

> 선행 문서: FE-ARCHITECTURE.md, FE-SEMANTIC-SCENARIO-REPORT.md, FE-SPRINT-6.md
> 선행 조건: Sprint 6 완료
> 목표: Sprint 6에서 완성된 generic semantic pipeline을 실제 웹 품질 기준으로 안정화한다.

---

## 1. 스프린트 목표

Sprint 6까지로 semantic runtime의 구조는 한 번 닫혔다.

현재 상태:

```text
Detection
  -> Assembly
  -> Layout Role
  -> Normalization
  -> SemanticSnapshot
  -> ContextPack
  -> Projection
```

이제 남은 일은 새 레이어를 더 만드는 것이 아니라,
이미 있는 레이어가 실제 웹에서 얼마나 안정적으로 작동하느냐를 끌어올리는 것이다.

Sprint 7의 핵심 질문은 4개다.

1. 지금 엔진이 어떤 페이지에서 얼마나 잘/못 동작하는가?
2. repeated-item, authored-block, interactive-block의 오탐/누락을 어떻게 줄일 것인가?
3. generic output 위에 어떤 enhancer를 추가하면 제품 품질이 가장 빨리 올라가는가?
4. interactive / search / docs / feed 류 페이지를 LLM Context까지 자연스럽게 연결하려면 무엇이 더 필요한가?

---

## 2. Sprint 7 전체 범위

Sprint 7은 다음 5개 작업으로 나눈다.

| 단계 | 항목 | 목적 |
|------|------|------|
| **7-1** | Corpus & Regression Harness | 실제 페이지/fixture 기반 품질 측정 |
| **7-2** | Repeated-Item Tuning | feed/card/tree precision 개선 |
| **7-3** | Interactive Refinement | form/search/filter/sort control 의미 안정화 |
| **7-4** | Site Enhancer Expansion | docs/search 품질 향상, Reddit 준비 |
| **7-5** | Projection & UX Policy Tightening | interactive/context 정책과 sidepanel 디버그 품질 정리 |

이 스프린트는 hard cut이 아니라 **quality sprint**다.
wire schema는 가능한 한 유지하고, 내부 heuristic / enhancer / corpus tooling 위주로 간다.

---

## 3. 왜 Sprint 7이 필요한가

지금 구조는 잘 작동하지만, 실제 사용 흐름에서 아직 이런 문제가 남아 있다.

| 현재 한계 | 예시 |
|-----------|------|
| repeated-item 과잉/누락 | article 내부 prose list를 card로 오인, virtualized list를 놓침 |
| interactive precision 부족 | search bar와 toolbar, filter strip, generic form을 가끔 같은 부류로 봄 |
| article normalization의 한계 | docs landing, blog index, reference page에서 related/tag/body 경계가 불안정 |
| enhancer coverage 부족 | HN는 어느 정도 보정되지만 docs/search/reddit 계열은 generic output 그대로 |
| dump는 있지만 corpus 비교가 없음 | heuristic 개선 전후를 체계적으로 비교하기 어렵다 |

즉 Sprint 7은 “기능 추가”보다 “품질 측정과 품질 향상” 스프린트다.

---

## 4. 7-1 — Corpus & Regression Harness

### 4.1 목표

Sprint 6의 `RegionDump`를 일회성 콘솔 출력에서 끝내지 않고,
fixture/corpus 기반 regression 도구로 승격한다.

### 4.2 구현 목표

다음을 추가한다.

- `scenario corpus` 디렉토리
- dump snapshot 저장 포맷
- dump compare 도구
- heuristic scorecard

예상 구조:

```text
docs/internals/corpus/
  hn-front/
  hn-item/
  docs-landing/
  article-page/
  search-grid/
  saas-table/

apps/extension/src/content/semantic/core/observability/
  RegionDumper.ts
  PipelineLogger.ts
  RegionDumpComparator.ts
  ScenarioScorecard.ts
```

### 4.3 최소 시나리오 세트

Sprint 7에서 기본적으로 커버할 시나리오는 다음이다.

- HN front page
- HN item page
- docs landing
- docs article/reference page
- blog article page
- search result grid
- SaaS dashboard row/table
- control-heavy filter/search page

### 4.4 비교 기준

dump를 다음 축으로 비교한다.

- primitive count
- layout role 분포
- suppressed region 수
- root/main/supporting/peripheral 분포
- normalized metadata 존재 여부
- selection target label 안정성

### 4.5 완료 기준

- dump를 fixture 파일로 저장할 수 있다
- 이전 dump와 새 dump를 비교하는 summary가 있다
- 최소 6개 scenario fixture가 저장된다
- heuristic 변경 전후 diff를 콘솔/테스트에서 확인할 수 있다

---

## 5. 7-2 — Repeated-Item Tuning

### 5.1 목표

`RepeatedItemRecognizer + Assembly + CardNormalizer + ThreadNormalizer`의 precision/recall을 높인다.

### 5.2 우선 튜닝 대상

#### A. Flat feed/card

- search result cards
- docs/blog index cards
- product grid
- dashboard summary cards

개선 포인트:
- same-origin primary link를 discussion으로 오인하지 않기
- short prose list를 card grid로 오인하지 않기
- missing metadata variant 허용
- CTA/button density 가중치 보정

#### B. Nested repeated item

- HN comment thread
- docs sidebar tree
- collapsible navigation tree

개선 포인트:
- discussion tree vs TOC tree 분리
- explicit hint 없는 nested tree에서 branch root 안정화
- collapsed subtree 추론 개선
- sibling/ancestor/descendant 계산 안정화

#### C. Virtualized / irregular lists

- React virtualized list
- uneven card layout
- masonry/grid

개선 포인트:
- bounding box regularity에 덜 의존
- sibling shape similarity와 content signature 비중 재조정

### 5.3 구현 후보

- `RepeatedItemConfidenceScorer`
- `TreeVsNavClassifier`
- `VariantTolerancePolicy`
- `VirtualListHeuristics`

### 5.4 완료 기준

- HN front/item precision regression 없음
- docs/search/card fixture precision 개선
- false positive fixture가 명시적으로 줄었다는 diff가 있다

---

## 6. 7-3 — Interactive Refinement

### 6.1 목표

interactive primitive를 “있다/없다” 수준에서 “무슨 control cluster인가” 수준으로 끌어올린다.

### 6.2 개선 대상

| subtype | 개선 포인트 |
|---------|-------------|
| `search` | header search / inline search / command palette 구분 |
| `filter` | checkbox chip group vs full filter panel 구분 |
| `sort` | sort dropdown / tab sort / segmented controls 구분 |
| `form` | multi-field form vs simple submit strip 구분 |
| `action-group` | toolbar/button cluster와 generic actions 분리 |

### 6.3 추가 작업

- interactive 전용 normalizer 도입 여부 검토
- control cluster 내부 parent/child semantics 정리
- dialog/modal 내부 interactive cluster 처리
- accessibility name 기반 subtype 강화

### 6.4 privacy / projection 정책

Sprint 5에서 도입한 sanitizer는 유지하되, projection 정책을 더 선명하게 한다.

정책:

- interactive snapshot은 기본적으로 `branch-summary`만 허용
- `reply-assist`, `claim-extraction`은 여전히 비활성
- sidepanel에는 disable reason이 명시적으로 보여야 한다

### 6.5 완료 기준

- search/filter/sort/form/action-group fixture가 구분된다
- control selection/highlight가 안정적이다
- sanitizer regression이 없다

---

## 7. 7-4 — Site Enhancer Expansion

### 7.1 목표

generic engine 위에 얇은 enhancer를 추가해 실제 제품 체감 품질을 높인다.

### 7.2 Sprint 7 enhancer 우선순위

1. `DocsEnhancer`
2. `SearchEnhancer`
3. `RedditEnhancer` 준비

### 7.3 DocsEnhancer

대상:

- docs landing
- guide/article
- API/reference

역할:

- sidebar TOC label refinement
- section root 보정
- article body vs reference metadata 분리
- breadcrumb / section-nav / related-links label 개선

### 7.4 SearchEnhancer

대상:

- 검색 결과 페이지
- docs search
- shopping/search-like grid

역할:

- result card label refinement
- filter/sort/search control naming
- primary result vs sponsored/auxiliary cluster 분리

### 7.5 RedditEnhancer 준비

Sprint 7에서 full Reddit 지원을 끝내는 것이 아니라,
generic repeated-item + enhancer로 처리 가능한지 검증하는 수준까지 간다.

준비 범위:

- scenario corpus
- comment/tree label 전략
- collapsed/hidden reply affordance 패턴 수집

### 7.6 완료 기준

- docs/search에서 generic-only보다 개선된 label/category/scope가 확인된다
- enhancer가 region 생성 자체를 대체하지 않는다는 원칙 유지
- Reddit는 최소 scenario report와 fixture가 생긴다

---

## 8. 7-5 — Projection & UX Policy Tightening

### 8.1 목표

semantic 품질 향상 결과를 sidepanel/selection/LLM Context UX에 더 잘 반영한다.

### 8.2 작업

- sidepanel debug 섹션 강화
  - primitive
  - subtype
  - layout role
  - role rank
  - normalized metadata summary
- selection card에 normalized scope 힌트 추가
- `ContextPack` projection에서 region quality 영향을 받는 그룹 정책 점검
- suppressed region을 선택했을 때 reason 표시

### 8.3 interactive/context 정책

다음 정책을 유지 또는 강화한다.

- content/comment 기반 projection이 기본
- interactive는 `branch-summary`만 허용
- sidepanel에서 profile disable reason 명시
- low-confidence peripheral region의 auto context는 최소화

### 8.4 완료 기준

- sidepanel에서 normalized/debug 정보를 확인할 수 있다
- selection mode와 dump 결과를 서로 대조하기 쉬워진다
- interactive projection 제한이 사용자에게 명확히 보인다

---

## 9. 구현 순서

Sprint 7의 구현 순서는 다음이 적절하다.

| 순서 | 항목 | 이유 |
|------|------|------|
| **7-1** | Corpus & Regression Harness | 이후 튜닝의 기준선 확보 |
| **7-2** | Repeated-Item Tuning | 가장 체감이 큰 precision 개선 |
| **7-3** | Interactive Refinement | control-heavy 페이지 품질 향상 |
| **7-4** | Docs/Search Enhancer | 제품 체감 품질 상승 |
| **7-5** | Projection & UX Tightening | 품질 향상을 사용자에게 드러냄 |

---

## 10. 이번 스프린트에서 하지 않을 것

다음은 Sprint 7 범위 밖이다.

- backend/provider 연동 변경
- semantic wire schema 변경
- cross-page workspace
- full Reddit semantic support 완료
- 새로운 primitive 추가
- Vite/CRX 빌드 체인 전환

---

## 11. 완료 기준

Sprint 7이 끝났다고 말하려면 최소한 다음이 만족되어야 한다.

- corpus fixture와 dump diff 기반 regression workflow가 생긴다
- repeated-item precision이 HN/docs/search fixture에서 개선된다
- interactive subtype 구분과 selection 품질이 더 안정적이다
- docs/search enhancer가 실제 품질 향상을 만든다
- sidepanel/debug/selection에서 normalized quality 정보를 확인할 수 있다

핵심은 이 스프린트가 “새 구조를 만드는 일”이 아니라,
**기존 구조를 제품 품질 수준으로 다듬는 일**이라는 점이다.
