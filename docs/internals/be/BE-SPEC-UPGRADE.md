# ThreadAtlas Backend Spec

## Upgrade Target Index

Version: 0.2+
Status: Draft
Companion:
- [BE-SPEC.md](./BE-SPEC.md)
- [BE-SPEC-CONTEXT.md](./BE-SPEC-CONTEXT.md)
- [BE-SPEC-PLANNER.md](./BE-SPEC-PLANNER.md)
- [BE-SPEC-PROTOCOL.md](./BE-SPEC-PROTOCOL.md)
- [BE-SPEC-MEMORY.md](./BE-SPEC-MEMORY.md)
- [BE-SPEC-INGEST.md](./BE-SPEC-INGEST.md)
- [BE-SPEC-INFRA.md](./BE-SPEC-INFRA.md)
- [BE-SPEC-HACKATHON.md](./BE-SPEC-HACKATHON.md)

---

## 1. Purpose

본 문서는 해커톤 이후 업그레이드 spec 세트를 묶는 인덱스 문서다.

현재 상세 spec은 이미 다음 문서들에 존재한다.

- runtime overview: [BE-SPEC.md](./BE-SPEC.md)
- context / normalization: [BE-SPEC-CONTEXT.md](./BE-SPEC-CONTEXT.md)
- planner / retrieval / relation: [BE-SPEC-PLANNER.md](./BE-SPEC-PLANNER.md)
- protocol: [BE-SPEC-PROTOCOL.md](./BE-SPEC-PROTOCOL.md)
- memory: [BE-SPEC-MEMORY.md](./BE-SPEC-MEMORY.md)
- analyze / ingest: [BE-SPEC-INGEST.md](./BE-SPEC-INGEST.md)
- infra: [BE-SPEC-INFRA.md](./BE-SPEC-INFRA.md)

이 문서는 그 spec들이 어떤 업그레이드 목표를 향하는지 요약한다.

---

## 2. Upgrade Scope

업그레이드 spec의 핵심 범위:

1. sidepanel workspace 중심 session
2. multi-tab context model
3. cross-tab retrieval
4. richer `memory-link` policy
5. broader visual / hybrid retrieval
6. stronger infra hardening

---

## 3. Spec Mapping

| 영역 | 해커톤 spec | 업그레이드 spec |
| --- | --- | --- |
| runtime overview | [BE-SPEC-HACKATHON.md](./BE-SPEC-HACKATHON.md) | [BE-SPEC.md](./BE-SPEC.md) |
| context model | 축소 적용 | [BE-SPEC-CONTEXT.md](./BE-SPEC-CONTEXT.md) |
| planner | current-page first | [BE-SPEC-PLANNER.md](./BE-SPEC-PLANNER.md) |
| protocol | minimal WS event set | [BE-SPEC-PROTOCOL.md](./BE-SPEC-PROTOCOL.md) |
| memory | hint 중심 | [BE-SPEC-MEMORY.md](./BE-SPEC-MEMORY.md) |
| ingest | optional/lightweight | [BE-SPEC-INGEST.md](./BE-SPEC-INGEST.md) |
| infra | single-instance friendly | [BE-SPEC-INFRA.md](./BE-SPEC-INFRA.md) + later upgrades |

---

## 4. Main Differences from Hackathon

### 4.1 Session

- 해커톤: `single-primary-tab session`
- 업그레이드: `sidepanel workspace session`

### 4.2 Retrieval

- 해커톤: current-page retrieval
- 업그레이드: primary tab + referenced tabs + long-term memory

### 4.3 Memory

- 해커톤: hint-first
- 업그레이드: recall/comparison 중심의 richer memory-link policy

### 4.4 Visual

- 해커톤: current-page selected scenario
- 업그레이드: current/past visual recall and comparison

### 4.5 Infra

- 해커톤: single-instance friendly
- 업그레이드: distributed state, optional Redis/tasks/storage

---

## 5. Practical Rule

현재 구현 우선순위는 [BE-SPEC-HACKATHON.md](./BE-SPEC-HACKATHON.md)를 따른다.

해커톤 이후 확장 설계와 detailed target behavior는 본 문서가 가리키는 full spec 세트를 따른다.

