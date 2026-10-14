-- BYTE BACK 10단계: 비공개 메모 사본(notes_backup)과 복원 감사 기록(restore_audit)을 만듭니다.
-- 메모 본문·키·이메일은 이 파일에 없습니다. Supabase 대시보드 > SQL Editor에서 ①→②→③ 순서로 따로 실행하세요.
-- 대상은 새 테이블 두 개와 public.notes에 붙는 트리거 하나뿐입니다. 기존 메모·권한은 바꾸지 않습니다.
--
-- 사본 규칙
--   - 메모가 public.notes에 처음 들어갈 때 트리거가 그 순간의 제목·내용과 SHA-256을 사본으로 한 번만 남깁니다.
--   - 이후 수정·삭제는 사본에 반영되지 않습니다(on conflict do nothing). 그래서 변조·삭제 뒤에도 처음 내용으로 복원할 수 있습니다.
--   - anon·authenticated는 사본·감사 기록을 읽거나 쓸 수 없습니다. 서버 함수(서버 전용 키)만 읽고, 감사 기록은 넣기만 합니다.
--   - 감사 기록은 트리거가 UPDATE·DELETE를 막습니다(서버 전용 키로도 고치거나 지울 수 없음).


-- ① 준비: 확장 설치는 필요 없습니다(해시는 Postgres 기본 함수 pg_catalog.sha256을 씁니다).
--    아래 한 줄로 sha256 함수가 있는지만 확인하세요. 64자리 글자가 나오면 됩니다.
select encode(pg_catalog.sha256(convert_to('check', 'UTF8')), 'hex') as sha256_check;


-- ② 적용 (begin부터 commit까지 한 묶음) ------------------------------------------
begin;

create table if not exists public.notes_backup (
  public_id      uuid primary key,
  owner_id       uuid not null,
  title          text not null,
  content        text not null,
  title_sha256   text not null,
  content_sha256 text not null,
  created_at     timestamptz,
  captured_at    timestamptz not null default now()
);
alter table public.notes_backup enable row level security;
revoke all on table public.notes_backup from public, anon, authenticated, service_role; -- Supabase가 새 테이블에 자동으로 주는 권한까지 거둠
grant select, insert on table public.notes_backup to service_role;

create table if not exists public.restore_audit (
  id                    bigserial primary key,
  at                    timestamptz not null default now(),
  run_id                uuid not null,
  public_id             uuid not null,
  owner_id              uuid not null,
  result                text not null,
  reason_code           text,
  before_content_sha256 text,
  content_sha256        text
);
alter table public.restore_audit enable row level security;
revoke all on table public.restore_audit from public, anon, authenticated, service_role; -- TRUNCATE·UPDATE·DELETE 포함 자동 권한 회수
revoke all on sequence public.restore_audit_id_seq from public, anon, authenticated, service_role;
grant select, insert on table public.restore_audit to service_role;
grant usage on sequence public.restore_audit_id_seq to service_role;

-- 감사 기록은 넣기만: 고치거나 지우면 오류
create or replace function public.restore_audit_append_only() returns trigger
  language plpgsql set search_path = '' as $$
begin
  raise exception 'restore_audit is append-only';
end $$;
drop trigger if exists restore_audit_no_change on public.restore_audit;
create trigger restore_audit_no_change before update or delete on public.restore_audit
  for each row execute function public.restore_audit_append_only();

-- 메모가 처음 들어갈 때 사본을 한 번만 남김(owner_id가 있는 메모만)
create or replace function public.notes_capture_backup() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if new.owner_id is not null then
    insert into public.notes_backup (public_id, owner_id, title, content, title_sha256, content_sha256, created_at)
    values (new.public_id, new.owner_id, coalesce(new.title, ''), coalesce(new.content, ''),
            encode(pg_catalog.sha256(convert_to(coalesce(new.title, ''), 'UTF8')), 'hex'),
            encode(pg_catalog.sha256(convert_to(coalesce(new.content, ''), 'UTF8')), 'hex'),
            new.created_at)
    on conflict (public_id) do nothing;
  end if;
  return new;
end $$;
revoke all on function public.notes_capture_backup() from public, anon, authenticated;
revoke all on function public.restore_audit_append_only() from public, anon, authenticated;
drop trigger if exists notes_capture_backup on public.notes;
create trigger notes_capture_backup after insert on public.notes
  for each row execute function public.notes_capture_backup();

commit;


-- ③ 확인 (따로 실행) --------------------------------------------------------------
-- (a) 브라우저 역할에는 권한이 없어야 합니다. service_role만 정확히 'INSERT, SELECT'가 보여야 합니다(DELETE·UPDATE·TRUNCATE가 보이면 안 됨).
select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type) as privileges
  from information_schema.role_table_grants
 where table_schema = 'public' and table_name in ('notes_backup', 'restore_audit')
   and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
 group by table_name, grantee order by table_name, grantee;
-- (b) 트리거 두 개가 보여야 합니다.
select event_object_table, trigger_name, action_timing, event_manipulation
  from information_schema.triggers
 where trigger_name in ('notes_capture_backup', 'restore_audit_no_change') order by trigger_name;
-- (c) 사본 건수(본문은 보지 않음). 이 SQL을 실행한 뒤 새로 만든 메모부터 사본이 생깁니다.
select count(*) as backup_rows from public.notes_backup;

-- ===== 선택: 이미 있던 메모의 사본 만들기 =====
-- 지금 메모가 정상(침해 전)이라고 확인했을 때만 실행하세요. 이미 변조된 상태에서 실행하면 변조된 내용이 사본이 됩니다.
-- insert into public.notes_backup (public_id, owner_id, title, content, title_sha256, content_sha256, created_at)
-- select public_id, owner_id, coalesce(title, ''), coalesce(content, ''),
--        encode(pg_catalog.sha256(convert_to(coalesce(title, ''), 'UTF8')), 'hex'),
--        encode(pg_catalog.sha256(convert_to(coalesce(content, ''), 'UTF8')), 'hex'), created_at
--   from public.notes where owner_id is not null
-- on conflict (public_id) do nothing;
