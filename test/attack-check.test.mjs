// 12단계 · 자기 점검(src/attack-check.mjs)의 observed 칸: 받은 HTTP 상태만 적고, 요청이 끝나지 않으면 not_run
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runAttackChecks } from '../src/attack-check.mjs';

const repo = resolve(import.meta.dirname, '..');
const config = JSON.parse(readFileSync(join(repo, 'aleph.config.json'), 'utf8'));
const withFetch = async (impl, fn) => { const real = globalThis.fetch; globalThis.fetch = impl; try { return await fn(); } finally { globalThis.fetch = real; } };

test('요청이 끝나지 않으면(네트워크 차단) 세 점검 모두 observed 가 not_run 이다', async () => {
  const rows = await withFetch(async () => { throw new TypeError('fetch failed'); }, () => runAttackChecks(config));
  assert.deepEqual(rows.map((r) => r.attackId), ['anonymous_note_read', 'anonymous_note_list', 'anonymous_other_note_read']);
  for (const r of rows) assert.equal(r.observed, 'not_run');
});

test('응답을 받으면 받은 HTTP 상태를 그대로 적는다', async () => {
  const sent = [];
  const rows = await withFetch(async (url, init) => {
    sent.push({ path: new URL(url).pathname, credentials: init?.credentials });
    return new Response(null, { status: new URL(url).pathname === '/data.json' ? 404 : 401 });
  }, () => runAttackChecks(config));
  assert.deepEqual(rows.map((r) => r.observed), ['HTTP 404로 막힘', 'HTTP 401로 막힘', 'HTTP 401로 막힘']);
  assert.equal(sent.length, 3); for (const s of sent) assert.equal(s.credentials, 'omit');
  const odd = await withFetch(async () => new Response(null, { status: 200 }), () => runAttackChecks(config));
  for (const r of odd) assert.equal(r.observed, 'HTTP 200 (기대와 다름)', '기대와 다르면 그대로 드러냄');
});
