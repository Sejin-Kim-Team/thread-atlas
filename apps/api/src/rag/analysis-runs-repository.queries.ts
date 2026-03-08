// analysis run 저장 쿼리다.
export const INSERT_ANALYSIS_RUN_SQL = `
  insert into analysis_runs (
    id,
    owner_user_id,
    tab_id,
    mode,
    snapshot_page_id,
    snapshot_url,
    normalized_mode,
    summary_candidates,
    visual_summaries,
    created_at
  ) values (
    $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10
  )
  returning
    id,
    owner_user_id,
    tab_id,
    mode,
    snapshot_page_id,
    snapshot_url,
    normalized_mode,
    summary_candidates,
    visual_summaries,
    created_at
`

// owner 기준 analysis run 목록 조회 쿼리다.
export const SELECT_ANALYSIS_RUNS_BY_OWNER_SQL = `
  select
    id,
    owner_user_id,
    tab_id,
    mode,
    snapshot_page_id,
    snapshot_url,
    normalized_mode,
    summary_candidates,
    visual_summaries,
    created_at
  from analysis_runs
  where owner_user_id = $1
    and ($2::text is null or mode = $2)
  order by created_at desc
  limit $3
`
