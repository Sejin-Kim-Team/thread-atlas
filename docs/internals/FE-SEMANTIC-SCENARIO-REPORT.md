# FE Semantic Scenario Report

> 작성일: 2026-03-06
> 목적: 실제 브라우저 시나리오에서 현재 semantic runtime이 어떤 구조를 만나고, 어디서 약해지는지 정리한 뒤 다음 아키텍처 리팩터링 항목을 뽑는다.
> 방법: Playwright MCP로 실제 페이지를 열고 접근성 snapshot을 관찰했다.

---

## 1. Executive Summary

현재 semantic runtime은 생각보다 넓은 범위에서 이미 동작한다.

- HN front page에서는 `flat repeated-item`으로 story feed를 잡을 수 있다.
- HN item page에서는 `nested repeated-item`으로 discussion tree를 잡을 수 있다.
- 외부 article page에서는 `authored-block + navigation-cluster + interactive-block`을 동시에 인식할 수 있다.
- docs landing page에서는 `authored main + sidebar nav + card/grid repeated items + search/theme controls`가 한 화면에 공존하는 복합 레이아웃도 어느 정도 다룬다.

하지만 한 단계 더 밀어붙이려면, 지금 구조는 아직 "generic recognizer가 동작하는 상태"이지 "generic semantic model이 안정화된 상태"는 아니다.

핵심 문제는 세 가지다.

1. 페이지별 레이아웃 normalizer가 아직 부족하다.
2. detection, extraction, labeling, overlap resolution이 한 파일에 과도하게 섞여 있다.
3. repeated-item과 authored-block, navigation, interactive 사이의 경계 정책이 아직 거칠다.

---

## 2. Scenario Set

이번 관찰에 사용한 실제 페이지는 다음과 같다.

1. HN front page
   - `https://news.ycombinator.com/`
2. HN item page
   - `https://news.ycombinator.com/item?id=47263036`
3. HN item page, deeper nested branch example
   - `https://news.ycombinator.com/item?id=47269263`
4. Linked article page from HN
   - `https://jido.run/blog/jido-2-0-is-here`
5. Docs page reached from linked article
   - `https://jido.run/docs`

---

## 3. Scenario Observations

### 3.1 HN Front Page

관찰 구조:

- 상단 global nav
- story title row
- metadata row
- spacer row
- 이것이 반복되는 table-based feed
- `More` pagination
- footer nav + search input

의미론적 시사점:

- 이 페이지의 실제 semantic unit은 "한 줄"이 아니라 `title row + metadata row + optional spacer`의 묶음이다.
- 즉 반복 구조는 단순 sibling row repetition이 아니라 `paired repeated item`이다.
- jobs 항목처럼 comments/points가 없는 variant도 존재한다.

현재 엔진에 불리한 점:

- generic repeated-item이 row 단위로만 보면 title row와 meta row를 분리 인식할 수 있다.
- footer nav, header nav, `More` pagination, bottom search가 repeated-item과 섞일 수 있다.
- comment link가 item detail page entrypoint인데 현재는 item payload model이 story url과 comment url을 명시적으로 구분하지 않는다.

리팩터링 시사점:

- `flat repeated-item normalizer`가 필요하다.
- table/list/div repetition detection과 별개로 `paired item assembly` 단계가 있어야 한다.
- item-level wire shape에 `primaryLink`, `discussionLink`, `secondaryMeta`를 명시적으로 둘 가치가 크다.

### 3.2 HN Item Page

관찰 구조:

- story header
- story metadata
- story body
- add comment box
- 깊은 nested discussion tree
- 일부 branch는 `[n more]` collapsed state
- metadata 줄에서 `parent`, `root`, `prev`, `next`가 노출되는 경우가 있다

의미론적 시사점:

- HN discussion은 `indent width`만으로 해석하는 트리가 아니다.
- 실제 DOM/텍스트에는 `parent`, `root`, `next`, `[n more]` 같은 branch semantics가 추가로 존재한다.
- collapsed branch는 실질적으로 "부분적으로 보이는 tree"다.

현재 엔진에 불리한 점:

- discussion scope를 depth/parentId만으로 만들면 collapsed subtree와 visible subtree의 경계가 흐려질 수 있다.
- add-comment form이 story region과 discussion region 사이에 끼어 있어 scope pollution 가능성이 있다.
- story header와 첫 댓글 사이의 region boundary가 page마다 다를 수 있다.

리팩터링 시사점:

- nested repeated-item에 대해 `thread semantics adapter`가 필요하다.
- 이 adapter는 site-specific extractor가 아니라 recognizer 후처리 normalizer여야 한다.
- visible tree와 collapsed tree를 구분하는 `visibility/state metadata`가 있으면 좋다.
- branch root 계산은 `indent fallback + explicit root/parent hint` 조합으로 가는 게 맞다.

### 3.3 Linked Article Page

관찰 구조:

- 상단 global nav
- search / theme buttons
- article header
- tags
- longform prose
- headings
- code block
- footer with large link cloud

의미론적 시사점:

