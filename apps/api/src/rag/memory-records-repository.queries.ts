// memory_records 단건 저장 쿼리다.
export const INSERT_MEMORY_RECORD_SQL = `
  insert into memory_records (
    id,
    owner_user_id,
    kind,
    summary,
    retrieval_text,
    keywords,
    entities,
    source_url,
    source_domain,
    page_kind,
    snapshot_captured_at,
    extractor_id,
    skeleton_version,
    page_id,
    unit_id,
    root_node_ids,
    canonical_url,
    page_title,
    page_anchor,
    node_anchor,
    open_mode,
    evidence,
    visual,
    kind_payload,
    write_source,
    analysis_id,
    created_at
  ) values (
    $1, $2, $3, $4, $5, $6::text[], $7::text[],
    $8, $9, $10, $11, $12, $13, $14, $15, $16::text[],
    $17, $18, $19, $20::jsonb, $21, $22::jsonb, $23::jsonb, $24::jsonb, $25, $26, $27
  )
  returning
    id,
    owner_user_id,
    kind,
    summary,
    retrieval_text,
    canonical_url,
    node_anchor,
    created_at
`

// memory_records id 기준 단건 조회 쿼리다.
export const SELECT_MEMORY_RECORD_BY_ID_SQL = `
  select
    id,
    owner_user_id,
    kind,
    summary,
    retrieval_text,
    canonical_url,
    page_title,
    node_anchor,
    created_at
  from memory_records
  where id = $1
  limit 1
`

// owner 기준 최신순 조회 쿼리다.
export const SELECT_MEMORY_RECORDS_BY_OWNER_SQL = `
  select
    id,
    owner_user_id,
    kind,
    summary,
    retrieval_text,
    canonical_url,
    page_title,
    node_anchor,
    created_at
  from memory_records
  where owner_user_id = $1
  order by created_at desc
  limit $2
`

// owner + kind 기준 최신순 조회 쿼리다.
export const SELECT_MEMORY_RECORDS_BY_OWNER_AND_KIND_SQL = `
  select
    id,
    owner_user_id,
    kind,
    summary,
    retrieval_text,
    canonical_url,
    page_title,
    node_anchor,
    created_at
  from memory_records
  where owner_user_id = $1
    and kind = $2
  order by created_at desc
  limit $3
`
