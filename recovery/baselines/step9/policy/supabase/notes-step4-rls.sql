-- BYTE BACK 4단계: public.notes 에 RLS와 최소 권한을 적용합니다.
-- 대상은 public.notes 한 테이블뿐입니다. 다른 테이블·시퀀스·service_role 권한은 바꾸지 않습니다.
-- 키·이메일·메모 본문은 이 파일에 없습니다. SQL Editor에서 ①→②→③ 순서로 따로 실행하세요.


-- ① 적용 전 권한 확인 ------------------------------------------------------
-- (a) 실제로 부여된 권한 목록
select grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'notes'
   and grantee in ('PUBLIC', 'anon', 'authenticated')
 order by grantee, privilege_type;

-- (b) 두 역할이 실제로 가진 권한(상속 포함)
select r.role,
       has_table_privilege(r.role, 'public.notes', 'SELECT')     as "SELECT",
       has_table_privilege(r.role, 'public.notes', 'INSERT')     as "INSERT",
       has_table_privilege(r.role, 'public.notes', 'UPDATE')     as "UPDATE",
       has_table_privilege(r.role, 'public.notes', 'DELETE')     as "DELETE",
       has_table_privilege(r.role, 'public.notes', 'TRUNCATE')   as "TRUNCATE",
       has_table_privilege(r.role, 'public.notes', 'REFERENCES') as "REFERENCES",
       has_table_privilege(r.role, 'public.notes', 'TRIGGER')    as "TRIGGER"
  from (values ('anon'), ('authenticated')) as r(role);

-- (c) RLS 켜짐 여부와 현재 정책
select relname, relrowsecurity, relforcerowsecurity from pg_class where oid = 'public.notes'::regclass;
select policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'public' and tablename = 'notes';


-- ② 적용 ------------------------------------------------------------------
begin;

alter table public.notes enable row level security;

-- 기존 권한 회수 후 authenticated에만 네 가지 권한
revoke all on table public.notes from public, anon, authenticated;
grant select, insert, update, delete on table public.notes to authenticated;

-- 여러 번 실행해도 되도록 같은 이름의 정책은 지우고 다시 만듭니다.
drop policy if exists notes_select_own on public.notes;
drop policy if exists notes_insert_own on public.notes;
drop policy if exists notes_update_own on public.notes;
drop policy if exists notes_delete_own on public.notes;

-- (select auth.uid())는 auth.uid()와 같은 값이며, 행마다 다시 계산하지 않도록 한 번만 평가하는 Supabase 권장 형태입니다.
-- 기존 행 조건(USING)
create policy notes_select_own on public.notes
  for select to authenticated
  using ((select auth.uid()) = owner_id);

-- 새 행 조건(WITH CHECK)
create policy notes_insert_own on public.notes
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

-- 기존 행 USING + 새 행 WITH CHECK: 남의 행은 못 고치고, 내 행을 남에게 넘길 수도 없습니다.
create policy notes_update_own on public.notes
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

-- 기존 행 조건(USING)
create policy notes_delete_own on public.notes
  for delete to authenticated
  using ((select auth.uid()) = owner_id);

commit;


-- ③ 적용 후 권한 확인 ------------------------------------------------------
-- ①의 (a)·(b)·(c)를 그대로 다시 실행해 아래와 같은지 봅니다.
--   (a) anon 줄 없음, PUBLIC 줄 없음, authenticated는 DELETE·INSERT·SELECT·UPDATE 네 줄만
--   (b) anon: 일곱 칸 모두 false
--       authenticated: SELECT·INSERT·UPDATE·DELETE만 true, TRUNCATE·REFERENCES·TRIGGER는 false
--   (c) relrowsecurity = true, 정책 네 개(SELECT·INSERT·UPDATE·DELETE)
--       UPDATE 정책만 qual(USING)과 with_check가 둘 다 채워져 있어야 합니다.
