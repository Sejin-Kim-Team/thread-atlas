# FE Session Handoff

> 작성 시점: 2026-03-06
> 목적: 외부 세션으로 작업을 옮길 때 현재 FE semantic runtime 상태를 빠르게 넘기기 위한 압축 문서

---

## 1. 현재 상태

ThreadAtlas FE는 `HN 전용 extractor` 중심 구조에서 벗어나, 지금은 **generic semantic pipeline** 중심으로 동작한다.

현재 semantic capture 경로:

```text
Detection
  -> Assembly
  -> Layout Role Assignment
  -> Normalization
  -> SemanticSnapshot
  -> ContextPack
  -> Projection
```

Sprint 기준으로는 다음까지 완료된 상태다.

- Sprint 2: FE-SPEC vertical slice
- Sprint 3: `SemanticSnapshot -> ContextPack -> Projection`
- Sprint 4: generic primitive engine hard cut
- Sprint 5: interactive primitive, div repeated items, HN enhancer
- Sprint 6: pipeline split, assembly, layout role, normalization, observability

현재는 **새 구조를 만드는 단계는 일단 마감**했고, 다음은 `Sprint 7 quality sprint`로 넘어가는 상태다.

---

## 2. 핵심 아키텍처

### 2.1 semantic engine

- [SemanticPipeline.ts](/Users/eggp/dev/workspace/eggp/thread-atlas/apps/extension/src/content/semantic/core/pipeline/SemanticPipeline.ts)
- [generic-semantic-extractor.ts](/Users/eggp/dev/workspace/eggp/thread-atlas/apps/extension/src/content/semantic/generic-semantic-extractor.ts)
- [session.ts](/Users/eggp/dev/workspace/eggp/thread-atlas/apps/extension/src/content/semantic/session.ts)

### 2.2 detection / assembly / layout / normalization

- [recognizers.ts](/Users/eggp/dev/workspace/eggp/thread-atlas/apps/extension/src/content/semantic/core/detection/recognizers.ts)
- [repeated-item-assembly.ts](/Users/eggp/dev/workspace/eggp/thread-atlas/apps/extension/src/content/semantic/core/assembly/repeated-item-assembly.ts)
- [layout-role.ts](/Users/eggp/dev/workspace/eggp/thread-atlas/apps/extension/src/content/semantic/core/layout/layout-role.ts)
- [normalization/index.ts](/Users/eggp/dev/workspace/eggp/thread-atlas/apps/extension/src/content/semantic/core/normalization/index.ts)

### 2.3 observability

- [PipelineLogger.ts](/Users/eggp/dev/workspace/eggp/thread-atlas/apps/extension/src/content/semantic/core/observability/PipelineLogger.ts)
- [RegionDumper.ts](/Users/eggp/dev/workspace/eggp/thread-atlas/apps/extension/src/content/semantic/core/observability/RegionDumper.ts)

### 2.4 selection / highlight / capture

- [content-semantic.ts](/Users/eggp/dev/workspace/eggp/thread-atlas/apps/extension/src/content/content-semantic.ts)
- [TriggerManager.ts](/Users/eggp/dev/workspace/eggp/thread-atlas/apps/extension/src/content/capture/TriggerManager.ts)
- [BrowserCapture.ts](/Users/eggp/dev/workspace/eggp/thread-atlas/apps/extension/src/content/capture/BrowserCapture.ts)
- [RegionHighlighter.ts](/Users/eggp/dev/workspace/eggp/thread-atlas/apps/extension/src/content/overlay/RegionHighlighter.ts)
- [SnapshotIndicator.ts](/Users/eggp/dev/workspace/eggp/thread-atlas/apps/extension/src/content/overlay/SnapshotIndicator.ts)

### 2.5 sidepanel / LLM context

- [index.ts](/Users/eggp/dev/workspace/eggp/thread-atlas/apps/extension/src/sidepanel/index.ts)
- [ui.ts](/Users/eggp/dev/workspace/eggp/thread-atlas/apps/extension/src/sidepanel/ui.ts)
- [context-pack.ts](/Users/eggp/dev/workspace/eggp/thread-atlas/packages/shared/src/utils/context-pack.ts)

---

## 3. shared boundary 상태

shared는 hard cut으로 다음처럼 분리돼 있다.

- root / domain-safe surface
- runtime subpath
- browser-runtime subpath

기준 파일:

- [domain.ts](/Users/eggp/dev/workspace/eggp/thread-atlas/packages/shared/src/domain.ts)
- [runtime.ts](/Users/eggp/dev/workspace/eggp/thread-atlas/packages/shared/src/runtime.ts)
- [browser-runtime.ts](/Users/eggp/dev/workspace/eggp/thread-atlas/packages/shared/src/browser-runtime.ts)

현재 원칙:

