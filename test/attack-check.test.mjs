// 12단계 · 자기 점검(src/attack-check.mjs): 점검 대상 주소, 차례대로 보내기, observed 칸(받은 상태 그대로 / 못 받으면 not_run)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runAttackChecks } from '../src/attack-check.mjs';

const repo = resolve(import.meta.dirname, '..');
const config = JSON.parse(readFileSync(join(repo, 'aleph.config.json'), 'utf8'));
const UNIQUE = 'https://choi-bujang-secret-vault-abc123-aleph-5.vercel.app';
const withFetch = async (impl, fn) => { const real = globalThis.fetch; globalThis.fetch = impl; try { return await fn(); } finally { globalThis.fetch = real; } };
const identity = (over = {}) => Response.json({ schema: 'aleph.defense.deployment.v1', repoUrl: config.repoUrl, publicAppUrl: UNIQUE, ...over });

test('요청이 끝나지 않으면(네트워크 차단) 세 점검 모두 observed 가 not_run 이다', async () => {
  const rows = await withFetch(async () => { throw new TypeError('fetch failed'); }, () => runAttackChecks(config));
  assert.deepEqual(rows.map((r) => r.attackId), ['anonymous_note_read', 'anonymous_note_list', 'anonymous_other_note_read']);
  for (const r of rows) assert.equal(r.observed, 'not_run');
});

test('같은 저장소의 /aleph.json 이 알려 주는 배포 주소로, 점검마다 하나씩 차례대로 보내고 받은 상태를 적는다', async () => {
  const sent = [];
  let inFlight = 0; let maxInFlight = 0;
  const rows = await withFetch(async (url, init) => {
    const u = new URL(url);
    if (u.pathname === '/aleph.json') return identity();
    inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
    sent.push({ origin: u.origin, path: u.pathname, credentials: init?.credentials });
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    return new Response(null, { status: u.pathname === '/data.json' ? 404 : 401 });
  }, () => runAttackChecks(config));
  assert.deepEqual(sent.map((s) => s.path), ['/data.json', '/api/notes', '/api/notes/00000000-0000-4000-8000-000000000001']);
  for (const s of sent) { assert.equal(s.origin, UNIQUE); assert.equal(s.credentials, 'omit'); }
  assert.equal(maxInFlight, 1, '동시에 둘 이상 보내지 않음');
  assert.deepEqual(rows.map((r) => r.observed), ['HTTP 404로 막힘', 'HTTP 401로 막힘', 'HTTP 401로 막힘']);
});

test('다른 저장소이거나 모양이 틀린 /aleph.json 이면 설정 주소를 그대로 쓴다', async () => {
  for (const bad of [identity({ repoUrl: 'https://github.com/someone/else' }), identity({ publicAppUrl: 'https://evil.example' }),
    identity({ schema: 'x' }), new Response('nope', { status: 404 })]) {
    const origins = new Set();
    await withFetch(async (url) => {
      const u = new URL(url);
      if (u.pathname === '/aleph.json') return bad.clone();
      origins.add(u.origin); return new Response(null, { status: 401 });
    }, () => runAttackChecks(config));
    assert.deepEqual([...origins], [new URL(config.publicAppUrl).origin]);
  }
});

test('기대와 다른 상태도 그대로 드러낸다', async () => {
  const rows = await withFetch(async (url) => (new URL(url).pathname === '/aleph.json' ? identity() : new Response(null, { status: 200 })), () => runAttackChecks(config));
  for (const r of rows) assert.equal(r.observed, 'HTTP 200 (기대와 다름)');
});
