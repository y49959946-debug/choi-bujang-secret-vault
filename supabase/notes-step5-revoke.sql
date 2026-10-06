-- BYTE BACK 5단계: 브라우저(공개 키·로그인 토큰)로 public.notes를 직접 부르는 길을 닫습니다.
-- 대상은 public.notes 한 테이블뿐입니다. service_role(서버 함수가 쓰는 서버 전용 키) 권한과 다른 테이블은 바꾸지 않습니다.
-- 4단계 RLS 정책 네 개는 그대로 둡니다. 권한이 없으면 쓰이지 않지만, 실수로 권한이 다시 생겨도 본인 행만 열리게 하는 안전장치로 남깁니다.
-- 키·이메일·메모 본문은 이 파일에 없습니다.

-- ① 적용 전·후 확인 (같은 쿼리를 적용 전에 한 번, 적용 후에 한 번 실행)
select '1 grants' as 구분, grantee as 역할, string_agg(privilege_type, ', ' order by privilege_type) as 값
  from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'notes'
   and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
 group by grantee
union all
select '2 has_table_privilege', r.role,
       coalesce(nullif(concat_ws(', ',
         case when has_table_privilege(r.role, 'public.notes', 'SELECT')     then 'SELECT' end,
         case when has_table_privilege(r.role, 'public.notes', 'INSERT')     then 'INSERT' end,
         case when has_table_privilege(r.role, 'public.notes', 'UPDATE')     then 'UPDATE' end,
         case when has_table_privilege(r.role, 'public.notes', 'DELETE')     then 'DELETE' end,
         case when has_table_privilege(r.role, 'public.notes', 'TRUNCATE')   then 'TRUNCATE' end,
         case when has_table_privilege(r.role, 'public.notes', 'REFERENCES') then 'REFERENCES' end,
         case when has_table_privilege(r.role, 'public.notes', 'TRIGGER')    then 'TRIGGER' end), ''), '(권한 없음)')
  from (values ('anon'), ('authenticated'), ('service_role')) as r(role)
union all
select '3 RLS', 'notes', relrowsecurity::text from pg_class where oid = 'public.notes'::regclass
union all
select '4 policy', policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'notes'
order by 1, 2;


-- ② 적용 (begin부터 commit까지 한 묶음)
begin;
alter table public.notes enable row level security;
revoke all on table public.notes from public, anon, authenticated;
commit;
