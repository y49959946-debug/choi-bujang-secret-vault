// 12단계 제작 1 · 탈환 작전실 요약 API 시험 (가짜 DB, 배포·심판 판정 아님)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { createOpsHandler } from '../api/ops.js';
import { createDeviceGate } from '../src/device-gate.mjs';
import { config as middlewareConfig } from '../middleware.js';

const repo = resolve(import.meta.dirname, '..');
const sha = (t) => createHash('sha256').update(String(t), 'utf8').digest('hex');
const A = randomUUID(); const B = randomUUID();
const verifyLogin = async (h) => ({ 'Bearer token-a': { userId: A, kind: 'student' }, 'Bearer token-b': { userId: B, kind: 'student' } })[h] ?? null;
const SECRET_TITLE = '작전실에 나오면 안 되는 제목';
const SECRET_BODY = '작전실에 나오면 안 되는 본문';

function fakeDb(t) {
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(String(input?.url ?? input));
    const table = url.pathname.replace('/rest/v1/', '');
    if ((init.method ?? 'GET') !== 'GET') return Response.json({ message: 'read only' }, { status: 405 });
    const filters = [...url.searchParams].filter(([k]) => k !== 'select');
    const cols = url.searchParams.get('select').split(',').map((c) => c.trim());
    const rows = (t[table] ?? []).filter((r) => filters.every(([k, v]) => String(r[k]) === v.slice(3)));
    return Response.json(rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]]))));
  };
  return createClient('https://fake-db.supabase.test', 'test-only-key', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchImpl } });
}

function data() {
  const day = (h) => `2026-10-15T0${h}:00:00.000Z`;
  return {
    device_credentials: [
      { id: randomUUID(), owner_id: A, credential_id: 'mem:abc', status: 'pending', created_at: day(1) },
      { id: randomUUID(), owner_id: A, credential_id: 'cred-pk', status: 'approved', created_at: day(2), approved_at: day(3) },
      { id: randomUUID(), owner_id: A, credential_id: 'mem:def', status: 'revoked', created_at: day(4) },
      { id: randomUUID(), owner_id: B, credential_id: 'cred-b', status: 'approved', created_at: day(5) },
    ],
    device_sessions: [
      { id: randomUUID(), owner_id: A, expires_at: '2099-01-01T00:00:00Z' },
      { id: randomUUID(), owner_id: A, expires_at: '2000-01-01T00:00:00Z' },
      { id: randomUUID(), owner_id: B, expires_at: '2099-01-01T00:00:00Z' },
    ],
    restore_audit: [
      { id: 1, at: day(1), run_id: randomUUID(), public_id: randomUUID(), owner_id: A, result: 'started', reason_code: 'modified' },
      { id: 2, at: day(2), run_id: randomUUID(), public_id: randomUUID(), owner_id: A, result: 'restored', reason_code: 'matches_backup' },
      { id: 3, at: day(3), run_id: randomUUID(), public_id: randomUUID(), owner_id: A, result: 'rejected', reason_code: 'no_backup_for_owner' },
      { id: 4, at: day(4), run_id: randomUUID(), public_id: randomUUID(), owner_id: B, result: 'restored', reason_code: 'matches_backup' },
    ],
    notes_backup: [
      { public_id: randomUUID(), owner_id: A, title: SECRET_TITLE, content: SECRET_BODY, title_sha256: sha(SECRET_TITLE), content_sha256: sha(SECRET_BODY), captured_at: day(1) },
      { public_id: randomUUID(), owner_id: A, title: SECRET_TITLE, content: SECRET_BODY, title_sha256: sha(SECRET_TITLE), content_sha256: sha('변조 전 다른 값'), captured_at: day(2) },
      { public_id: randomUUID(), owner_id: B, title: 'B', content: 'B', title_sha256: sha('B'), content_sha256: sha('B'), captured_at: day(3) },
    ],
  };
}

async function call(token = 'token-a', { method = 'GET', query = {}, t = data() } = {}) {
  const handler = createOpsHandler({ env: { SUPABASE_URL: 'https://fake-db.supabase.test', SUPABASE_SECRET_KEY: 'test-only-key', VERCEL_GIT_COMMIT_SHA: 'abcdef1234' },
    verifyLogin, db: fakeDb(t), log: () => {} });
  const r = { headers: {}, setHeader(k, v) { r.headers[k] = v; }, status(c) { r.code = c; return { json(b) { r.body = b; } }; } };
  await handler({ method, query, headers: token ? { authorization: `Bearer ${token}` } : {} }, r);
  return { r, t };
}

test('비로그인 401, GET 외 405, 쿼리 400', async () => {
  assert.equal((await call(null)).r.code, 401);
  assert.equal((await call('token-a', { method: 'POST' })).r.code, 405);
  assert.equal((await call('token-a', { query: { owner_id: B } })).r.code, 400, '쿼리로 다른 사람 기록을 고를 수 없음');
});

