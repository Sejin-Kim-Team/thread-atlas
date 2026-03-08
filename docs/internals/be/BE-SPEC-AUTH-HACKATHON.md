# ThreadAtlas Backend Spec

## Hackathon Authentication and Session Identity

Version: 0.1-hackathon
Status: Draft
Companion:
- [BE-PRD-HACKATHON.md](./BE-PRD-HACKATHON.md)
- [BE-SPEC-HACKATHON.md](./BE-SPEC-HACKATHON.md)
- [BE-SPEC-PROTOCOL-HACKATHON.md](./BE-SPEC-PROTOCOL-HACKATHON.md)
- [BE-SPEC-RAG-HACKATHON.md](./BE-SPEC-RAG-HACKATHON.md)

---

## 1. Purpose

본 문서는 해커톤 범위에서 backend가 사용하는 canonical 인증 모델을 정의한다.

이 문서가 고정하는 범위:

- Google OAuth 기반 사용자 인증 흐름
- backend 내부 user / identity / auth session 스키마
- WS/HTTP 공통 principal 규칙
- 해커톤 범위에서 허용되는 토큰 모델

---

## 2. Why This Is Required

`userId -> /api/token -> stub token`만으로는 충분하지 않다.

이 방식의 문제:

- `userId`를 아는 누구나 같은 principal처럼 행동할 수 있다
- memory ownership을 신뢰할 수 없다
- RAG record와 auth principal을 안정적으로 연결할 수 없다
- process restart 이후에도 의미 있는 user/session 추적이 어렵다

따라서 해커톤 canonical auth는 **Google OAuth -> backend verification -> app session token**으로 고정한다.

---

## 3. Canonical Auth Flow

```text
User
-> FE Google OAuth login
-> FE obtains Google credential
-> FE sends Google credential to BE
-> BE verifies Google identity
-> BE upserts local user / identity
-> BE issues app session token
-> FE uses app session token for WS + HTTP
```

핵심 규칙:

- FE는 Google 로그인만 담당한다
- canonical principal 결정은 BE가 한다
- WS/HTTP는 모두 backend-issued app session token을 사용한다
- memory ownership과 session ownership은 backend principal 기준으로만 판정한다

---

## 4. Supported Google Auth Mode

해커톤 canonical 지원 모드는 다음이다.

### 4.1 Primary

- **Google ID token verification**

의미:

- FE가 Google 로그인 후 `id_token`을 BE에 전달
- BE는 Google 기준으로 토큰을 검증
- 검증 성공 시 내부 app session token을 발급

해커톤에서 이 방식을 primary로 두는 이유:

- 구현이 가장 단순함
- Chrome extension flow와 연결이 쉬움
- BE가 `sub`, `email`, `name`, `picture` 같은 최소 claim을 바로 받을 수 있음

### 4.2 Deferred

- authorization code + PKCE

이 방식은 upgrade 범위로 둔다.

---

## 5. Canonical Identity Rule

외부 identity 기준:

- Google 사용자의 canonical 외부 식별자는 `sub` claim이다
- `email`은 표시/보조 필드일 뿐 primary key가 아니다

내부 principal 기준:

- backend의 canonical principal은 local `users.id`다
- app session token은 local `users.id`를 principal로 포함해야 한다

따라서 identity chain은 다음처럼 고정한다.

```text
Google sub
-> local user identity binding
-> local users.id
-> app session token principal
```

---

## 6. Canonical Tables

해커톤 canonical auth schema는 아래 3개 테이블을 사용한다.

1. `users`
2. `user_identities`
3. `auth_sessions`

### 6.1 `users`

```sql
create table if not exists users (
  id uuid primary key,
  display_name text,
  primary_email text,
  avatar_url text,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);
```

역할:

- backend 내부 canonical user row
- memory ownership, session ownership의 기준

### 6.2 `user_identities`

```sql
create table if not exists user_identities (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  provider text not null check (provider in ('google')),
  provider_subject text not null,
  email text,
  email_verified boolean,
  raw_claims jsonb,
  created_at timestamptz not null default now(),
  last_login_at timestamptz,
  unique (provider, provider_subject)
);
```

역할:

- Google identity와 local user binding

핵심 규칙:

- `provider_subject`는 Google `sub`
- `(provider, provider_subject)`는 unique

### 6.3 `auth_sessions`