- backend와 고정할 수 있는 건 domain-safe schema만
- extension message / DOM runtime contract는 root public surface에 없음
- semantic node union은 `kind` discriminant 기반

---

## 4. 현재 작동하는 기능

### 4.1 capture / selection

- semantic selection mode로 node 클릭 선택 가능
- selected node 기준 snapshot 자동 갱신
- hover / selected / text selection / trigger target 우선순위 정리됨
- 페이지 이동 후 selection mode state rehydrate 됨

### 4.2 site coverage

- HN front page
- HN item page
- linked article / docs page
- flat/grid repeated card layout
- interactive search/form/filter/action cluster

### 4.3 normalization

- `ThreadNormalizer`
  - collapsed branch
  - explicit parent/root/next/prev hint
  - reply affordance
- `ArticleNormalizer`
  - heading 기반 section tree
  - tag chip 분리
  - related / see-also link cluster 분리
- `CardNormalizer`
  - title / image / metadata / CTA template 학습

### 4.4 observability

- `Alt+Shift+D`로 current page `RegionDump`를 콘솔에 출력
- dump에 다음이 포함된다
  - overlap / containment resolution
  - assembly merge decision
  - suppression decision
  - region별 role / rank / confidence / nodeCount / textLength / boundingRect

---

## 5. 현재 단축키

- `Alt+Shift+C`: Capture Semantic Snapshot
- `Alt+Shift+S`: Toggle Semantic Selection
- `Alt+Shift+D`: Dump current semantic pipeline state to console

기준 파일:

- [manifest.json](/Users/eggp/dev/workspace/eggp/thread-atlas/apps/extension/manifest.json)

---

## 6. sidepanel 상태

sidepanel은 현재 다음을 지원한다.

- latest snapshot
- snapshot history
- semantic selection state
- selected node detail
- `LLM Context`
  - `Context Pack`
  - `Compact JSON`
  - `Linear Text`

현재 projection 정책:

- content/comment snapshot은 `branch-summary`, `reply-assist`, `claim-extraction`
- interactive snapshot은 `branch-summary`만 허용

---

## 7. 문서 상태

핵심 내부 문서:

- [FE-ARCHITECTURE.md](/Users/eggp/dev/workspace/eggp/thread-atlas/docs/internals/FE-ARCHITECTURE.md)
- [FE-SEMANTIC-SCENARIO-REPORT.md](/Users/eggp/dev/workspace/eggp/thread-atlas/docs/internals/FE-SEMANTIC-SCENARIO-REPORT.md)
- [FE-SPRINT-6.md](/Users/eggp/dev/workspace/eggp/thread-atlas/docs/internals/FE-SPRINT-6.md)
- [FE-SPRINT-7.md](/Users/eggp/dev/workspace/eggp/thread-atlas/docs/internals/FE-SPRINT-7.md)

Sprint 7 문서는 다음 작업을 `quality sprint`로 정의해 둔 상태다.

- corpus / regression harness
- repeated-item tuning
- interactive refinement
- docs/search enhancer expansion
- projection / UX tightening

---

## 8. 현재 테스트 / 빌드 상태

마지막 검증은 모두 통과한 상태다.

- `pnpm --filter @threadatlas/shared build`
- `pnpm --filter @threadatlas/api typecheck`
- `pnpm --filter @threadatlas/extension typecheck`
- `pnpm -w test`
- `pnpm -w build`

extension dist는 최신 상태다.

- [dist](/Users/eggp/dev/workspace/eggp/thread-atlas/apps/extension/dist)

관련 테스트:

- [semantic-session.test.ts](/Users/eggp/dev/workspace/eggp/thread-atlas/apps/extension/test/semantic-session.test.ts)
- [normalization.test.ts](/Users/eggp/dev/workspace/eggp/thread-atlas/apps/extension/test/normalization.test.ts)
- [observability.test.ts](/Users/eggp/dev/workspace/eggp/thread-atlas/apps/extension/test/observability.test.ts)

---

## 9. 다음 세션에서 바로 시작할 일

다음 세션의 시작점은 **Sprint 7의 7-1** 이다.

가장 자연스러운 순서:

1. corpus fixture / dump 저장 포맷 추가
2. dump diff / regression harness
3. repeated-item tuning
4. interactive refinement
5. docs/search enhancer 확장

즉 다음 세션의 핵심은 새 구조 설계가 아니라:

**“이미 있는 semantic pipeline을 실제 사이트 품질 기준으로 튜닝하고, regression 가능한 상태로 만드는 것”**

---

## 10. 외부 세션용 한 줄 요약

ThreadAtlas FE는 generic semantic pipeline(Sprint 6)까지 완료됐고, 현재는 Detection/Assembly/Layout/Normalization/Observability가 모두 들어간 상태다. 다음 작업은 Sprint 7의 corpus regression + heuristic tuning + enhancer coverage 확장부터 시작하면 된다.
