# Codex 구현 요구사항 — LLM Context Pack Sprint

> 이 문서는 FE-SPEC.md, FE-SPRINT-2.md 다음 단계의 구현 스프린트 정의서다.
> 이번 스프린트의 목표는 `SemanticSnapshot`을 LLM 친화적인 중간 IR로 정규화하고, 그 위에서 모델별/작업별 projection을 안정적으로 생성하는 것이다.

---

## 핵심 결론

이번 스프린트에서 도입할 구조는 다음 3단이다.

```text
SemanticSnapshot (SoT)
  -> ContextPack (canonical derived IR)
  -> Projection (compact JSON / linear text / provider input)
```

중요한 원칙:

1. **SemanticSnapshot은 계속 SoT다.**
   - 브라우저에서 추출한 사실의 기준은 snapshot 하나뿐이다.
   - LLM을 위한 구조화는 snapshot을 바꾸는 것이 아니라 snapshot으로부터 파생된다.

2. **ContextPack은 두 번째 SoT가 아니다.**
   - 저장/동기화/캐시 기준은 여전히 snapshot이다.
   - ContextPack은 task-agnostic, model-agnostic derived view다.

3. **Projection은 ContextPack에서만 만든다.**
   - snapshot에서 prompt/string/JSON을 직접 만들지 마라.
   - snapshot -> prompt 직접 경로는 금지한다.

4. **작업별 차이는 Projection 단계에서 처리한다.**
   - `branch-summary`, `reply-assist`, `claim-extraction`은 ContextPack을 재사용한다.
   - task profile 때문에 ContextPack 타입이 쪼개지면 안 된다.

---

## 왜 이 스프린트가 필요한가

현재 `SemanticSnapshot`은 추출/디버깅/저장에는 좋지만, LLM 소비에는 곧바로 쓰기 애매하다.

- field가 브라우저 추출 관점으로 되어 있다
- relation은 있지만, 모델이 읽기 좋은 순서/그룹으로 재정렬돼 있지 않다
- `compact JSON`, `linear text`, `provider input`을 만들 때 같은 정규화 규칙이 반복될 위험이 크다
- 현재 snapshot만으로는 `scope 밖에 무엇이 생략됐는지`를 안정적으로 설명하기 어렵다

이번 스프린트는 이를 해결하기 위해 **Snapshot SoT는 유지하면서**, 그 위에 **ContextPack IR**을 추가한다.

---

## 스프린트 목표

### In Scope

1. `SemanticSnapshot -> ContextPack` 순수 변환기 도입
2. snapshot에 필요한 additive coverage metadata 추가
3. `ContextPack -> compact JSON`, `ContextPack -> linear text` renderer 도입
4. HN thread의 `focus-branch`, GenericArticle의 `focus-section` 지원
5. Sidepanel에서 ContextPack과 projection을 디버그/복사할 수 있는 preview 추가
6. shared 타입과 테스트 정리

### Out of Scope

1. provider SDK 직접 호출 최적화
2. backend API wire contract 변경
3. Reddit용 ContextPack 최적화
4. multi-branch compare / thread diff
5. vector memory / long-term memory integration

---

## 현재 구조 위에서의 위치

이번 스프린트 후 구조는 다음과 같다.

```text
Content Extraction
  -> SemanticSnapshot
  -> ContextPackBuilder
  -> ProjectionRenderers
  -> Sidepanel preview / copy / future LLM request payload
```

즉, extraction 레이어는 계속 `SemanticSnapshot`까지만 책임지고, LLM 소비 레이어는 `ContextPackBuilder`부터 시작한다.

---

## 데이터 모델 설계

### 1. SemanticSnapshot additive 변경

현재 snapshot SoT가 ContextPack을 안정적으로 파생하려면, 다음 coverage metadata를 추가해야 한다.

```ts
type SemanticSnapshotMeta = {
  capturedAt: string
  skeletonVersion: number
  extractorId: string
  coverage: {
    kind: "focus-branch" | "focus-section"
    rootNodeId: string
    capturedNodeCount: number
    omittedNodeCount: number
    omittedRootCount: number
  }
}
```

규칙:

- `capturedNodeCount`는 `focus + context`로 snapshot에 실제 포함된 node 수다.
- `omittedNodeCount`는 same semantic tree 또는 same section universe 안에서 snapshot에 포함되지 않은 node 수다.
- `omittedRootCount`는 focus scope 바깥의 sibling root/thread/section count다.
- 이 값은 snapshot 생성 시점에만 계산한다. ContextPack builder가 다시 DOM을 보러 가면 안 된다.

### 2. ContextPack canonical IR

새 shared 타입을 도입한다.

