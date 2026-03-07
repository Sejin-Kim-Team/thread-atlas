# ThreadAtlas Backend PRD

## Upgrade Target

Version: 0.2+
Owner: Backend Team
Status: Draft
Companion:
- [BE-PRD.md](./BE-PRD.md)
- [BE-PRD-HACKATHON.md](./BE-PRD-HACKATHON.md)
- [BE-SPEC-UPGRADE.md](./BE-SPEC-UPGRADE.md)

---

## 1. Purpose

본 문서는 해커톤 제출 이후 확장할 backend 제품 방향을 요약한다.

현재 상세 업그레이드 PRD는 [BE-PRD.md](./BE-PRD.md)가 담당한다.
이 문서는 그 내용을 **해커톤 이후 업그레이드 축** 관점으로 다시 정리한다.

---

## 2. Upgrade Direction

해커톤 버전이 `current-page semantic assistant`라면,
업그레이드 버전은 다음으로 확장된다.

**Sessionful semantic workspace backend**

핵심 확장 축:

1. sidepanel workspace 중심 multi-tab session
2. cross-tab retrieval
3. memory-link orchestration
4. richer navigation / projection
5. broader visual / hybrid retrieval

---

## 3. Product Expansion Goals

업그레이드 이후 backend는 다음을 목표로 한다.

- 현재 primary tab뿐 아니라 referenced tab도 함께 reasoning
- 원문과 토론을 세션 안에서 연결
- “전에 본 것과 비슷한 사례”를 적극 recall
- cross-page relation을 설명
- 시각 자료 recall과 비교를 확장

---

## 4. Key Upgrade Themes

### 4.1 Sidepanel Session Workspace

- sidepanel은 preview console이 아니라 작업 공간이 된다
- 탭 전환은 session 전환이 아니라 context update가 된다

### 4.2 Cross-Tab Retrieval

- `CrossTabEdge` 기반으로 referenced tab을 retrieval scope에 넣는다
- thread/article compare가 핵심 시나리오가 된다

### 4.3 Memory Recall

- `memory-link`를 candidate에서 accepted로 승격하는 정책이 중요해진다
- recall이 보조 기능이 아니라 제품 핵심 가치 중 하나가 된다

### 4.4 Visual / Hybrid Expansion

- 현재 또는 과거에 본 시각 자료의 recall/comparison을 확장한다
- chart / diagram / UI region beyond current page를 다룬다

### 4.5 Infra Hardening

- distributed session state
- reconnect recovery
- optional Redis / async tasks / artifact storage

---

## 5. What Changes Relative to Hackathon

| 영역 | 해커톤 | 업그레이드 |
| --- | --- | --- |
| 세션 범위 | current page 중심 | sidepanel workspace 중심 |
| retrieval | current page first | primary tab + cross-tab + memory |
| memory | hint 수준 | 적극 recall / acceptance |
| visual | current-page selected scenario | broader visual recall / comparison |
| state | single-instance friendly | distributed-ready |

---

## 6. Canonical Reference

업그레이드 버전의 상세 PRD 기준은 [BE-PRD.md](./BE-PRD.md)다.

