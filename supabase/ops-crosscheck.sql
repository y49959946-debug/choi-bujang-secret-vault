-- BYTE BACK 12단계: 탈환 작전실 수치 대조용 읽기 전용 쿼리(본문·제목·전체 ID를 보지 않음)
-- 작전실 화면 위쪽의 「내 소유자 키 앞자리」(8자리)를 아래 '<앞자리>'에 넣고, Supabase SQL Editor에서 하나씩 실행합니다.
-- (SQL Editor는 여러 쿼리를 한 번에 돌리면 마지막 결과만 보여 줍니다.)

-- ① 회수 상태: 화면 「회수 상태」의 내 기기(전체)·승인 대기·승인·회수와 같아야 합니다.
select count(*) as total,
       count(*) filter (where status = 'pending')  as pending,
       count(*) filter (where status = 'approved') as approved,
       count(*) filter (where status = 'revoked')  as revoked
  from public.device_credentials
 where owner_id::text like '<앞자리>%';

-- ② 유효한 기기 세션: 화면 「유효한 기기 세션」과 같아야 합니다.
select count(*) as active_sessions
  from public.device_sessions
 where owner_id::text like '<앞자리>%' and expires_at > now();

-- ③ 복구 감사 기록: 화면 「복구 감사 기록(실행 수)」·「복원 성공·거부·실패」와 같아야 합니다.
select count(*) as total, count(distinct run_id) as runs,
       count(*) filter (where result = 'restored') as restored,
       count(*) filter (where result = 'rejected') as rejected,
       count(*) filter (where result in ('failed', 'verify_failed')) as failed,
       max(at) as last_at
  from public.restore_audit
 where owner_id::text like '<앞자리>%';

-- ④ 메모 사본 해시 일치: 화면 「메모 사본 해시 일치」(일치 / 전체)와 같아야 합니다.
select count(*) as total,
       count(*) filter (where encode(pg_catalog.sha256(convert_to(content, 'UTF8')), 'hex') = content_sha256
                          and encode(pg_catalog.sha256(convert_to(title, 'UTF8')), 'hex') = title_sha256) as hash_ok
  from public.notes_backup
 where owner_id::text like '<앞자리>%';
