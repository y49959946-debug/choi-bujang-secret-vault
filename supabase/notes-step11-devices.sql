-- BYTE BACK 11단계: 기기 승인(패스키)과 요청 서명용 테이블을 만듭니다.
-- 메모 본문·키·이메일·비밀번호는 이 파일에 없습니다. Supabase 대시보드 > SQL Editor에서 ①→②→③ 순서로 따로 실행하세요.
-- 대상은 새 테이블 네 개뿐입니다. 기존 메모·사본·감사 테이블과 권한은 바꾸지 않습니다.
--
-- 규칙
--   - device_credentials: 이 기기의 패스키 공개키. 등록하면 항상 'pending'(승인 대기)으로 들어갑니다.
--     서버 함수(api/device.js)는 상태를 'approved'로 바꾸는 코드가 없습니다. 승인은 아래 ④처럼 주인이 SQL Editor에서만 합니다.
--   - device_challenges: 패스키 등록·로그인에 쓰는 일회용 문제(5분, 한 번 쓰면 끝).
--   - device_sessions: 승인된 기기가 패스키로 확인한 뒤 받은 임시 서명 키의 "공개키"(8시간). 비밀키는 브라우저 메모리에만 있습니다.
--   - device_request_nonces: 서명한 요청의 일회용 번호. 같은 번호로 다시 보내면 거부합니다.
--   - anon·authenticated(브라우저 역할)는 네 테이블을 읽거나 쓸 수 없습니다. 서버 전용 키(service_role)만 씁니다.


-- ① 준비 확인: gen_random_uuid()가 있는지(Postgres 기본). uuid 한 줄이 나오면 됩니다.
select gen_random_uuid() as uuid_check;


-- ② 적용 (begin부터 commit까지 한 묶음) ------------------------------------------
begin;

create table if not exists public.device_credentials (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null,
  credential_id  text not null unique,
  public_key     text not null,
  counter        bigint not null default 0,
  transports     text[] not null default '{}',
  rp_id          text not null,
  label          text not null default '',
  status         text not null default 'pending' check (status in ('pending', 'approved', 'revoked')),
  created_at     timestamptz not null default now(),
  approved_at    timestamptz,
  last_used_at   timestamptz
);
create index if not exists device_credentials_owner on public.device_credentials (owner_id);

create table if not exists public.device_challenges (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null,
  purpose         text not null check (purpose in ('register', 'session')),
  challenge       text not null,
  nonce           text,
  key_thumbprint  text,
  rp_id           text not null,
  expires_at      timestamptz not null,
  used_at         timestamptz,
  created_at      timestamptz not null default now()
);

create table if not exists public.device_sessions (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null,
  credential_row uuid not null references public.device_credentials (id) on delete cascade,
  public_jwk     jsonb not null,
  expires_at     timestamptz not null,
  created_at     timestamptz not null default now()
);

create table if not exists public.device_request_nonces (
  session_id uuid not null references public.device_sessions (id) on delete cascade,
  nonce      text not null,
  at         timestamptz not null default now(),
  primary key (session_id, nonce)
);

alter table public.device_credentials enable row level security;
alter table public.device_challenges enable row level security;
alter table public.device_sessions enable row level security;
alter table public.device_request_nonces enable row level security;
-- Supabase가 새 테이블에 자동으로 주는 권한까지 거두고, 서버 전용 키에 필요한 것만 줍니다.
revoke all on table public.device_credentials, public.device_challenges, public.device_sessions, public.device_request_nonces
  from public, anon, authenticated, service_role;
grant select, insert on table public.device_credentials to service_role;
-- 서버 전용 키는 사용 횟수(counter)·마지막 사용 시각만 고칠 수 있습니다. status·approved_at은 고칠 권한이 없어
-- 서버 함수가 잘못되거나 키가 새도 기기를 스스로 승인할 수 없습니다(승인은 ④처럼 SQL Editor에서 주인만).
grant update (counter, last_used_at) on table public.device_credentials to service_role;
grant select, insert on table public.device_challenges to service_role;
grant update (used_at) on table public.device_challenges to service_role;          -- 한 번 쓰면 used_at 기록
grant select, insert on table public.device_sessions to service_role;
grant select, insert on table public.device_request_nonces to service_role;

commit;


-- ③ 확인 (따로 실행) --------------------------------------------------------------
-- (a) 브라우저 역할(anon·authenticated)이 보이면 안 됩니다. service_role은 SELECT·INSERT만 보여야 합니다(UPDATE는 아래 (c)의 칸 단위).
select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type) as privileges
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name in ('device_credentials', 'device_challenges', 'device_sessions', 'device_request_nonces')
   and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
 group by table_name, grantee order by table_name, grantee;
-- (c) 서버 전용 키가 고칠 수 있는 칸: device_credentials는 counter·last_used_at, device_challenges는 used_at만 나와야 합니다.
select table_name, column_name, privilege_type
  from information_schema.column_privileges
 where table_schema = 'public' and grantee = 'service_role' and privilege_type = 'UPDATE'
   and table_name in ('device_credentials', 'device_challenges')
 order by table_name, column_name;
-- (b) 등록된 기기와 상태(공개키·자격 ID는 보지 않음)
select id, left(owner_id::text, 8) as owner8, label, status, created_at, approved_at, last_used_at
  from public.device_credentials order by created_at desc;


-- ④ 기기 승인 (주인이 직접, 기기마다 한 번) ---------------------------------------
-- 화면에서 「이 기기 승인 요청」을 누르면 위 (b)에 status = 'pending'인 줄이 생깁니다.
-- 내 기기가 맞는지(만든 시각·이름) 확인한 뒤, 그 줄의 id를 넣어 실행합니다. 화면의 버튼으로는 승인되지 않습니다.
-- update public.device_credentials set status = 'approved', approved_at = now()
--  where id = '<승인할 기기 id>' and status = 'pending';

-- 기기 회수(분실·의심): 다음 요청부터 바로 거부됩니다.
-- update public.device_credentials set status = 'revoked' where id = '<회수할 기기 id>';
