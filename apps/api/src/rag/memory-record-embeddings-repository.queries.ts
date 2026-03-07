// embedding upsert 쿼리다.
export const UPSERT_MEMORY_RECORD_EMBEDDING_SQL = `
  insert into memory_record_embeddings (
    record_id,
    owner_user_id,
    embedding_model,
    embedding_dims,
    embedding,
    content_hash
  ) values (
    $1, $2, $3, $4, $5::vector, $6
  )
  on conflict (record_id) do update
    set owner_user_id = excluded.owner_user_id,
        embedding_model = excluded.embedding_model,
        embedding_dims = excluded.embedding_dims,
        embedding = excluded.embedding,
        content_hash = excluded.content_hash,
        created_at = now()
  returning
    record_id,
    owner_user_id,
    embedding_model,
    embedding_dims,
    embedding,
    content_hash,
    created_at
`

// record id 기준 embedding 단건 조회 쿼리다.
export const SELECT_MEMORY_RECORD_EMBEDDING_BY_RECORD_ID_SQL = `
  select
    record_id,
    owner_user_id,
    embedding_model,
    embedding_dims,
    embedding,
    content_hash,
    created_at
  from memory_record_embeddings
  where record_id = $1
  limit 1
`
