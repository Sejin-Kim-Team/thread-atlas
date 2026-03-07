# ThreadAtlas Backend Spec

## Hackathon RAG Storage and Retrieval Schema

Version: 0.1-hackathon
Status: Draft
Companion:
- [BE-PRD-HACKATHON.md](./BE-PRD-HACKATHON.md)
- [BE-SPEC-HACKATHON.md](./BE-SPEC-HACKATHON.md)
- [BE-SPEC-MEMORY.md](./BE-SPEC-MEMORY.md)
- [BE-SPEC-INGEST.md](./BE-SPEC-INGEST.md)
- [BE-SPEC-INFRA.md](./BE-SPEC-INFRA.md)

---

## 1. Purpose

본 문서는 해커톤 범위에서 실제로 동작하는 RAG를 만들기 위한 최소 저장/검색 스키마를 고정한다.

이 문서가 고정하는 범위:

- `Cloud SQL for PostgreSQL + pgvector` 기반 최소 테이블
- memory record 저장 단위와 embedding 저장 단위
- `/api/analyze -> /api/ingest/memory -> recall` 흐름의 write/read 규칙
- current-page answer를 보강하는 recall query 규칙

이 문서는 generic document chunk store를 정의하지 않는다.
ThreadAtlas 해커톤 RAG의 canonical 저장 단위는 `summary-bearing semantic unit`이다.

---

## 2. Why Cloud SQL + pgvector

해커톤 RAG에서 backend가 다루는 저장 단위는 일반 chunk가 아니라 구조화된 memory record다.

필수 요구:

- `ownerUserId` 기준 필터
- `kind` 기준 필터
- provenance / evidence / navigation 메타 유지
- `recall-card`에 바로 사용할 browse metadata 반환
- vector similarity와 metadata filter를 함께 사용

따라서 해커톤 canonical RAG store는 `Vertex RAG Engine`이 아니라 `Cloud SQL for PostgreSQL + pgvector`로 둔다.

정리:

- `Vertex RAG Engine`
  - generic document / chunk retrieval에는 유리
- `Cloud SQL + pgvector`
  - 구조화된 record + metadata + ownership + browse metadata에는 더 적합

---

## 3. Hackathon Scope Decision

해커톤에서 RAG는 optional stretch가 아니라 in-scope다.

다만 범위는 다음처럼 제한한다.

- 저장 단위는 `MemoryRecord`만 허용
- record당 embedding은 1개만 저장
- recall은 current-page answer 이후 보조 `recall-card`로만 노출
- cross-tab session graph 기반 retrieval은 제외
- raw snapshot / raw screenshot은 장기 저장하지 않음

---

## 4. Canonical Tables

해커톤 canonical table은 아래 3개다.

1. `memory_records`
2. `memory_record_embeddings`
3. `analysis_runs`

### 4.1 `memory_records`

역할:

- 장기 기억의 canonical record store
- recall-card 생성 시 읽는 주 저장소
- provenance, navigation, evidence를 함께 보관

```sql
create extension if not exists vector;

create table if not exists memory_records (
  id uuid primary key,
  owner_user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in (
    'branch-summary',
    'section-summary',
    'claim-evidence-summary'
  )),
  record_status text not null default 'active' check (record_status in (
    'active',
    'archived'
  )),
  summary text not null,
  retrieval_text text not null,
  keywords text[] not null default '{}',
  entities text[] not null default '{}',

  source_url text not null,
  source_domain text not null,
  page_kind text not null check (page_kind in (
    'article',
    'thread',
    'post',
    'generic'
  )),
  snapshot_captured_at timestamptz not null,
  extractor_id text not null,
  skeleton_version integer not null,

  page_id text not null,
  unit_id text,
  root_node_ids text[] not null default '{}',

  canonical_url text not null,
  page_title text,
  page_anchor text,
  node_anchor jsonb,
  open_mode text check (open_mode in (
    'same-tab',
    'new-tab',
    'sidepanel-preview'
  )),

  evidence jsonb not null,
  visual jsonb,
  kind_payload jsonb,

  write_source text not null check (write_source in (
    'analyze',
    'turn-completion',
    'batch-repair'
  )),
  analysis_id uuid,
  created_at timestamptz not null default now(),
  last_accessed_at timestamptz
);
```