```ts
type ContextPackScopeKind = "focus-branch" | "focus-section"

type ContextPackNode = {
  id: string
  kind: "comment" | "content"
  relation: "focus" | "ancestor" | "descendant" | "sibling" | "container"
  distance: number
  text: string
  author?: string
  timestamp?: string
  depth?: number
  contentType?: "paragraph" | "heading" | "quote" | "code" | "list" | "image" | "metadata" | "link"
  level?: number
  parentId?: string
  metadata?: Record<string, string>
}

type ContextPack = {
  version: 1
  scope: {
    kind: ContextPackScopeKind
    rootNodeId: string
    focusNodeId: string
  }
  page: {
    id: string
    url: string
    title?: string
    kind: "article" | "thread" | "post" | "generic"
    metadata?: Record<string, string>
  }
  focus: ContextPackNode
  groups: {
    ancestors: ContextPackNode[]
    descendants: ContextPackNode[]
    siblings: ContextPackNode[]
    containers: ContextPackNode[]
  }
  omitted: {
    nodeCount: number
    rootCount: number
    note: string
  }
  provenance: {
    extractorId: string
    capturedAt: string
    skeletonVersion: number
  }
}
```

제약:

- `ContextPack`은 flat grouped structure로 유지한다. nested tree를 기본 표현으로 쓰지 않는다.
- tree-like rendering이 필요하면 projection 단계에서 만든다.
- node text는 snapshot에 들어 있는 text 그대로 사용한다. ContextPack 단계에서 LLM 요약/압축을 해서는 안 된다.

### 3. Ordering 규칙

구현자가 임의로 정하지 않도록 ordering을 고정한다.

- `ancestors`: root -> nearest parent 순서
- `descendants`: pre-order 비슷한 순서가 아니라, snapshot에 들어온 original order 유지
- `siblings`: original order 유지
- `containers`: original order 유지
- `focus`: 항상 별도 top-level field

### 4. Thread vs Article scope 규칙

#### HN / Discussion pages

- `coverage.kind = "focus-branch"`
- `rootNodeId`는 현재 focus comment가 속한 top-level branch root다
- `ancestors`는 branch root부터 focus parent까지
- `descendants`는 focus node 아래 subtree 전체
- `siblings`는 focus와 같은 parent를 가진 direct sibling만
- `containers`는 discussion snapshot에서는 비운다

#### GenericArticle pages

- `coverage.kind = "focus-section"`
- `rootNodeId`는 현재 focus block이 속한 nearest heading section root다
- `ancestors`는 section heading chain
- `descendants`는 same section 안의 following child blocks
- `siblings`는 same section 안의 peer blocks
- `containers`는 article title / byline / site metadata만 허용

---

## Projection 설계

이번 스프린트에서는 projection을 3종으로 제한한다.

```ts
type ContextProjectionFormat =
  | "context-pack-json"
  | "compact-json"
  | "linear-text"

type ContextTaskProfile =
  | "branch-summary"
  | "reply-assist"
  | "claim-extraction"
```

### 1. `context-pack-json`

- raw `ContextPack` 그대로 serialize
- sidepanel debug, snapshot comparison, 테스트 golden 용도

### 2. `compact-json`

- LLM/tool friendly compact projection
- field pruning 규칙:
  - `page`: `title`, `url`, `kind`
  - `focus`: `id`, `text`, `author?`, `timestamp?`
  - `groups`: profile에 따라 필요한 group만
  - `omitted`: 항상 포함
  - `provenance`: `extractorId`, `capturedAt`

### 3. `linear-text`

- 사람이 읽기 좋고 모델 프롬프트에도 바로 넣기 좋은 projection
- 출력 형식:

```text
Page: ...
Scope: focus-branch | focus-section

Ancestors
- ...

Focus
- ...

Descendants
- ...

Siblings
- ...

Omitted
- ...
```

---

## Task Profile 규칙

Task profile은 ContextPack을 바꾸지 않고 projection에서만 적용한다.

### `branch-summary`

- 포함: `ancestors`, `focus`, `descendants`, `siblings`, `omitted`
- 제외: `containers` 기본 제외
- 목적: 현재 branch의 흐름과 결론 요약

### `reply-assist`

- 포함:
  - nearest parent 1개
  - focus
  - direct children만
  - direct siblings만
- 제외:
  - ancestors distance >= 2
  - descendants distance >= 2
  - containers
- 목적: 현재 comment에 답글 쓰기

### `claim-extraction`

- 포함: `ancestors`, `focus`, `descendants`
- 제외: `siblings`, `containers`
- 목적: 이 branch/section 내부 주장과 근거 추출

중요:

- task profile은 node text를 다시 생성하거나 줄이지 않는다.
- task profile은 **포함/제외/순서**만 제어한다.

---

## 구현 순서

### Phase A. Shared 타입 정의

파일 제안:

