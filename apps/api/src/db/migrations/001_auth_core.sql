create table if not exists users (
  id uuid primary key,
  display_name text,
  primary_email text,
  avatar_url text,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table if not exists user_identities (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  provider text not null check (provider in ('google', 'bootstrap')),
  provider_subject text not null,
  email text,
  email_verified boolean,
  raw_claims jsonb,
  created_at timestamptz not null default now(),
  last_login_at timestamptz,
  unique (provider, provider_subject)
);

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

create index if not exists idx_auth_sessions_user_id on auth_sessions (user_id);
create index if not exists idx_auth_sessions_expires_at on auth_sessions (expires_at);
