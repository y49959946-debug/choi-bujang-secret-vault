// 12단계 제작 2 · 실측표 요청 목록·판정 규칙 시험(로컬)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { LIVE_ROWS, CHECKS, verdictOf, checkOf, errorCodeOf, summarize } from '../public/live-catalog.js';

const repo = resolve(import.meta.dirname, '..');
const html = readFileSync(join(repo, 'public/index.html'), 'utf8');

test('목록: ID가 겹치지 않고, 실행 줄(api·note)에는 기대값이, 실행 불가 줄(sql·not_run)에는 이유가 있다', () => {
  const ids = LIVE_ROWS.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const r of LIVE_ROWS) {
    assert.ok(['api', 'sql', 'note', 'not_run'].includes(r.source), r.id);
    assert.ok(['정상', '금지', '준비', '참고'].includes(r.kind), r.id);
    if (r.source === 'api' || r.source === 'note') assert.ok(Number.isInteger(r.expect?.status), `${r.id} 기대 상태`);
    if (r.source !== 'api') assert.ok(typeof r.reason === 'string' && r.reason.length > 10, `${r.id} 이유`);
    if (r.expect?.check) assert.ok(r.expect.check in CHECKS, `${r.id} 조건 이름`);
    assert.doesNotMatch(r.shape, /[0-9a-f]{8}-[0-9a-f]{4}-/iu, `${r.id} 요청 모양에 실제 ID 없음`);
  }
});

test('목록: 1~11단계와 괴물 셋이 모두 있고, 금지 거부와 정상 허용이 둘 다 실측 대상이다', () => {
  for (const stage of ['1·2', '3', '4', '5', '6', '7', '8', '9', '10', '11']) assert.ok(LIVE_ROWS.some((r) => r.stage === stage), `${stage}단계`);
  for (const m of ['①', '②', '③']) assert.ok(LIVE_ROWS.some((r) => r.monster === m && r.source === 'api'), `괴물 ${m}`);
  assert.ok(LIVE_ROWS.filter((r) => r.source === 'api' && r.kind === '금지').length >= 20);
  assert.ok(LIVE_ROWS.filter((r) => r.source === 'api' && r.kind === '정상').length >= 8);
  assert.equal(LIVE_ROWS.find((r) => r.id === 'x41-list').source, 'not_run', '41종은 실행하지 않은 것으로');
});

test('목록: 없는 경로의 404·5단계 SQL·7·9단계·41종은 통과 집계에 들어가지 않는다', () => {
  for (const id of ['s8-zone-note', 'm3-zone-note']) assert.equal(LIVE_ROWS.find((r) => r.id === id).source, 'note');
  for (const id of ['s5-browser-key']) assert.equal(LIVE_ROWS.find((r) => r.id === id).source, 'sql');
  for (const id of ['s7-step-up', 's9-detect', 'x41-list']) assert.equal(LIVE_ROWS.find((r) => r.id === id).source, 'not_run');
});

test('판정: 상태·오류 코드·추가 조건이 모두 같을 때만 통과, 보내지 않으면 미실행', () => {
  const def = LIVE_ROWS.find((r) => r.id === 's4-read-other');
  assert.equal(verdictOf(def, { status: 403, error: 'OWNER_MISMATCH' }), '통과');
  assert.equal(verdictOf(def, { status: 403, error: 'DEVICE_PROOF_REQUIRED' }), '실패', '다른 이유의 403은 실패');
  assert.equal(verdictOf(def, { status: 404, error: 'NOT_FOUND' }), '실패');
  assert.equal(verdictOf(def, null), '미실행');
  const restore = LIVE_ROWS.find((r) => r.id === 's10-restore-own');
  assert.equal(verdictOf(restore, { status: 200, error: null, check: true }), '통과');
  assert.equal(verdictOf(restore, { status: 200, error: null, check: false }), '실패', '200이어도 verified가 다르면 실패');
  assert.equal(verdictOf(LIVE_ROWS.find((r) => r.id === 's7-step-up'), { status: 200 }), '미실행', '실행 불가 줄은 응답이 있어도 미실행');
  assert.equal(verdictOf(LIVE_ROWS.find((r) => r.id === 's8-zone-note'), { status: 404 }), '참고(일치)');
});