test('수치는 요청자 본인 기록만 세고, 같은 응답의 가린 기록과 맞는다', async () => {
  const { r } = await call('token-a');
  assert.equal(r.code, 200);
  const o = r.body;
  assert.deepEqual(o.revocation.counts, { total: 3, pending: 1, approved: 1, revoked: 1 });
  assert.equal(o.revocation.activeSessions, 1, '만료 세션·B 세션 제외');
  assert.equal(o.restore.audit.total, 3);
  assert.deepEqual([o.restore.audit.counts.started, o.restore.audit.counts.restored, o.restore.audit.counts.rejected], [1, 1, 1]);
  assert.deepEqual([o.restore.backups.total, o.restore.backups.hashOk], [2, 1], '해시가 맞지 않는 사본은 일치로 세지 않음');
  // 화면이 하는 것과 같은 방식으로 기록에서 다시 세기
  const recount = (rows, key, value) => rows.filter((x) => x[key] === value).length;
  for (const s of ['pending', 'approved', 'revoked']) assert.equal(recount(o.revocation.records, 'status', s), o.revocation.counts[s]);
  for (const s of ['started', 'restored', 'rejected']) assert.equal(recount(o.restore.audit.records, 'result', s), o.restore.audit.counts[s]);
  assert.equal(o.restore.backups.records.filter((b) => b.hashOk).length, o.restore.backups.hashOk);
  assert.deepEqual(o.consistency, { devices: true, audit: true, backups: true, decider: true });
});

test('메모 본문·제목·전체 ID·토큰을 돌려주지 않는다(ID는 앞 8자리)', async () => {
  const { r, t } = await call('token-a');
  const json = JSON.stringify(r.body);
  assert.equal(json.includes(SECRET_TITLE) || json.includes(SECRET_BODY), false, '본문·제목 없음');
  for (const row of [...t.device_credentials, ...t.restore_audit, ...t.notes_backup]) {
    for (const v of [row.id, row.public_id, row.run_id, row.owner_id]) if (typeof v === 'string' && v.length > 8) assert.equal(json.includes(v), false, '전체 ID 없음');
  }
  assert.equal(json.includes('token-a'), false);
  assert.equal(json.includes('cred-pk'), false, '패스키 자격 ID 없음');
  assert.ok(r.body.revocation.records.every((d) => d.id8.length === 8));
});

test('출처를 구분한다: DB 기록·서버 실행·배포 고정 값·미실행', async () => {
  const o = (await call('token-a')).r.body;
  assert.equal(o.decider.source, 'server_run');
  assert.equal(o.detection.practice.source, 'server_run');
  assert.equal(o.detection.live.source, 'not_run');
  assert.equal(o.revocation.source, 'db');
  assert.equal(o.revocation.detectorLink.source, 'not_run');
  assert.equal(o.restore.policyBaseline.source, 'build');
  assert.equal(o.restore.policyBaseline.verification.source, 'not_run');
  assert.equal(o.restore.backups.source, 'db');
  assert.equal(o.restore.audit.source, 'db');
  assert.deepEqual([o.deployment.commit7, o.deployment.step], ['abcdef1', JSON.parse(readFileSync(join(repo, 'aleph.config.json'), 'utf8')).step]);
});

test('판정기·탐지기를 서버에서 실제로 실행한 결과가 기대와 맞는다(규칙 이름은 RULE_IDS 안)', async () => {
  const o = (await call('token-a')).r.body;
  assert.equal(o.decider.matched, o.decider.total);
  assert.ok(o.decider.total >= 9);
  assert.ok(o.decider.probes.every((p) => p.ruleIds.every((id) => o.decider.ruleIds.includes(id))));
  assert.equal(o.detection.practice.matched, o.detection.practice.total);
});

test('B는 A의 기록을 볼 수 없다(각자 자기 기록만)', async () => {
  const o = (await call('token-b')).r.body;
  assert.deepEqual([o.revocation.counts.total, o.restore.audit.total, o.restore.backups.total], [1, 1, 1]);
});

test('작전실 API도 앞단에서 승인 기기 서명을 요구한다', async () => {
  assert.ok(middlewareConfig.matcher.includes('/api/ops'));
  const gate = createDeviceGate({ verifyLogin, db: fakeDb(data()), log: () => {} });
  const res = await gate(new Request('https://app.example/api/ops', { headers: { authorization: 'Bearer token-a' } }));
  assert.equal(res?.status, 403);
  assert.equal((await res.json()).error, 'DEVICE_PROOF_REQUIRED');
  assert.equal(await gate(new Request('https://app.example/api/ops')), null, '토큰 없으면 함수가 401');
});

test('화면: 작전실은 승인 뒤에만 열고, 값은 textContent로만 넣는다(성공 문구 없이 응답 값 표시)', () => {
  const html = readFileSync(join(repo, 'public/index.html'), 'utf8');
  assert.match(html, /<section class="ops" id="ops" hidden/u);
  assert.match(html, /async function loadOps\(\) \{\s*if \(!device\.proof\) \{ hideOps\(\); return; \}/u);
  assert.match(html, /function closeVault\(\) \{ editor\.hidden = true; hideOps\(\);/u);
  assert.doesNotMatch(html, /innerHTML/u);
  assert.match(html, /o\?\.schema !== 'byteback\.ops\.v1'/u);
});
