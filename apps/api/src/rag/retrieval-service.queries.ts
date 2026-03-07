// 벡터 후보 ID 집합에서 owner/pageKind/sourceDomain 범위로 레코드를 조회한다.
export const SELECT_RETRIEVAL_CANDIDATE_ROWS_SQL = `
  select
    mr.id as record_id,
    mr.owner_user_id,
    mr.summary,
    mr.retrieval_text,
    mr.kind,
    mr.canonical_url,
    mr.page_title,
    mr.node_anchor,
    mr.open_mode,
    mr.source_domain,
    mr.page_kind,
    mr.created_at
  from memory_records mr
  where mr.owner_user_id = $1
    and mr.id = any($2::text[])
    and mr.record_status = 'active'
    and ($3::text is null or mr.page_kind = $3)
    and ($4::text is null or mr.source_domain = $4)
`
