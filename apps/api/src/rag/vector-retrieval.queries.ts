// owner 범위 내 pgvector 유사도 조회 쿼리다.
export const SEARCH_BY_VECTOR_SQL = `
  select
    mre.record_id,
    mre.owner_user_id,
    (1 - (mre.embedding <=> $2::vector)) as similarity_score
  from memory_record_embeddings mre
  where mre.owner_user_id = $1
  order by mre.embedding <=> $2::vector asc
  limit $3
`
