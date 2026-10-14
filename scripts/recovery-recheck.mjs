// npm run recovery:recheck [-- --live]
// 10단계 · 복구 뒤 재시험: 사전 백업을 다시 읽어 검증하고, 시험 계정 B의 메모를 변조·삭제한 뒤 복구 경로로 되돌린 직후
// 1~9단계의 정상 요청과 금지 요청을 다시 보냅니다.
//   - 기본: 로컬에서만 실행합니다(가짜 DB·가짜 서명 키). 실제 Supabase·배포·심판에는 접속하지 않습니다.
//   - --live: 추가로 배포 주소에 토큰 없는 GET 세 개(/data.json, /api/notes, /api/notes/<예시 ID>)만 보내 상태 코드를 봅니다.
//   - 실행하지 않은 시험은 '미실행'으로 표시합니다. 통과로 바꾸어 적지 않습니다.
// 메모 본문·토큰·키는 출력하지 않습니다. 이 결과는 로컬 연습이며 심판 판정이 아닙니다.
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createFakeVault, fakeVaultReady, sha256 } from './fake-vault.mjs';
import { fixtureRequests } from './fixture-7.mjs';
import { verifyBaseline, diffPolicy } from '../src/policy-diff.mjs';
import { decide, RULE_IDS } from '../src/decider.mjs';
import { detect } from '../src/detect.mjs';
import { runAttackChecks } from '../src/attack-check.mjs';

const RESTORE_ROUTE = 'POST /api/restore';