- main article는 비교적 명확하지만, footer link cloud와 header controls가 같은 page 안에 강하게 존재한다.
- authored-block이 제대로 잡혀도 navigation/footer suppression이 약하면 selection noise가 생긴다.
- code block, tag chips, inline links가 많아서 prose-only article로 가정하면 손실이 발생한다.

현재 엔진에 불리한 점:

- article main dominance를 계산하는 로직과 footer suppression이 충분히 분리돼 있지 않다.
- tags/link chips가 repeated-item이나 navigation-cluster로 과잉 분리될 가능성이 있다.
- search button은 interactive-block이지만, header nav cluster와 붙어 있어 overlap policy가 중요하다.

리팩터링 시사점:

- `main-content dominance scorer`가 필요하다.
- footer suppression과 utility-link suppression을 generic post-pass로 분리해야 한다.
- article node extraction과 `non-main region pruning`을 अलग도 단계로 나누는 편이 낫다.

### 3.4 Docs Landing Page

관찰 구조:

- top nav + search/theme controls
- secondary docs nav
- sidebar nav
- main docs content
- card/grid style section links
- package ecosystem cards
- footer link columns

의미론적 시사점:

- 이 페이지는 article도 아니고 pure navigation page도 아니다.
- 실제로는 `main docs landing authored-block + sidebar navigation + repeated cards + interactive controls`의 복합 페이지다.
- 현재 generic primitive engine이 가장 어려워하는 타입이다.

현재 엔진에 불리한 점:

- sidebar와 main content가 모두 semantically meaningful이다.
- docs cards는 `grid repeated-item`인데 authored-block section과 시각적으로 가까워 over-segmentation 가능성이 높다.
- header search는 interactive-block이지만 command palette trigger라는 점에서 일반 form/search bar와 다르다.

리팩터링 시사점:

- `layout role model`이 필요하다.
- 단순 primitive detection 이후에 `page composition graph`를 한 번 더 만들어야 한다.
- `sidebar nav`, `main content`, `promo cards`, `footer resources` 같은 layout role을 region metadata로 별도 보유하는 게 좋다.

---

## 4. Cross-Cutting Findings

### 4.1 Repeated Item은 아직 "structure"만 보고 있고 "assembly"를 충분히 못 본다

현재 repeated-item recognizer는 list/table/div repetition까지는 넓어졌지만, 실제 semantic unit을 조립하는 단계가 부족하다.

대표 예:

- HN front page의 title row + metadata row
- docs landing의 card grid
- article footer의 multi-column resource links

즉 다음 단계는 "detect repeated rows"가 아니라 "assemble semantic item"이다.

### 4.2 HN discussion은 generic engine으로 잡히지만 thread semantics normalizer가 더 필요하다

지금도 HN item page는 잘 잡힌다. 하지만 깊게 보면 discussion tree는 단순 nested list가 아니다.

- explicit `parent/root/next`
- collapsed branches
- reply affordance
- root-vs-parent distinction

이건 extractor 복귀가 아니라 `nested repeated-item semantic normalizer`로 처리하는 게 맞다.

### 4.3 Article extraction은 main-content dominance와 non-main suppression으로 더 분리해야 한다

현재 longform article page에서는 authored-block이 잡히지만, nav/footer/resources/search 영역을 충분히 분리하지 못하면 selection이 noisy해진다.

즉 article 쪽 핵심은:

- main detection
- utility region suppression
- secondary meaningful regions 유지

이 세 단계를 나눠야 한다.

### 4.4 Interactive recognizer는 존재하지만, "control cluster semantics"가 아직 얕다

현재는 search/filter/sort/form/action-group subtype 정도로 충분하다. 하지만 실제 페이지에서는 다음이 더 중요하다.

- command palette trigger
- collapsible sidebar controls
- tablists / chips / segmented controls
- result filter groups

즉 control leaf detection보다 cluster semantics가 다음 문제다.

### 4.5 현재 extractor 파일은 너무 크다

현재 hotspot:

- [generic-semantic-extractor.ts](/Users/eggp/dev/workspace/eggp/thread-atlas/apps/extension/src/content/semantic/generic-semantic-extractor.ts): 1933 LOC
- [context-slice.ts](/Users/eggp/dev/workspace/eggp/thread-atlas/apps/extension/src/content/semantic/context-slice.ts): 350 LOC
- [session.ts](/Users/eggp/dev/workspace/eggp/thread-atlas/apps/extension/src/content/semantic/session.ts): 240 LOC
- [RegionHighlighter.ts](/Users/eggp/dev/workspace/eggp/thread-atlas/apps/extension/src/content/overlay/RegionHighlighter.ts): 351 LOC

`GenericSemanticExtractor` 안에 다음이 같이 섞여 있다.

- recognizer detection
- DOM -> node extraction
- subtype labeling
- overlap resolution
- friendly label policy
- DOM annotation helper
- expansion logic

이 상태로 품질 튜닝을 계속하면 변경비용이 빠르게 올라간다.

---

## 5. Recommended Architecture Refactor List

### P0. Generic extractor를 recognizer별 파일로 분해

목표:

- `AuthoredBlockRecognizer`
- `NavigationClusterRecognizer`
- `RepeatedItemRecognizer`
- `InteractiveBlockRecognizer`
- `overlap-resolution`
- `label-policy`
- `dom-annotation`

으로 물리 분리한다.

이유:

- 지금은 한 파일에서 heuristic 충돌을 추적하기 너무 어렵다.
- repeated-item tuning이 article/nav에 side effect를 내기 쉽다.

### P0. Repeated Item에 "assembly pass" 도입

목표:

- raw repeated candidate detection 이후
- `semantic item assembler`가 실제 item payload를 조립하게 한다.

포함 규칙 예:

- paired rows merge
- metadata companion merge
- action affordance attach
- discussion link / primary link 분리

이유:

- HN front page와 card/grid 계열에서 가장 체감이 크다.

### P0. Nested discussion normalizer 도입

목표:

- generic `repeated-item:nested` 위에 `discussion normalizer`를 추가한다.
- 이 normalizer는 site-specific extractor가 아니라 nested thread semantics layer여야 한다.

포함 규칙 예:

- explicit `root/parent` 힌트 읽기
- collapsed branch 표시
- branch root 계산 보정
- reply affordance를 thread metadata로 유지

이유:

- HN item 품질을 올리면서 generic path를 유지할 수 있다.

### P1. Layout role graph 추가

목표:

- 각 region에 primitive 외에 `layoutRole`을 부여한다.

예:

- `main-content`
- `sidebar`
- `global-nav`
- `section-nav`
- `footer-resources`
- `hero-grid`

이유:

- docs landing 같은 복합 페이지에서 primitive만으로는 부족하다.
- selection/highlight/LLM projection 우선순위도 layout role이 있어야 더 자연스러워진다.

### P1. Main-content dominance scorer와 utility suppression 분리

목표:

- article/docs 페이지에서 main authored region을 잡는 단계와
- footer/search/utility/nav를 억제하는 단계를 분리한다.

이유:

- 지금은 authored-block 인식과 non-main pruning이 충분히 분리되지 않아 tuning이 어렵다.

### P1. Interactive cluster semantics 강화

목표:

- command palette trigger
- search trigger vs actual search form
- filter chips
- tablist
- segmented controls

를 별도 subtype 또는 action/state metadata로 다룬다.

이유:

- docs/search/product pages로 가면 interactive density가 급격히 올라간다.

### P2. Selection/highlight source model 분리

목표:

- `hover target`
- `selected item`
- `scope root`
- `coverage root`

를 UI/runtime state에서 더 명시적으로 분리한다.

이유:

- 지금도 동작은 하지만, complex pages에서 "무엇이 선택되었고 무엇이 같이 포함되는지"를 더 명확히 해야 한다.

### P2. Scenario corpus와 recognizer observability 추가

목표:

- 실제 페이지 corpus를 기준으로 recognized regions를 dump하는 도구 추가
- confidence, overlap decisions, chosen scope root, node counts를 기록

이유:

- 지금 단계부터는 heuristic tuning이 코드 reading보다 corpus-based debugging이 더 중요하다.

---

## 6. Suggested Refactor Order

다음 순서가 가장 안전하다.

1. `GenericSemanticExtractor` 물리 분해
2. repeated-item assembly pass 추가
3. nested discussion normalizer 추가
4. layout role graph 도입
5. main-content dominance + utility suppression 분리
6. interactive cluster semantics 확장
7. scenario corpus / observability 도구 추가

이 순서를 추천하는 이유는, 지금 가장 큰 가치가 HN thread와 linked article/docs 품질 개선인데 그 출발점이 모두 `repeated-item assembly`와 `layout role` 문제이기 때문이다.

---

## 7. Concrete Next Sprint Candidates

### Option A. Repeated Item Sprint

범위:

- repeated-item assembly pass
- HN feed pair merge
- nested discussion normalizer
- HN/docs scenario corpus

효과:

- HN 체감 품질이 가장 크게 오른다.

### Option B. Layout Role Sprint

범위:

- layout role graph
- main-content dominance scorer
- footer/nav suppression
- docs landing tuning

효과:

- article/docs 품질이 안정된다.

### Option C. Extractor Split Sprint

범위:

- `generic-semantic-extractor.ts` 분해
- recognizer/label-policy/overlap-resolution 모듈화
- observability 도구 추가

효과:

- 이후 튜닝 비용이 급격히 낮아진다.

실제로는 `Option C -> A -> B` 순서가 가장 건강하다.

---

## 8. Conclusion

현재 semantic runtime은 이미 "작동 여부" 단계는 넘었다. 이제 문제는 다음이다.

- 더 많은 페이지를 잡을 수 있느냐가 아니라
- 복합 페이지에서 어떤 semantic unit을 우선시할지
- generic path를 유지한 채 얼마나 안정적으로 조립할지

즉 다음 아키텍처 리팩터의 핵심은 extractor를 다시 site-specific하게 만드는 게 아니라:

1. `assembly`
2. `normalization`
3. `layout roles`
4. `observability`

를 generic engine 위에 정식 레이어로 올리는 것이다.
