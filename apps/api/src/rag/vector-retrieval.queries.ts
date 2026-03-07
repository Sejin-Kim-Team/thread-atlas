// owner 범위 내 pgvector 유사도 조회 쿼리다.
export const SEARCH_BY_VECTOR_SQL = `
  select
    mre.record_id,
    mre.owner_user_id,
    (1 - (mre.embedding <=> $2::vector)) as similarity_score
  from memory_record_embeddings mre
  inner join memory_records mr
    on mr.id = mre.record_id
   and mr.owner_user_id = mre.owner_user_id
  where mre.owner_user_id = $1
    and mr.record_status = 'active'
    and ($3::text is null or mr.page_kind = $3)
    and ($4::text is null or mr.source_domain = $4)
  order by mre.embedding <=> $2::vector asc
  limit $5
`