- `packages/shared/src/types/context-pack.ts`
- `packages/shared/src/utils/context-pack.ts`

필수 작업:

1. `ContextPack`, `ContextPackNode`, `ContextTaskProfile`, `ContextProjectionFormat` 정의
2. `SemanticSnapshot.meta.coverage` 타입 추가
3. `packages/shared/src/index.ts` export 추가

### Phase B. Snapshot coverage metadata 추가

필수 작업:

1. HN snapshot builder가 branch root, captured node 수, omitted node/root 수를 계산
2. GenericArticle snapshot builder가 section root, captured node 수, omitted node/root 수를 계산
3. snapshot 생성 시 `meta.coverage`를 채운다

원칙:

- coverage 계산은 DOM과 region cache를 활용해 snapshot capture 시점에 끝내야 한다
- ContextPack builder는 snapshot 바깥 사실을 조회하지 않는다

### Phase C. ContextPack builder 구현

필수 작업:

1. `buildContextPack(snapshot: SemanticSnapshot): ContextPack`
2. thread snapshot이면 `focus-branch` 규칙 적용
3. article snapshot이면 `focus-section` 규칙 적용
4. relation별 group 정렬 고정

규칙:

- 입력 snapshot이 coverage metadata를 안 가지면 builder는 실패가 아니라 best-effort pack을 만들고,
  `omitted.note = "Coverage metadata unavailable."`로 남긴다

### Phase D. Projection renderers 구현

필수 함수:

```ts
renderContextPack(pack: ContextPack): string
renderCompactJson(pack: ContextPack, profile: ContextTaskProfile): string
renderLinearText(pack: ContextPack, profile: ContextTaskProfile): string
```

규칙:

- compact JSON과 linear text는 동일한 profile 필터를 공유해야 한다
- profile별 포함/제외 규칙이 renderer마다 달라지면 안 된다
- 그래서 내부적으로 `selectProjectionView(pack, profile)` 공용 함수를 먼저 만든다

### Phase E. Sidepanel preview

이번 스프린트에서는 backend 호출보다 먼저 preview를 붙인다.

필수 작업:

1. sidepanel에 새 섹션 `LLM Context`
2. 탭 3개 제공
   - `Context Pack`
   - `Compact JSON`
   - `Linear Text`
3. profile selector 제공
   - `branch-summary`
   - `reply-assist`
   - `claim-extraction`
4. copy 버튼은 현재 탭 projection을 복사

원칙:

- semantic snapshot preview는 유지
- LLM Context는 snapshot 아래 병렬 뷰로 붙인다

---

## 테스트 요구사항

### Shared / Type

- `ContextPack` export 테스트
- `SemanticSnapshot.meta.coverage` 타입 계약 테스트
- projection format/profile union 테스트

### Builder

- HN top-level comment snapshot -> `focus-branch` pack
- HN nested comment snapshot -> ancestors/descendants/siblings 분리
- GenericArticle heading section snapshot -> `focus-section` pack
- coverage metadata가 없는 snapshot -> best-effort pack + note 경고

### Projection

- 같은 pack에서 `compact-json`과 `linear-text`가 profile별로 같은 node subset을 쓰는지
- `reply-assist`가 deep descendants를 제외하는지
- `claim-extraction`이 siblings를 제외하는지

### UI

- sidepanel profile 전환
- projection 탭 전환
- copy 버튼이 현재 탭 output을 복사하는지

---

## 완료 기준

이번 스프린트가 끝났다고 말하려면 다음이 모두 만족돼야 한다.

1. snapshot은 여전히 SoT이고, prompt/string 생성이 snapshot에서 직접 일어나지 않는다
2. `ContextPack`이 shared 타입으로 정의돼 있다
3. HN `focus-branch`, GenericArticle `focus-section`에서 pack 생성이 된다
4. `compact-json`, `linear-text` projection이 task profile 기반으로 동작한다
5. sidepanel에서 ContextPack과 projection을 직접 검증할 수 있다
6. `pnpm -w typecheck`, `pnpm -w test`, `pnpm -w build`가 통과한다

---

## 구현자에게 주는 주의사항

1. **SemanticSnapshot을 우회하지 마라.**
   - DOM/region/session에서 바로 prompt를 만들지 않는다.

2. **ContextPack은 canonical IR이다.**
   - task별 분기를 builder에 섞지 마라.

3. **Projection은 선택 규칙만 바꿔야 한다.**
   - projection 단계에서 텍스트 요약/압축/재서술을 해선 안 된다.

4. **coverage metadata는 snapshot에서 끝내라.**
   - ContextPack builder가 브라우저 상태를 다시 읽으면 SoT 경계가 무너진다.

5. **이번 스프린트는 FE 중심이다.**
   - backend contract 변경 없이도 sidepanel preview로 가치를 검증할 수 있어야 한다.
