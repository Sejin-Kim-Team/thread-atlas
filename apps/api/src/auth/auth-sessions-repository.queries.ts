// 세션 발급 전 users 로그인 시각을 최신화한다.
export const UPSERT_USER_LAST_LOGIN_SQL = `
  insert into users (id, last_login_at)
  values ($1, now())
  on conflict (id) do update
  set last_login_at = now()
`

// 해시된 세션 토큰과 만료시각을 포함한 앱 세션을 생성한다.
export const INSERT_AUTH_SESSION_SQL = `
  insert into auth_sessions (
    id,
    user_id,
    session_token_hash,
    issued_at,
    expires_at,
    client_kind,
    user_agent,
    last_seen_at
  ) values ($1, $2, $3, $4, $5, $6, $7, now())
`

// 유효한 세션 토큰 해시로 인증 주체를 복원할 세션을 조회한다.
export const SELECT_ACTIVE_AUTH_SESSION_SQL = `
  select id, user_id, expires_at
  from auth_sessions
  where session_token_hash = $1
    and revoked_at is null
    and expires_at > now()
  limit 1
`

// 인증 성공 시 마지막 사용 시각을 갱신한다.
export const UPDATE_AUTH_SESSION_LAST_SEEN_SQL = `
  update auth_sessions
  set last_seen_at = now()
  where id = $1
`

// 세션을 즉시 폐기 상태로 전환한다.
export const REVOKE_AUTH_SESSION_SQL = `
  update auth_sessions
  set revoked_at = now()
  where id = $1
`
