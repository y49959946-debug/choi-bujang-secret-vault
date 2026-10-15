// 12단계 마무리 · 보호 요청 조합 전수 시험(로컬, 실제 코드 + 가짜 DB. 배포·심판 판정 아님)
// 실행: npm run test:monsters
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { createWorld } from './monsters-lib.mjs';
import { runMatrix, summarizeMatrix } from './monsters-matrix.mjs';

const w = await createWorld();
after(() => w.restoreConsole());

test('조합 전수: 모든 경우가 규칙표(오라클)와 같고, 거부 응답에 메모 내용이 없다', async () => {
  const rows = await runMatrix(w);
  const s = summarizeMatrix(rows);
  const fails = rows.filter((r) => !r.ok).slice(0, 5).map((r) => `${r.identity}/${r.device}/${r.sig}/${r.api} ${r.method} ${r.target}: 기대 ${r.expected}, 실제 ${r.actual}`);
  assert.equal(s.fail, 0, fails.join('\n'));
  assert.equal(s.leaks, 0);
  assert.ok(s.total > 10000, `조합 수 ${s.total}`);
});

test('허용(2xx)은 유효 토큰 + 승인 기기 + 올바른 서명 + 허용된 요청일 때만', async () => {
  const rows = await runMatrix(w);
  const allowed = rows.filter((r) => /^2/u.test(r.actual));
  assert.ok(allowed.length > 0);
  for (const r of allowed) {
    assert.equal(r.identity, 'A'); assert.equal(r.device, 'approved');
    assert.ok(['valid', 'ts_edge_ok'].includes(r.sig), r.sig);
  }
});

test('앞단의 로그인 확인이 실패하면 함수로 넘기지 않고 닫는다(12단계 마무리 수정)', async () => {
  const own = w.db.addNote(w.ownerOf('A'), 'own');
  const path = `/api/notes/${own}`;
  const lines = [['authorization', w.tokens.A]];
  const throwing = w.createDeviceGate({ verifyLogin: async () => { throw new Error('verifier error'); } });
  const r1 = await w.send({ path, headerLines: lines }, { gate: throwing });
  assert.deepEqual([r1.status, r1.layer, r1.body?.error], [403, 'middleware', 'DEVICE_CHECK_FAILED']);
  const unverified = w.createDeviceGate({ verifyLogin: async () => null });
  const r2 = await w.send({ path, headerLines: lines }, { gate: unverified });
  assert.deepEqual([r2.status, r2.layer, r2.body?.error], [401, 'middleware', 'LOGIN_REQUIRED']);
  const r3 = await w.send({ path });
  assert.deepEqual([r3.status, r3.layer, r3.body?.error], [401, 'function', 'LOGIN_REQUIRED'], '토큰 없는 요청은 전처럼 함수가 401');
});
