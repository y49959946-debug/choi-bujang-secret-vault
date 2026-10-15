// 12단계 · 자기 점검(src/attack-check.mjs) 실험: 무인증 세 점검은 심판 실행과 연결할 수 없어 observed를 not_run으로 둔다.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runAttackChecks } from '../src/attack-check.mjs';

const repo = resolve(import.meta.dirname, '..');
const config = JSON.parse(readFileSync(join(repo, 'aleph.config.json'), 'utf8'));

test('12단계: 세 점검 모두 observed 가 not_run 이고, 네트워크 요청을 보내지 않는다', async () => {
  const real = globalThis.fetch;
  let called = 0;
  globalThis.fetch = async () => { called += 1; return new Response(null, { status: 401, headers: { 'x-vercel-id': 'icn1::x-1' } }); };
  try {
    const rows = await runAttackChecks(config);
    assert.deepEqual(rows.map((r) => r.attackId), ['anonymous_note_read', 'anonymous_note_list', 'anonymous_other_note_read']);
    for (const r of rows) assert.equal(r.observed, 'not_run');
    assert.equal(called, 0, '배포에 요청을 보내지 않음(심판이 직접 수행하는 항목)');
  } finally { globalThis.fetch = real; }
});

test('제출 묶음 규격을 만족한다(attackId·expected·observed 문자열, 중복 없음)', async () => {
  const rows = await runAttackChecks(config);
  assert.ok(rows.length >= 1 && rows.length <= 20);
  const ids = rows.map((r) => r.attackId);
  assert.equal(new Set(ids).size, ids.length);
  for (const r of rows) {
    assert.deepEqual(Object.keys(r).sort(), ['attackId', 'expected', 'observed']);
    assert.match(r.attackId, /^[a-z0-9][a-z0-9_.-]{0,79}$/iu);
    for (const k of ['expected', 'observed']) { assert.equal(typeof r[k], 'string'); assert.ok(r[k].trim() && r[k].length <= 300); }
  }
});

test('1단계 점검은 그대로(배포 data.json을 비로그인으로 읽어 확인 표시 여부를 적는다)', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ sampleMarker: config.sampleMarker, notes: [{ title: 'x' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const [row] = await runAttackChecks({ ...config, step: 1 });
    assert.equal(row.attackId, 'anonymous_note_read');
    assert.match(row.observed, /보임/u);
  } finally { globalThis.fetch = real; }
});
