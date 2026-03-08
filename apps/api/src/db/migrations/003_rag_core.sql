create extension if not exists vector;

create table if not exists memory_records (
  id text primary key,
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
  analysis_id text,
  created_at timestamptz not null default now(),
  last_accessed_at timestamptz
);

create table if not exists memory_record_embeddings (
  record_id text primary key references memory_records(id) on delete cascade,
  owner_user_id uuid not null references users(id) on delete cascade,
  embedding_model text not null,
  embedding_dims integer not null check (embedding_dims = 768),
  embedding vector(768) not null,
  content_hash text not null,
  created_at timestamptz not null default now()
);

delete from memory_record_embeddings mre
where not exists (
  select 1
  from memory_records mr
  where mr.id = mre.record_id
);

alter table memory_record_embeddings
  drop constraint if exists memory_record_embeddings_record_id_fkey;

alter table memory_record_embeddings
  add constraint memory_record_embeddings_record_id_fkey
  foreign key (record_id) references memory_records(id) on delete cascade;

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

create index if not exists idx_memory_records_owner_created
  on memory_records (owner_user_id, created_at desc);

create index if not exists idx_memory_records_owner_kind
  on memory_records (owner_user_id, kind);

create index if not exists idx_memory_records_owner_page_kind
  on memory_records (owner_user_id, page_kind);

create index if not exists idx_memory_records_owner_domain
  on memory_records (owner_user_id, source_domain);

create index if not exists idx_memory_record_embeddings_owner
  on memory_record_embeddings (owner_user_id);

create index if not exists idx_memory_record_embeddings_vector
  on memory_record_embeddings
  using hnsw (embedding vector_cosine_ops);

create index if not exists idx_analysis_runs_owner_created
  on analysis_runs (owner_user_id, created_at desc);
