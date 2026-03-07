// 로컬 사용자 식별자로 단건 조회해 사용자 존재 여부를 확인한다.
export const FIND_USER_BY_ID_SQL = `
  select id, display_name, primary_email, avatar_url, created_at
  from users
  where id = $1
  limit 1
`

// 부트스트랩 주체와 연결된 기존 사용자 매핑을 먼저 찾는다.
export const SELECT_EXISTING_BOOTSTRAP_IDENTITY_SQL = `
  select user_id
  from user_identities
  where provider = 'google' and provider_subject = $1
  limit 1
`

// 기존 사용자 프로필을 최신 입력으로 부분 갱신한다.
export const UPDATE_USER_FROM_BOOTSTRAP_PROFILE_SQL = `
  update users
  set
    display_name = coalesce($2, display_name),
    primary_email = coalesce($3, primary_email),
    avatar_url = coalesce($4, avatar_url),
    last_login_at = now()
  where id = $1
`

// 부트스트랩 아이덴티티의 메타 정보를 로그인 시점 기준으로 갱신한다.
export const UPDATE_BOOTSTRAP_IDENTITY_SQL = `
  update user_identities
  set
    email = coalesce($2, email),
    raw_claims = coalesce(raw_claims, '{}'::jsonb),
    last_login_at = now()
  where provider = 'google' and provider_subject = $1
`

// 신규 부트스트랩 사용자를 users 테이블에 생성한다.
export const INSERT_USER_FROM_BOOTSTRAP_SQL = `
  insert into users (
    id,
    display_name,
    primary_email,
    avatar_url,
    last_login_at
  ) values ($1, $2, $3, $4, now())
`

// 신규 사용자의 부트스트랩 아이덴티티 바인딩을 생성한다.
export const INSERT_BOOTSTRAP_IDENTITY_SQL = `
  insert into user_identities (
    id,
    user_id,
    provider,
    provider_subject,
    email,
    email_verified,
    raw_claims,
    last_login_at
  ) values ($1, $2, 'google', $3, $4, false, $5::jsonb, now())
`

// 부트스트랩 주체 기준으로 최종 사용자 정보를 조인 조회한다.
export const RESOLVE_USER_FROM_BOOTSTRAP_SUBJECT_SQL = `
  select u.id, u.display_name, u.primary_email, u.avatar_url, u.created_at
  from user_identities ui
  join users u on u.id = ui.user_id
  where ui.provider = 'google' and ui.provider_subject = $1
  limit 1
`