test('응답에서 꺼내는 값: 오류 코드 모양만, 조건은 참·거짓만(본문은 남기지 않음)', () => {
  assert.equal(errorCodeOf({ error: 'OWNER_MISMATCH', title: '본문' }), 'OWNER_MISMATCH');
  assert.equal(errorCodeOf({ error: '<script>' }), null);
  assert.equal(errorCodeOf(null), null);
  assert.equal(checkOf('verifiedAll', { verified: { id: true, owner: true } }), true);
  assert.equal(checkOf('verifiedAll', { verified: { id: true, owner: false } }), false);
  assert.equal(checkOf('verifiedAll', { verified: {} }), false);
  assert.equal(checkOf('approvedSession', { approved: true, sessionId: 'x' }), true);
  assert.equal(checkOf('revokedNoSession', { status: 'revoked', approved: false }), true);
  assert.equal(checkOf('revokedNoSession', { status: 'revoked', approved: false, sessionId: 'x' }), false);
});

test('집계: 배포 API 줄만 세고, 참고·SQL·실행 불가는 따로 센다', () => {
  const rows = LIVE_ROWS.map((def) => ({ ...def, verdict: verdictOf(def, def.source === 'api' && def.kind === '금지' ? { status: def.expect.status, error: def.expect.error, check: true } : null) }));
  const s = summarize(rows);
  assert.equal(s.api.total, LIVE_ROWS.filter((r) => r.source === 'api').length);
  assert.equal(s.api.pass, s.denied.pass);
  assert.equal(s.allowed.pass, 0);
  assert.equal(s.excluded.note, 2);
  assert.equal(s.excluded.notRun, 3);
});

test('화면: 목록의 모든 실행 줄을 실제로 보내는 코드가 있다', () => {
  for (const r of LIVE_ROWS.filter((x) => x.source === 'api' || x.source === 'note')) {
    assert.match(html, new RegExp(`liveRecord\\('${r.id}'`, 'u'), `${r.id} 실행 코드`);
  }
});

test('화면: 변조·재전송은 먼저 만든 서명 머리글을 그대로 써서 보낸다(새로 서명하지 않음)', () => {
  assert.match(html, /const h1 = await signRequest\('GET', own, ''\);\s*liveRecord\('s11-tamper-id', await liveSend\('GET', `\/api\/notes\/\$\{randomId\(\)\}`, \{ headers: \{ \.\.\.T, \.\.\.h1 \} \}\)\);/u);
  assert.match(html, /liveRecord\('s11-replay-first', await liveSend\('GET', own, \{ headers: \{ \.\.\.T, \.\.\.h5 \} \}\)\);\s*liveRecord\('s11-replay-second', await liveSend\('GET', own, \{ headers: \{ \.\.\.T, \.\.\.h5 \} \}\)\);/u);
  assert.match(html, /signRequest\('GET', own, '', \{ timestamp: Date\.now\(\) - 5 \* 60 \* 1000 \}\)/u);
});

test('화면: 기록과 내려받는 파일에 토큰·본문·전체 ID를 넣지 않는다', () => {
  const start = html.indexOf('// ----- 12단계 제작 2'); const end = html.indexOf('// 처음 열 때');
  const code = html.slice(start, end);
  assert.match(code, /live\.results\.set\(id, \{ def, actual, requestId: resp\?\.requestId \?\? null, serverTime: resp\?\.serverTime \?\? null, clientTime: resp\?\.clientTime \?\? null, note: extra\.note \?\? null \}\)/u, '응답 본문은 저장하지 않음');
  assert.doesNotMatch(code, /localStorage|sessionStorage|indexedDB|innerHTML/u);
  assert.match(code, /testDevice8: live\.testDev\?\.deviceId \? String\(live\.testDev\.deviceId\)\.slice\(0, 8\)/u, '시험 기기 ID는 앞 8자리만');
  assert.doesNotMatch(code, /ownId[^;]*report|report[^;]*ownId/u, '내 시험 메모 ID는 파일에 넣지 않음');
});