컬럼 의도:

- `summary`
  - 사용자에게 보여줄 canonical summary
- `retrieval_text`
  - embedding 입력으로 사용할 canonical text
- `node_anchor`, `evidence`, `visual`, `kind_payload`
  - 스키마 유연성을 위해 `jsonb`
- `source_domain`
  - sourceUrl에서 파생되는 filter 보조값
- `analysis_id`
  - 어떤 analyze run에서 파생됐는지 추적

### 4.2 `memory_record_embeddings`

역할:

- record별 embedding 저장
- vector similarity recall의 실제 검색 대상

```sql
create table if not exists memory_record_embeddings (
  record_id uuid primary key references memory_records(id) on delete cascade,
  owner_user_id uuid not null references users(id) on delete cascade,
  embedding_model text not null,
  embedding_dims integer not null default 768 check (embedding_dims = 768),
  embedding vector(768) not null,
  content_hash text not null,
  created_at timestamptz not null default now()
);
```

해커톤 규칙:

- record당 embedding은 정확히 1개
- 해커톤 canonical dimension은 `768`
- 다른 차원을 쓰려면 migration이 필요

### 4.3 `analysis_runs`

역할:

- `/api/analyze`의 결과를 audit/debug 용도로 기록
- memory ingest 전 후보군 traceability 확보

```sql
create table if not exists analysis_runs (
  id uuid primary key,
  owner_user_id uuid not null references users(id) on delete cascade,
  tab_id integer not null,
  mode text not null check (mode in (
    'seed',
    'memory-candidate',
    'visual-summary'
  )),
  snapshot_page_id text not null,
  snapshot_url text not null,
  normalized_mode text not null check (normalized_mode in (
    'discussion',
    'authored',
    'interactive',
    'generic'
  )),
  summary_candidates jsonb not null default '[]'::jsonb,
  visual_summaries jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
```

해커톤 규칙:

- `analysis_runs`는 canonical truth가 아니다
- debug / replay / candidate provenance 용도다
- memory recall은 `analysis_runs`가 아니라 `memory_records`에서 수행한다

### 4.4 Legacy Owner ID Migration Rule

`002_memory_owner_fk.sql` 적용 시 `owner_user_id`에 legacy non-UUID 값이 남아있으면 다음을 강제한다.

- `owner_user_id::uuid` 변환 실패를 조용히 무시하지 않는다.
- 변환 불가능한 row는 명시적으로 처리한다.
  - 정책 A: 해당 row 삭제 후 변환
  - 정책 B: 별도 quarantine 테이블로 이동 후 변환
- 변환 결과에 대한 집계(대상/성공/실패)를 로그 또는 migration 결과로 남긴다.
- 위 정리 없이 FK 추가를 진행하지 않는다.

---

## 5. Required Indexes

```sql
create index if not exists idx_memory_records_owner_created
  on memory_records (owner_user_id, created_at desc);

create index if not exists idx_memory_records_owner_kind
  on memory_records (owner_user_id, kind);

create index if not exists idx_memory_records_owner_page_kind
  on memory_records (owner_user_id, page_kind);

create index if not exists idx_memory_records_owner_domain
  on memory_records (owner_user_id, source_domain);

create index if not exists idx_analysis_runs_owner_created
  on analysis_runs (owner_user_id, created_at desc);

create index if not exists idx_memory_record_embeddings_owner
  on memory_record_embeddings (owner_user_id);
```

vector index:

```sql
create index if not exists idx_memory_record_embeddings_vector
  on memory_record_embeddings
  using hnsw (embedding vector_cosine_ops);
```

해커톤에서는 `hnsw`를 기본 권장한다.

---

## 6. Canonical Write Rules

### 6.1 Analyze Write Rule

`/api/analyze`는 기본적으로 DB에 long-term record를 직접 쓰지 않는다.

규칙:

- `analysis_runs`에는 기록 가능
- `memory_records`에는 직접 쓰지 않음
- 실제 장기 저장은 `/api/ingest/memory`만 담당

### 6.2 Ingest Write Rule