export async function runRecoveryRecheck(root, { live = false } = {}) {
  root = resolve(root);
  const results = [];
  const add = (group, name, status, note = '') => results.push({ group, name, status, note });
  const check = (group, name, ok, note = '') => add(group, name, ok ? '통과' : '실패', note);

  // ── 0. 사전 백업(정책 사본)을 다시 읽어 검증 ─────────────────────────
  const G0 = '0 사전 백업 검증';
  const baseline = verifyBaseline(root);
  // 지문과 기준 커밋 대조가 모두 돼야 통과입니다. Git 기록이 없어 지문만 확인했으면 '부분 확인'입니다.
  add(G0, '정책 사본을 다시 읽어 형식·지문·기준 커밋 내용 대조',
    !baseline.ok ? '실패' : baseline.provenance === 'git_commit_verified' ? '통과' : '부분 확인',
    !baseline.ok ? baseline.reason : baseline.provenance === 'git_commit_verified' ? '지문 + 기준 커밋 대조' : '지문만 확인, Git 기록에 기준 커밋 없음');

  // ── 1. 정책이 돌아왔는가: 사본과 다른 곳이 복구 경로 등록뿐인지 ─────
  const G1 = '1 정책 복귀';
  const report = diffPolicy(root);
  if (report.status === 'INVALID_BASELINE') {
    add(G1, '현재 정책과 사본 비교', '실패', '사본 검증 실패로 비교하지 않음');
  } else {
    const unexpected = report.changes.filter((c) => !(
      (c.field === 'allowedRoutes' && c.removed.length === 0 && c.added.length === 1 && c.added[0] === RESTORE_ROUTE)
      || (c.field === 'restoreRoute' && c.current === RESTORE_ROUTE)));
    check(G1, '현재 정책이 사본과 같음(차이는 10단계 복구 경로 등록뿐)', unexpected.length === 0,
      unexpected.length ? `예상 밖 차이: ${unexpected.map((c) => c.field ?? c.path).join(', ')} → npm run policy:restore 로 미리보기` : `차이 ${report.changes.length}곳 모두 복구 경로 등록`);
  }

  // 1·2단계 정적 공개 자료: 저장소와 빌드 결과에 공개 메모 파일이 없어야 합니다.
  const publicFiles = existsSync(join(root, 'public')) ? readdirSync(join(root, 'public')) : [];
  check(G1, '1·2단계: 공개 data.json이 저장소·public에 없음', !existsSync(join(root, 'data.json')) && !publicFiles.includes('data.json'));
  const leak = publicFiles.filter((f) => /\.(html|js|json|css)$/u.test(f))
    .some((f) => /service_role|sb_secret_|SUPABASE_SECRET_KEY/u.test(readFileSync(join(root, 'public', f), 'utf8')));
  check(G1, '2단계: 브라우저 파일(public)에 서버 전용 키 이름·값 모양 없음', !leak);

  // ── 2·3. 시험 계정 B 메모 변조·삭제 뒤 복구, 그 직후 1~9단계 재시험 (로컬 가짜 DB) ──
  const G2 = '2 B 메모 복구';
  const G3 = '3 복구 직후 금지 요청';
  const G4 = '4 복구 직후 정상 요청';
  if (!fakeVaultReady(root)) {
    for (const [g, n] of [[G2, '변조·삭제 뒤 복구'], [G3, '1~9단계 금지 요청'], [G4, '정상 요청']]) add(g, n, '미실행', 'node_modules 없음: npm install 뒤 다시 실행');
  } else {
    const env = await createFakeVault(root);
    try {
      // 심판처럼 시험 계정 A·B가 같은 sub·run을 함께 쓰는 토큰으로 시험합니다.
      const sub = randomUUID(); const run = randomUUID();
      const ta = await env.judgeToken(sub, run, 'a');
      const tb = await env.judgeToken(sub, run, 'b');
      const aNote = (await env.notes('POST', '/api/notes', ta, { title: 'A의 가상 메모', body: 'A 가상 내용' })).body?.id;
      const b1 = (await env.notes('POST', '/api/notes', tb, { title: 'B 가상 메모 1', body: 'B 침해 전 가상 내용 1' })).body?.id;
      const b2 = (await env.notes('POST', '/api/notes', tb, { title: 'B 가상 메모 2', body: 'B 침해 전 가상 내용 2' })).body?.id;
      const backupBefore = JSON.stringify(env.db.notes_backup);
      const row = (id) => env.db.notes.find((n) => n.public_id === id);
      const backup = (id) => env.db.notes_backup.find((b) => b.public_id === id);
      const others = (id) => JSON.stringify(env.db.notes.filter((n) => n.public_id !== id));
      const sameAsBackup = (id) => { const r = row(id); const b = backup(id);
        return Boolean(r && b && r.public_id === b.public_id && r.owner_id === b.owner_id && sha256(r.content) === b.content_sha256 && sha256(r.title) === b.title_sha256); };

      // 변조 → 복구
      await env.notes('PUT', `/api/notes/${b1}`, tb, { title: '변조', body: '변조된 가상 내용' });
      check(G2, '변조 확인: B 메모 1이 사본과 달라짐', !sameAsBackup(b1));
      let keep = others(b1);
      let r = await env.restore('POST', '/api/restore', tb, { id: b1 });
      check(G2, '변조 뒤 복구: 200, verified의 ID·소유자·내용 해시 모두 true', r.code === 200 && r.body?.restored === true
        && r.body?.verified?.id === true && r.body?.verified?.owner === true && r.body?.verified?.contentHash === true, `HTTP ${r.code}`);
      check(G2, '변조 뒤 복구: 쓰기 직전 사본을 다시 읽어 검증, 사본 버전·바뀐 칸을 응답', r.body?.backupReread === true
        && Boolean(r.body?.backupVersion?.capturedAt) && JSON.stringify(r.body?.changes) === '["title","content"]');
      check(G2, '변조 뒤 복구: 그 한 건의 ID·소유자·제목·내용 해시가 사본과 같음', sameAsBackup(b1));
      check(G2, '변조 뒤 복구: 다른 메모는 그대로', others(b1) === keep);
      check(G2, '복구 응답에 메모 본문 없음', !JSON.stringify(r.body).includes('침해 전'));

      // 삭제 → 복구
      await env.notes('DELETE', `/api/notes/${b2}`, tb);
      check(G2, '삭제 확인: B 메모 2가 지워짐', !row(b2));
      keep = JSON.stringify(env.db.notes);
      r = await env.restore('POST', '/api/restore', tb, { id: b2 });
      check(G2, '삭제 뒤 복구: 200, verified 모두 true', r.code === 200 && r.body?.restored === true
        && r.body?.verified?.contentHash === true, `HTTP ${r.code}`);
      check(G2, '삭제 뒤 복구: 한 건만 다시 들어가고 ID·소유자·해시가 사본과 같음',
        sameAsBackup(b2) && env.db.notes.length === JSON.parse(keep).length + 1);
      r = await env.restore('POST', '/api/restore', tb, { id: b2 });
      check(G2, '같은 복구를 다시 보내면 restored:false, 한 건만 유지', r.code === 200 && r.body?.restored === false
        && env.db.notes.filter((n) => n.public_id === b2).length === 1);

      // 사전 백업(메모 사본)을 다시 읽어 검증
      check(G0, '메모 사본을 다시 읽어 제목·내용 해시 재계산 일치(가짜 DB)', env.db.notes_backup.length === 3
        && env.db.notes_backup.every((b) => sha256(b.title) === b.title_sha256 && sha256(b.content) === b.content_sha256));
      check(G0, '복구 전후로 메모 사본이 바뀌지 않음', JSON.stringify(env.db.notes_backup) === backupBefore);
      check(G0, '감사 기록은 덧붙이기만, 본문 없음', env.db.restore_audit.length >= 4
        && env.db.restore_audit.every((a, i) => a.id === i + 1) && !JSON.stringify(env.db.restore_audit).includes('침해 전'));

      // ── 복구 직후 금지 요청 (이전 단계에서 막던 공격을 다시 보냄) ──
      const snapshot = JSON.stringify(env.db.notes);
      const forged = await env.judgeToken(sub, run, 'b', { key: env.strangerKey });
      const expired = await env.judgeToken(sub, run, 'b', { exp: env.now - 60, iat: env.now - 700 });
      const studentForged = await env.studentToken(randomUUID(), { key: env.strangerKey });
      const wrongIssuer = await env.judgeToken(sub, run, 'b', { iss: 'https://attacker.example.com/defense/judge' });
      const wrongAudience = await env.judgeToken(sub, run, 'b', { aud: 'other-app.vercel.app' });
      const studentWrongAud = await env.studentToken(randomUUID(), { aud: 'anon' });
      const forbidden = [
        ['3단계: 토큰 없이 메모 한 건 조회 → 401', () => env.notes('GET', `/api/notes/${b1}`), 401],
        ['3단계: 토큰 없이 메모 목록 → 401', () => env.notes('GET', '/api/notes'), 401],
        ['3단계: 서명 위조 토큰(심판 형식) → 401', () => env.notes('GET', `/api/notes/${b1}`, forged), 401],
        ['3단계: 서명 위조 토큰(학생 형식) → 401', () => env.notes('GET', `/api/notes/${b1}`, studentForged), 401],
        ['3단계: 다른 발급자 토큰 → 401', () => env.notes('GET', `/api/notes/${b1}`, wrongIssuer), 401],
        ['3단계: 다른 앱 대상(aud) 심판 토큰 → 401', () => env.notes('GET', `/api/notes/${b1}`, wrongAudience), 401],
        ['3단계: 대상(aud)이 다른 학생 토큰 → 401', () => env.notes('GET', `/api/notes/${b1}`, studentWrongAud), 401],
        ['3단계: 만료 토큰 → 401', () => env.notes('GET', `/api/notes/${b1}`, expired), 401],
        ['4단계: A가 복구된 B 메모 조회 → 403', () => env.notes('GET', `/api/notes/${b1}`, ta), 403],
        ['4단계: A가 복구된 B 메모 수정 → 403', () => env.notes('PUT', `/api/notes/${b1}`, ta, { title: 'x', body: 'y' }), 403],
        ['4단계: A가 복구된 B 메모 삭제 → 403', () => env.notes('DELETE', `/api/notes/${b2}`, ta), 403],
        ['4·10단계: A가 B 메모 복구 요청 → 404', () => env.restore('POST', '/api/restore', ta, { id: b1 }), 404],
        ['8단계: 쿼리로 소유자 지정(?owner_id=) → 400', () => env.notes('GET', `/api/notes/${b1}`, ta, undefined, { id: b1, owner_id: 'x' }), 400],
        ['8단계: 본문 role로 권한 올리기 → 403', () => env.notes('POST', '/api/notes', ta, { title: 't', body: 'b', role: 'instructor' }), 403],
        ['4단계: 본문 owner_id로 남을 주인 지정 → 403', () => env.notes('POST', '/api/notes', ta, { title: 't', body: 'b', owner_id: randomUUID() }), 403],
        ['10단계: 복구 요청에 owner_id 칸 → 400', () => env.restore('POST', '/api/restore', ta, { id: b1, owner_id: 'x' }), 400],
        ['10단계: 토큰 없이 복구 요청 → 401', () => env.restore('POST', '/api/restore', null, { id: b1 }), 401],
        ['10단계: GET으로 복구 경로 → 405', () => env.restore('GET', '/api/restore', tb), 405],
      ];
      for (const [name, send, expected] of forbidden) {
        const res = await send();
        check(G3, name, res.code === expected, `HTTP ${res.code}`);
      }
      const list = await env.notes('GET', '/api/notes', ta);
      check(G3, '4단계: A 목록에 B 메모 없음', list.code === 200 && Array.isArray(list.body) && !list.body.some((n) => n.id === b1 || n.id === b2));
      check(G3, '금지 요청 뒤 메모 자료가 바뀌지 않음', JSON.stringify(env.db.notes) === snapshot);
      check(G3, '복구된 B 메모 두 건이 여전히 사본과 같음', sameAsBackup(b1) && sameAsBackup(b2));

      // ── 복구 직후 정상 요청 ──
      r = await env.notes('GET', `/api/notes/${b1}`, tb);
      check(G4, 'B가 복구한 메모 1 조회 → 200, 내용 해시가 사본과 같음', r.code === 200 && sha256(r.body?.body) === backup(b1).content_sha256, `HTTP ${r.code}`);
      r = await env.notes('GET', `/api/notes/${b2}`, tb);
      check(G4, 'B가 복구한 메모 2 조회 → 200', r.code === 200, `HTTP ${r.code}`);
      r = await env.notes('GET', '/api/notes', tb);
      check(G4, 'B 목록에 복구한 두 건이 있음', r.code === 200 && [b1, b2].every((id) => r.body?.some((n) => n.id === id)));
      r = await env.notes('GET', `/api/notes/${aNote}`, ta);
      check(G4, 'A 본인 메모 조회 → 200', r.code === 200, `HTTP ${r.code}`);
      r = await env.notes('PUT', `/api/notes/${aNote}`, ta, { title: 'A 고침', body: 'A 고친 가상 내용' });
      check(G4, 'A 본인 메모 수정 → 200', r.code === 200, `HTTP ${r.code}`);
      r = await env.notes('POST', '/api/notes', ta, { title: 'A 새 메모', body: '새 가상 내용' });
      const created = r.body?.id;
      check(G4, 'A 메모 추가 → 201', r.code === 201 && created, `HTTP ${r.code}`);
      r = await env.notes('DELETE', `/api/notes/${created}`, ta);
      check(G4, 'A 메모 삭제 → 204', r.code === 204, `HTTP ${r.code}`);

      // 사본 변조 시 거부(검증 실패 경로): 별도 메모로 시험해 위 결과에 섞이지 않게 합니다.
      const b3 = (await env.notes('POST', '/api/notes', tb, { title: 'B 가상 메모 3', body: 'B 침해 전 가상 내용 3' })).body?.id;
      await env.notes('PUT', `/api/notes/${b3}`, tb, { title: '변조', body: '변조된 가상 내용' });
      backup(b3).content = '사본 변조';
      const beforeTamper = JSON.stringify(env.db.notes);
      r = await env.restore('POST', '/api/restore', tb, { id: b3 });
      check(G2, '사본이 변조돼 해시가 틀리면 409, 메모를 한 건도 바꾸지 않음', r.code === 409
        && r.body?.error === 'BACKUP_INTEGRITY_FAILED' && JSON.stringify(env.db.notes) === beforeTamper, `HTTP ${r.code}`);
    } catch (error) {
      add(G2, `실행 오류: ${error?.message ?? 'unknown'}`, '실패');
    } finally {
      env.close();
    }
  }

  // ── 판정기(6·7·8단계)와 탐지(9단계) 금지·정상 요청 ──
  const { normal, suspicious } = fixtureRequests();
  const req = (over) => ({ ...normal, requestId: randomUUID(), ...over });
  const validShape = (input, out) => out && Object.keys(out).sort().join(',') === 'decision,reasonCode,requestId,ruleIds,schema'
    && out.schema === 'aleph.decision.v1' && out.requestId === input.requestId
    && Array.isArray(out.ruleIds) && out.ruleIds.length > 0 && out.ruleIds.every((id) => RULE_IDS.includes(id));
  const deciderCases = [
    [G3, '6단계: 미등록 기기 → deny device_not_registered', req({ deviceRegistered: false }), 'deny', 'device_not_registered'],
    [G3, '6단계: 기기 등록 칸 없음 → deny device_not_registered', (({ deviceRegistered, ...rest }) => ({ ...rest, requestId: randomUUID() }))(normal), 'deny', 'device_not_registered'],
    [G3, '6단계: 기기 등록을 문자열 "true"로 위장 → deny', req({ deviceRegistered: 'true' }), 'deny', 'device_not_registered'],
    [G3, '6단계: 확인된 기기 ID 없음 → deny', (({ deviceId, ...rest }) => ({ ...rest, requestId: randomUUID() }))(normal), 'deny', 'device_not_registered'],
    [G3, '7단계: 복합 이상 접속 → step_up', { ...suspicious, requestId: randomUUID() }, 'step_up', 'step_up_required'],
    [G3, '8단계: 메모 전체 목록 GET /notes → deny', req({ path: '/notes', route: 'GET /notes' }), 'deny', 'route_not_allowed'],
    [G3, '8단계: 기능 경로 GET /notes/export → deny', req({ path: '/notes/export', route: 'GET /notes/:id' }), 'deny', 'route_not_allowed'],
    [G3, '8단계: 쿼리 붙은 요청 → deny', req({ queryLength: 12 }), 'deny', 'route_not_allowed'],
    [G3, '8단계: 반 공지 수정 PUT /notices/n1 → deny', req({ method: 'PUT', path: '/notices/n1', route: 'PUT /notices/:id' }), 'deny', 'notice_write_denied'],
    [G3, '8단계: 반 공지 PATCH /notices/n1 → deny', req({ method: 'PATCH', path: '/notices/n1', route: 'PATCH /notices/:id' }), 'deny', 'notice_write_denied'],
    [G3, '8단계: 메모 PATCH(열지 않은 메서드) → deny', req({ method: 'PATCH', route: 'PATCH /notes/:id' }), 'deny', 'starter_not_ready'],
    [G3, '8단계: path와 route 불일치 → deny', req({ path: '/notices/n1' }), 'deny', 'route_not_allowed'],
    [G3, '8단계: 알 수 없는 경로 GET /admin → deny', req({ path: '/admin', route: 'GET /admin' }), 'deny', 'route_not_allowed'],
    [G3, '8단계: 강사 자료 삭제 DELETE /materials/m1 → deny', req({ method: 'DELETE', path: '/materials/m1', route: 'DELETE /materials/:id' }), 'deny', 'material_write_denied'],
    [G4, '6·8단계: 등록 기기의 메모 한 건 읽기 → allow', req({}), 'allow', 'approved'],
    [G4, '8단계: 반 공지 읽기 GET /notices → allow', req({ path: '/notices', route: 'GET /notices' }), 'allow', 'approved'],
    [G4, '7단계: 방금 다시 확인한 복합 이상 접속 → allow', { ...suspicious, requestId: randomUUID(), stepUp: { verified: true, authAgeSeconds: 60 } }, 'allow', 'approved'],
  ];
  for (const [group, name, input, decision, reasonCode] of deciderCases) {
    const out = await decide(input);
    check(group, name, validShape(input, out) && out.decision === decision && out.reasonCode === reasonCode, `${out?.decision} · ${out?.reasonCode}`);
  }
  const start = Date.UTC(2026, 9, 1, 3, 0, 0);
  const events = (count, network, device) => Array.from({ length: count }, (_, i) => ({
    at: new Date(start + i * 2000).toISOString(), subjectId: 'learner_fixture', deviceId: device, method: 'GET', decision: 'allow',
    signals: { source: 'judge_fixture', network },
  }));
  const burst = detect([...events(121, 'unusual', 'b'.repeat(16)), ...events(20, 'usual', 'c'.repeat(16))]);
  check(G3, '9단계: 낯선 네트워크 121건 조회 → 그 기기 하나만 회수 제안', burst.action === 'propose_revocation'
    && burst.reasonCode === 'burst_read' && burst.deviceId === 'b'.repeat(16), burst.action);
  const calm = detect(events(30, 'usual', 'c'.repeat(16)));
  check(G4, '9단계: 평소 네트워크 조회 30건 → observe', calm.action === 'observe', calm.action);

  // ── 실행하지 않은(또는 이 명령으로 할 수 없는) 시험 ──
  const G5 = '5 배포·실제 서비스';
  if (live) {
    try {
      const config = JSON.parse(readFileSync(join(root, 'aleph.config.json'), 'utf8'));
      for (const item of await runAttackChecks(config)) {
        const status = item.observed.includes('막힘') ? '통과' : item.observed.includes('미확인') ? '미실행' : '실패';
        add(G5, `배포 실측: ${item.expected}`, status, item.observed);
      }
    } catch (error) {
      add(G5, '배포 실측(토큰 없는 GET 세 개)', '미실행', error?.message ?? 'unknown');
    }
  } else {
    add(G5, '배포 실측: /data.json 404, 토큰 없는 /api/notes·한 건 401', '미실행', '-- --live 로 실행');
  }
  add(G5, '실제 Supabase 메모 사본 다시 읽기', '미실행', 'SQL Editor에서 notes-step10-restore.sql ③ 확인 쿼리로 직접 확인');
  add(G5, '배포에서 B 메모 변조·삭제 뒤 POST /api/restore', '미실행', 'README 10단계 확인 순서대로 B 계정으로 직접');
  add(G5, '5단계: 브라우저 키로 Supabase 직접 호출 거부', '미실행', 'notes-step5-revoke.sql ① 권한 확인 쿼리로 직접 확인');
  add(G5, '7단계: 실제 재로그인 전 차단·새 로그인 뒤 허용', '미실행', '제공 엔진 없음');
  add(G5, '9단계: 실제 기기 회수와 걸린 시간', '미실행', '엔진·심판이 확인');
  add(G5, '심판 판정', '미실행', '포털 제출 뒤 확인');
  return results;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const results = await runRecoveryRecheck(resolve(import.meta.dirname, '..'), { live: process.argv.includes('--live') });
  let group = '';
  for (const item of results.sort((a, b) => a.group.localeCompare(b.group))) {
    if (item.group !== group) { group = item.group; process.stdout.write(`\n[${group}]\n`); }
    process.stdout.write(`${item.status} · ${item.name}${item.note ? ` (${item.note})` : ''}\n`);
  }
  const count = (s) => results.filter((r) => r.status === s).length;
  process.stdout.write(`\n통과 ${count('통과')} · 부분 확인 ${count('부분 확인')} · 실패 ${count('실패')} · 미실행 ${count('미실행')}\n`);
  process.stdout.write('가짜 DB·가상 요청으로 한 로컬 재시험입니다. 미실행 항목은 결과가 없으며 심판 판정이 아닙니다.\n');
  if (count('실패') > 0) process.exitCode = 1;
}
