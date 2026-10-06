-- BYTE BACK 3단계: 로그인한 사람이 가상 메모를 추가·수정·삭제할 수 있게 notes 테이블을 넓힙니다.
-- 기존 가상 메모 네 건은 지우지 않습니다. 메모 본문이나 키·개인정보는 이 파일에 없습니다.
-- Supabase 대시보드 > SQL Editor에 붙여 넣고 Run 한 번이면 됩니다. 여러 번 실행해도 됩니다.

begin;

-- API가 쓰는 메모 id(UUID). 기존 행에도 자동으로 채워집니다.
alter table public.notes add column if not exists public_id uuid not null default gen_random_uuid();
create unique index if not exists notes_public_id_key on public.notes (public_id);

-- 새 메모는 1단계 확인 표시 없이 저장합니다. (기존 네 건은 표시를 그대로 가집니다.)
alter table public.notes alter column sample_marker drop not null;
alter table public.notes alter column sample_marker drop default;

alter table public.notes add column if not exists updated_at timestamptz not null default now();
create index if not exists notes_owner_id_idx on public.notes (owner_id);

-- RLS는 켠 채로 두고, 브라우저용 역할(anon·authenticated)은 계속 막습니다.
alter table public.notes enable row level security;
revoke all on table public.notes from anon, authenticated;
revoke all on sequence public.notes_id_seq from anon, authenticated;

-- 서버 전용 키(service_role)만 읽기·쓰기를 합니다.
grant select, insert, update, delete on table public.notes to service_role;
grant usage on sequence public.notes_id_seq to service_role;

commit;

-- ===== 실행 뒤 확인 (따로 실행) =====
-- select column_name, data_type, is_nullable from information_schema.columns
--  where table_schema = 'public' and table_name = 'notes' order by ordinal_position;
--   → public_id uuid NO, owner_id uuid YES, sample_marker text YES, updated_at 이 보여야 합니다.
-- select grantee, string_agg(privilege_type, ', ' order by privilege_type)
--   from information_schema.role_table_grants
--  where table_schema = 'public' and table_name = 'notes' and grantee in ('anon', 'authenticated', 'service_role')
--  group by grantee;
--   → service_role 한 줄(DELETE, INSERT, SELECT, UPDATE …)만 보여야 합니다.

-- ===== 선택: 기존 가상 메모 네 건을 A 계정 소유로 정하기 =====
-- 목록 GET은 로그인한 사람의 메모만 돌려주므로, 기존 네 건은 owner_id가 비어 있어 아무 목록에도 나오지 않습니다.
-- A 로그인 뒤에도 네 건이 보이게 하려면, 아래 'A계정이메일'을 SQL Editor에서만 바꿔 실행하세요(이 파일에 실제 이메일을 적지 마세요).
-- update public.notes
--    set owner_id = (select id from auth.users where email = 'A계정이메일')
--  where owner_id is null and sample_marker = 'SAMPLE_NOTE_1';