`/api/ingest/memory`는 아래를 모두 만족할 때만 record를 쓴다.

- `ownerUserId == authenticated principal`
- 허용된 `kind`
- 비어 있지 않은 `summary`
- complete provenance
- visual-only record 아님

추가 규칙:

- `retrieval_text`는 ingest 시 서버가 canonical하게 생성한다
- 생성 규칙:
  - `summary`
  - `keywords`
  - `entities`
  - kind-specific 핵심 필드
  - optional visual summary text
  를 합쳐 1개 문자열로 만든다

예:

```text
summary
keywords: websocket, sse, interruption
entities: WebSocket, SSE
claim: WebSocket is better for interruption and bidirectional updates
evidence: interruption handling; bidirectional updates
```

### 6.3 Embedding Write Rule

ingest 시 embedding도 같이 생성한다.

해커톤 canonical rule:

1. `memory_records` insert
2. `retrieval_text` 생성
3. Vertex embeddings 호출
4. `memory_record_embeddings` insert

실패 규칙:

- embedding 생성 실패 시 record write 전체를 실패로 돌릴지,
- embedding 없는 record를 허용할지는 구현 정책으로 볼 수 있다

해커톤 canonical 권장은:

- **embedding 생성 실패 시 해당 record는 reject**

이유:

- RAG가 in-scope이므로 recall 가능한 record만 저장하는 편이 더 단순하다

---

## 7. Canonical Recall Query

current-page answer 이후 recall-card를 만들 때의 canonical query 규칙은 다음과 같다.

### 7.1 Query Input

recall query text는 아래를 합쳐 만든다.

- current user intent text
- current normalized focus text
- current-page answer summary

### 7.2 Mandatory Filter

아래는 항상 적용한다.

- `owner_user_id = current principal`
- `record_status = 'active'`

### 7.3 Preferred Filter

가능하면 아래를 추가한다.

- current page kind와 같은 `page_kind`
- keyword/entity overlap
- source domain preference

### 7.4 Retrieval Algorithm

해커톤 canonical 알고리즘:

1. query text embedding 생성
2. `memory_record_embeddings`에서 top-k vector similarity 검색
3. metadata overlap 기준 lightweight rerank
4. threshold 이상이면 recall candidate 채택

기본값:

- `top_k = 8`
- 최종 recall-card 노출 수 = 최대 2

### 7.5 Recall Output Rule

recall hit는 current-page answer를 대체하지 않는다.

규칙:

- primary answer는 항상 current-page 기반
- recall은 `recall-card`로만 노출
- `navigation` 메타를 그대로 FE에 전달

---

## 8. Minimal Kind Payload Shape

`kind_payload`는 kind별 추가 필드를 담는다.

### 8.1 Branch Summary

```json
{
  "rootCommentId": "comment-43199977",
  "focusCommentId": "comment-43199990",
  "depthHint": 2,
  "participantAuthors": ["alice", "bob"]
}
```

### 8.2 Section Summary

```json
{
  "headingText": "Why WebSocket",
  "levelHint": 2,
  "containerNodeId": "section-why-websocket"
}
```

### 8.3 Claim Evidence Summary

```json
{
  "claim": "WebSocket is better for interruption and bidirectional updates",
  "evidencePoints": [
    "supports interruption",
    "supports bidirectional updates"
  ],
  "stance": "supports"
}
```

---

## 9. What Is Required Now

지금 해커톤 구현에서 필수인 것:

- `memory_records`
- `memory_record_embeddings`
- owner-scoped vector recall
- `analysis_runs` 최소 기록

지금 필수가 아닌 것:

- multi-vector per record
- graph edge table
- cross-user retrieval
- chunk-level storage
- raw visual artifact storage

---

## 10. Implementation Notes

해커톤 구현 우선순위는 다음이다.

1. `memory_records` table
2. `memory_record_embeddings` table
3. `/api/ingest/memory` 실제 DB write
4. embedding 생성 adapter
5. current-page answer 이후 recall query
6. `recall-card` projection 연결

즉, WS transport보다 먼저 이 스키마를 닫는 이유는
recall과 ingest의 실제 동작 기준이 이 테이블 정의에 달려 있기 때문이다.