```sql
create table if not exists auth_sessions (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  session_token_hash text not null unique,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  client_kind text not null default 'extension',
  user_agent text,
  last_seen_at timestamptz
);
```

역할:

- backend-issued app session token 관리
- WS/HTTP 공통 principal 해석

핵심 규칙:

- raw token은 저장하지 않고 hash만 저장
- revoked/expired session은 principal로 사용하지 않는다

---

## 7. Recommended Token Contract

### 7.1 Google Exchange Request

```ts
export interface GoogleAuthExchangeRequest {
  provider: "google"
  idToken: string
}
```

### 7.2 Google Exchange Response

```ts
export interface GoogleAuthExchangeResponse {
  token: string
  expiresAt: number
  user: {
    id: string
    displayName?: string
    primaryEmail?: string
    avatarUrl?: string
  }
}
```

규칙:

- FE는 이후 Google token이 아니라 backend-issued `token`을 사용한다
- HTTP는 `Authorization: Bearer <app-token>`을 사용한다
- WS는 해커톤 절충안으로 `/ws/session?token=<app-token>`을 사용한다
- WS query token 사용은 임시 계약이며, 토큰 검증은 반드시 `upgrade` 단계에서 완료해야 한다

### 7.3 Hackathon Transition: `dev-bootstrap` Grant

해커톤 구현에서는 Google 검증 연결 전 단계로 `dev-bootstrap` grant를 허용한다.

요청 호환 규칙:

- 신규 입력:
  - `grantType: "dev-bootstrap"`
  - `bootstrapSubject: string`
- legacy compatibility 입력:
  - `{ userId: string }`
- 해커톤 기간에는 위 2가지 입력을 모두 허용한다.
- FE migration 완료 후 legacy compatibility 입력은 제거 대상으로 본다.

요구사항:

- `DATABASE_URL` 환경변수는 필수다. (auth session store가 PostgreSQL 기반)
- `AUTH_BOOTSTRAP_KEY` 환경변수는 필수다.
- `AUTH_BOOTSTRAP_KEY` 미설정 상태에서는 `dev-bootstrap` grant를 처리하지 않고 `503 SERVICE_UNAVAILABLE`를 반환한다.
- fallback key 또는 hardcoded dev key는 허용하지 않는다.
- bootstrap key mismatch는 `403 FORBIDDEN`를 반환한다.
- `google-id-token` grant는 verifier 연동 전까지 `501 NOT_IMPLEMENTED`를 반환한다.

응답 규칙:

- `/api/token`의 `expiresAt`는 epoch seconds(number)로 반환한다.
- 문자열 timestamp 형식은 허용하지 않는다.

---

## 8. Verification Rules

BE는 Google credential을 검증할 때 최소한 아래를 확인해야 한다.

- issuer (`iss`)
- audience (`aud`)
- expiration (`exp`)
- subject (`sub`)

검증 실패 시:

- `401 UNAUTHORIZED`

검증 성공 시:

1. `user_identities(provider='google', provider_subject=sub)` lookup
2. 없으면 `users` / `user_identities` 생성
3. 있으면 `users.last_login_at`, `user_identities.last_login_at` 갱신
4. `auth_sessions` insert
5. app session token 발급

---

## 9. Principal Rules for Other Specs

이 문서가 다른 spec에 미치는 영향:

- `memory_records.owner_user_id`는 장기적으로 local `users.id`를 저장해야 한다
- `/api/analyze`, `/api/ingest/memory`, `/ws/session`은 모두 app session principal 기준으로 동작해야 한다
- `(principalUserId, clientSessionId)`의 `principalUserId`는 더 이상 FE 임의 `userId`가 아니라 local `users.id`다

---

## 10. Hackathon Compromise

해커톤에서는 다음을 허용한다.

- Google login은 필수
- backend-issued session token은 opaque token이어도 됨
- token store는 DB 기반이면 충분

해커톤에서 제외:

- multi-device session management
- refresh token lifecycle 최적화
- 여러 OAuth provider 지원
- enterprise domain restriction

---

## 11. Implementation Order

권장 구현 순서:

1. auth schema migration
2. Google credential verify adapter
3. auth exchange endpoint
4. app session token issue / resolve
5. `/api/token` legacy 경로 제거 또는 dev-only 격하
6. RAG ownership을 local `users.id` 기준으로 연결

즉 해커톤 canonical auth는 단순 stub token이 아니라,
**Google verified login + backend-issued session token + DB-backed user/session ownership**
이다.
