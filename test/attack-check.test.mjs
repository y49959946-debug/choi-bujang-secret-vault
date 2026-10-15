// 12단계 · 자기 점검(src/attack-check.mjs): 제출한 배포 주소로만, 세 요청을 차례대로, observed에는 받은 HTTP 상태만(못 받으면 not_run)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runAttackChecks } from '../src/attack-check.mjs';

const repo = resolve(import.meta.dirname, '..');
const config = JSON.parse(readFileSync(join(repo, 'aleph.config.json'), 'utf8'));
const SUBMITTED = new URL(config.publicAppUrl).origin;
const withFetch = async (impl, fn) => { const real = globalThis.fetch; globalThis.fetch = impl; try { return await fn(); } finally { globalThis.fetch = real; } };

test('요청이 끝나지 않으면(네트워크 차단) 세 점검 모두 observed 가 not_run 이다', async () => {
  const rows = await withFetch(async () => { throw new TypeError('fetch failed'); }, () => runAttackChecks(config));
  assert.deepEqual(rows.map((r) => r.attackId), ['anonymous_note_read', 'anonymous_note_list', 'anonymous_other_note_read']);
  for (const r of rows) assert.equal(r.observed, 'not_run');
});

test('제출한 배포 주소로 세 GET 요청만, 하나씩 차례대로 보내고 받은 HTTP 상태만 적는다', async () => {
  const sent = [];
  let inFlight = 0; let maxInFlight = 0;
  const rows = await withFetch(async (url, init) => {
    const u = new URL(url);
    inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
    sent.push({ origin: u.origin, path: u.pathname, search: u.search, method: init?.method ?? 'GET', credentials: init?.credentials });
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    return new Response(null, { status: u.pathname === '/data.json' ? 404 : 401, headers: { 'x-vercel-id': 'icn1::abc12-1' } });
  }, () => runAttackChecks(config));
  assert.deepEqual(sent.map((s) => s.path), ['/data.json', '/api/notes', '/api/notes/00000000-0000-4000-8000-000000000001'], '다른 요청(/aleph.json 등)을 보내지 않음');
  for (const s of sent) { assert.equal(s.origin, SUBMITTED); assert.equal(s.search, ''); assert.equal(s.method, 'GET'); assert.equal(s.credentials, 'omit'); }
  assert.equal(maxInFlight, 1, '동시에 둘 이상 보내지 않음');
  assert.deepEqual(rows.map((r) => r.observed), ['HTTP 404', 'HTTP 401', 'HTTP 401']);
});

test('기대와 다른 상태도 받은 그대로, 다른 글 없이 적는다', async () => {
  const rows = await withFetch(async () => new Response(null, { status: 200 }), () => runAttackChecks(config));
  for (const r of rows) assert.equal(r.observed, 'HTTP 200');
  for (const r of rows) assert.match(r.observed, /^(HTTP [1-5]\d\d|not_run)$/u);
});

test('일부만 응답을 받으면 받은 것만 상태로, 못 받은 것은 not_run', async () => {
  const rows = await withFetch(async (url) => {
    if (new URL(url).pathname === '/api/notes') throw new TypeError('timeout');
    return new Response(null, { status: new URL(url).pathname === '/data.json' ? 404 : 401 });
  }, () => runAttackChecks(config));
  assert.deepEqual(rows.map((r) => r.observed), ['HTTP 404', 'not_run', 'HTTP 401']);
});
