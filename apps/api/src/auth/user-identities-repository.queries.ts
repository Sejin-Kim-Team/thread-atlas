// 동일 제공자/주체 조합의 기존 아이덴티티 매핑을 조회한다.
export const SELECT_EXISTING_GOOGLE_IDENTITY_SQL = `
  select user_id
  from user_identities
  where provider = 'google' and provider_subject = $1
  limit 1
`

// 동일 Google sub 동시 로그인을 직렬화해 unique 충돌을 방지한다.
export const LOCK_GOOGLE_IDENTITY_SUBJECT_SQL = `
  select pg_advisory_xact_lock(hashtextextended($1, 0))
`

// 아이덴티티가 없을 때 연결할 users 레코드를 먼저 생성한다.
export const INSERT_USER_FOR_GOOGLE_IDENTITY_SQL = `
  insert into users (
    id,
    display_name,
    primary_email,
    avatar_url,
    last_login_at
  ) values ($1, $2, $3, $4, now())
`

// 사용자와 구글 아이덴티티의 최초 바인딩을 기록한다.
export const INSERT_GOOGLE_IDENTITY_SQL = `
  insert into user_identities (
    id,
    user_id,
    provider,
    provider_subject,
    email,
    email_verified,
    raw_claims,
    last_login_at
  ) values ($1, $2, 'google', $3, $4, $5, $6::jsonb, now())
`

// 기존 사용자 프로필을 아이덴티티 입력값으로 보강 갱신한다.
export const UPDATE_USER_FROM_GOOGLE_IDENTITY_SQL = `
  update users
  set
    display_name = coalesce($2, display_name),
    primary_email = coalesce($3, primary_email),
    avatar_url = coalesce($4, avatar_url),
    last_login_at = now()
  where id = $1
`

// 기존 구글 아이덴티티의 이메일/검증상태/원본클레임을 갱신한다.
export const UPDATE_GOOGLE_IDENTITY_SQL = `
  update user_identities
  set
    email = coalesce($2, email),
    email_verified = coalesce($3, email_verified),
    raw_claims = coalesce($4::jsonb, raw_claims),
    last_login_at = now()
  where provider = 'google' and provider_subject = $1
`
