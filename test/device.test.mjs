// 11단계 제작 2 · 기기 승인과 요청 서명 시험 (가짜 DB·가짜 패스키 검증, 서명 키는 실제 WebCrypto. 배포·심판 판정 아님)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, webcrypto, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { createDeviceGate } from '../src/device-gate.mjs';
import { createDeviceHandler } from '../api/device.js';
import { canonicalRequest, sha256Hex } from '../src/device-proof.mjs';

const repo = resolve(import.meta.dirname, '..');
const ORIGIN = 'https://fake-db.supabase.test';
const A = randomUUID(); const B = randomUUID();
const verifyLogin = async (h) => ({ 'Bearer token-a': { userId: A, kind: 'student' }, 'Bearer token-b': { userId: B, kind: 'student' } })[h] ?? null;

// ---- 가짜 Supabase REST(PostgREST 흉내): eq·is 필터, 넣기·고치기, 고유 키 ----
function fakeDb() {
  const t = { device_credentials: [], device_challenges: [], device_sessions: [], device_request_nonces: [] };
  const writes = [];
  const unique = { device_credentials: (r, x) => r.credential_id === x.credential_id, device_request_nonces: (r, x) => r.session_id === x.session_id && r.nonce === x.nonce };
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(String(input?.url ?? input));
    const method = (init.method ?? 'GET').toUpperCase();
    const table = url.pathname.replace('/rest/v1/', '');
    if (!(table in t)) return Response.json({ message: 'no table' }, { status: 404 });
    const filters = [...url.searchParams].filter(([k]) => !['select', 'columns'].includes(k));
    const match = (r) => filters.every(([k, v]) => (v === 'is.null' ? r[k] == null : v.startsWith('eq.') ? String(r[k]) === v.slice(3) : true));
    const cols = url.searchParams.get('select');
    const pick = (r) => (cols && cols !== '*' ? Object.fromEntries(cols.split(',').map((c) => [c, r[c]])) : r);
    const single = (new Headers(init.headers).get('accept') || '').includes('vnd.pgrst.object');
    const out = (list) => (single
      ? (list.length === 1 ? Response.json(pick(list[0])) : Response.json({ code: 'PGRST116', details: 'Results contain 0 rows', message: 'no rows' }, { status: 406 }))
      : Response.json(list.map(pick)));
    if (method === 'GET') return out(t[table].filter(match));
    const body = init.body ? JSON.parse(init.body) : null;
    writes.push({ table, method, body });
    if (method === 'POST') {
      const rows = (Array.isArray(body) ? body : [body]).map((r) => ({ id: randomUUID(), created_at: new Date().toISOString(), ...(table === 'device_credentials' ? { status: 'pending' } : {}), ...r }));
      for (const r of rows) if (unique[table] && t[table].some((x) => unique[table](x, r))) return Response.json({ code: '23505', message: 'duplicate' }, { status: 409 });
      t[table].push(...rows);
      return (new Headers(init.headers).get('prefer') || '').includes('return=representation') ? out(rows) : new Response(null, { status: 201 });
    }
    if (method === 'PATCH') { const hit = t[table].filter(match); hit.forEach((r) => Object.assign(r, body)); return out(hit); }
    return Response.json({ message: 'not allowed' }, { status: 405 });
  };
  const client = createClient(ORIGIN, 'test-only-key', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchImpl } });
  return { t, writes, client };
}

// ---- 실제 WebCrypto 임시 키로 서명 ----
async function signer(sessionId) {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const jwk = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
  const pub = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
  const sign = async ({ method, path, body = '', timestamp = Date.now(), nonce = webcrypto.getRandomValues(Buffer.alloc(18)).toString('base64url'), sid = sessionId }) => {
    const u = new URL(path, 'https://app.example');
    const canonical = canonicalRequest({ method, pathname: u.pathname, search: u.search, bodySha256: sha256Hex(body), timestamp, nonce, sessionId: sid });
    const sig = Buffer.from(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(canonical))).toString('base64url');
    return { 'x-device-session': sid, 'x-device-timestamp': String(timestamp), 'x-device-nonce': nonce, 'x-device-signature': sig };
  };
  return { pub, sign };
}
const req = (method, path, headers = {}, body) => new Request(`https://app.example${path}`, { method, headers, body });

async function approvedSetup({ status = 'approved', owner = A, expires = Date.now() + 3600e3 } = {}) {
  const db = fakeDb();
  const cred = { id: randomUUID(), owner_id: owner, credential_id: 'cred-1', public_key: 'x', counter: 0, transports: [], rp_id: 'app.example', status };
  db.t.device_credentials.push(cred);
  const sid = randomUUID();
  const s = await signer(sid);
  db.t.device_sessions.push({ id: sid, owner_id: owner, credential_row: cred.id, public_jwk: s.pub, expires_at: new Date(expires).toISOString() });
  const gate = createDeviceGate({ verifyLogin, db: db.client, log: () => {} });
  return { db, cred, sid, s, gate };
}
const code = async (res) => (res ? (await res.json()).error : 'PASS');
const NOTE = randomUUID(); const OTHER = randomUUID();

test('토큰 없는 요청은 앞단을 그대로 지나 함수가 전처럼 401로 거부한다(기존 결과 유지)', async () => {
  const { gate } = await approvedSetup();
  assert.equal(await code(await gate(req('GET', '/api/notes'))), 'PASS');
});

test('괴물 1 · 설치형 앱 서명 없이 보호 요청 → 403 DEVICE_PROOF_REQUIRED', async () => {
  const { gate } = await approvedSetup();
  assert.equal(await code(await gate(req('GET', `/api/notes/${NOTE}`, { authorization: 'Bearer token-a' }))), 'DEVICE_PROOF_REQUIRED');
  assert.equal(await code(await gate(req('POST', '/api/restore', { authorization: 'Bearer token-a', 'content-type': 'application/json' }, JSON.stringify({ id: NOTE })))), 'DEVICE_PROOF_REQUIRED');
});

test('승인된 기기의 서명 요청은 통과한다(조회·추가·수정·삭제·복구, /api/notes?id= 모양 포함)', async () => {
  const { gate, s } = await approvedSetup();
  const auth = { authorization: 'Bearer token-a' };
  assert.equal(await code(await gate(req('GET', '/api/notes', { ...auth, ...(await s.sign({ method: 'GET', path: '/api/notes' })) }))), 'PASS');
  assert.equal(await code(await gate(req('GET', `/api/notes/${NOTE}`, { ...auth, ...(await s.sign({ method: 'GET', path: `/api/notes/${NOTE}` })) }))), 'PASS');
  assert.equal(await code(await gate(req('GET', `/api/notes?id=${NOTE}`, { ...auth, ...(await s.sign({ method: 'GET', path: `/api/notes/${NOTE}` })) }))), 'PASS', '다시 쓰기 뒤 모양도 같은 대상');
  const body = JSON.stringify({ title: '가상', body: '가상 내용' });
  assert.equal(await code(await gate(req('POST', '/api/notes', { ...auth, ...(await s.sign({ method: 'POST', path: '/api/notes', body })) }, body))), 'PASS');
  assert.equal(await code(await gate(req('PUT', `/api/notes/${NOTE}`, { ...auth, ...(await s.sign({ method: 'PUT', path: `/api/notes/${NOTE}`, body })) }, body))), 'PASS');
  assert.equal(await code(await gate(req('DELETE', `/api/notes/${NOTE}`, { ...auth, ...(await s.sign({ method: 'DELETE', path: `/api/notes/${NOTE}` })) }))), 'PASS');
  const rb = JSON.stringify({ id: NOTE });
  assert.equal(await code(await gate(req('POST', '/api/restore', { ...auth, ...(await s.sign({ method: 'POST', path: '/api/restore', body: rb })) }, rb))), 'PASS');
});

test('괴물 2 · 서명 뒤 요청 경로를 변경 → 403 DEVICE_SIGNATURE_INVALID (다른 메모·다른 경로·쿼리 추가·메서드 변경)', async () => {
  const { gate, s } = await approvedSetup();
  const auth = { authorization: 'Bearer token-a' };
  const h1 = await s.sign({ method: 'GET', path: `/api/notes/${NOTE}` });
  assert.equal(await code(await gate(req('GET', `/api/notes/${OTHER}`, { ...auth, ...h1 }))), 'DEVICE_SIGNATURE_INVALID');
  const h2 = await s.sign({ method: 'GET', path: `/api/notes/${NOTE}` });
  assert.equal(await code(await gate(req('GET', '/api/restore', { ...auth, ...h2 }))), 'DEVICE_SIGNATURE_INVALID');
  const h3 = await s.sign({ method: 'GET', path: '/api/notes' });
  assert.equal(await code(await gate(req('GET', `/api/notes?owner_id=${B}`, { ...auth, ...h3 }))), 'DEVICE_SIGNATURE_INVALID');
  const h4 = await s.sign({ method: 'GET', path: `/api/notes/${NOTE}` });
  assert.equal(await code(await gate(req('DELETE', `/api/notes/${NOTE}`, { ...auth, ...h4 }))), 'DEVICE_SIGNATURE_INVALID');
});

test('괴물 3 · 서명 뒤 수정 본문을 변경 → 403 DEVICE_SIGNATURE_INVALID (메모 수정·복구 대상 바꾸기)', async () => {
  const { gate, s } = await approvedSetup();
  const auth = { authorization: 'Bearer token-a', 'content-type': 'application/json' };
  const signed = JSON.stringify({ title: '원래 제목', body: '원래 내용' });
  const h = await s.sign({ method: 'PUT', path: `/api/notes/${NOTE}`, body: signed });
  assert.equal(await code(await gate(req('PUT', `/api/notes/${NOTE}`, { ...auth, ...h }, JSON.stringify({ title: '원래 제목', body: '바꿔치기한 내용' })))), 'DEVICE_SIGNATURE_INVALID');
  const r = await s.sign({ method: 'POST', path: '/api/restore', body: JSON.stringify({ id: NOTE }) });
  assert.equal(await code(await gate(req('POST', '/api/restore', { ...auth, ...r }, JSON.stringify({ id: OTHER })))), 'DEVICE_SIGNATURE_INVALID');
});

test('같은 서명 요청을 다시 보내면(재전송) 403, 시각이 2분 넘게 다르면 403', async () => {
  const { gate, s } = await approvedSetup();
  const auth = { authorization: 'Bearer token-a' };
  const h = await s.sign({ method: 'GET', path: `/api/notes/${NOTE}` });
  assert.equal(await code(await gate(req('GET', `/api/notes/${NOTE}`, { ...auth, ...h }))), 'PASS');
  assert.equal(await code(await gate(req('GET', `/api/notes/${NOTE}`, { ...auth, ...h }))), 'DEVICE_PROOF_REPLAYED');
  const old = await s.sign({ method: 'GET', path: `/api/notes/${NOTE}`, timestamp: Date.now() - 5 * 60e3 });
  assert.equal(await code(await gate(req('GET', `/api/notes/${NOTE}`, { ...auth, ...old }))), 'DEVICE_PROOF_EXPIRED');
});

test('승인 대기·회수된 기기, 만료된 세션, 남의 기기 세션은 403 DEVICE_NOT_APPROVED', async () => {
  for (const [label, opts, token] of [['승인 대기', { status: 'pending' }, 'token-a'], ['회수됨', { status: 'revoked' }, 'token-a'],
    ['만료', { expires: Date.now() - 1000 }, 'token-a'], ['남의 기기 세션(B 토큰으로 A 세션)', {}, 'token-b']]) {
    const { gate, s } = await approvedSetup(opts);
    const h = await s.sign({ method: 'GET', path: `/api/notes/${NOTE}` });
    assert.equal(await code(await gate(req('GET', `/api/notes/${NOTE}`, { authorization: `Bearer ${token}`, ...h }))), 'DEVICE_NOT_APPROVED', label);
  }
  const { gate, s, cred } = await approvedSetup();
  cred.status = 'revoked'; // 세션을 받은 뒤 회수 → 다음 요청부터 거부
  const h = await s.sign({ method: 'GET', path: `/api/notes/${NOTE}` });
  assert.equal(await code(await gate(req('GET', `/api/notes/${NOTE}`, { authorization: 'Bearer token-a', ...h }))), 'DEVICE_NOT_APPROVED');
});

test('승인된 세션 ID를 알아도 그 세션의 임시 키가 아니면(다른 키로 서명) 403 DEVICE_SIGNATURE_INVALID', async () => {
  const { gate, sid } = await approvedSetup();
  const intruder = await signer(sid);
  const h = await intruder.sign({ method: 'GET', path: `/api/notes/${NOTE}` });
  assert.equal(await code(await gate(req('GET', `/api/notes/${NOTE}`, { authorization: 'Bearer token-a', ...h }))), 'DEVICE_SIGNATURE_INVALID');
});

// ---- 기기 승인 API(api/device.js): 가짜 패스키 검증으로 흐름만 시험 ----
function apiSetup({ verifyOk = true } = {}) {
  const db = fakeDb();
  const webauthn = {
    generateRegistrationOptions: async (o) => ({ challenge: 'reg-challenge-' + randomUUID(), rp: { id: o.rpID }, user: { id: 'dQ', name: o.userName } }),
    verifyRegistrationResponse: async () => (verifyOk ? { verified: true, registrationInfo: { credential: { id: 'cred-xyz', publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ['internal'] } } } : { verified: false }),
    generateAuthenticationOptions: async (o) => ({ challenge: Buffer.from(o.challenge).toString('base64url'), allowCredentials: o.allowCredentials }),
    verifyAuthenticationResponse: async () => ({ verified: verifyOk, authenticationInfo: { newCounter: 1 } }),
  };
  const handler = createDeviceHandler({ env: { SUPABASE_URL: ORIGIN, SUPABASE_SECRET_KEY: 'test-only-key' }, verifyLogin, db: db.client, webauthn, log: () => {} });
  const call = async (action, body, token = 'token-a') => {
    const r = { headers: {}, setHeader(k, v) { r.headers[k] = v; }, status(c) { r.code = c; return { json(b) { r.body = b; } }; } };
    await handler({ method: 'POST', query: { action }, headers: { host: 'app.example', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body }, r);
    return r;
  };
  return { db, call };
}

test('승인 요청 버튼(등록)은 항상 승인 대기(pending)만 만들고, 본문에 approved를 넣어도 무시한다', async () => {
  const { db, call } = apiSetup();
  const start = await call('register-options', {});
  assert.equal(start.code, 200);
  const done = await call('register', { challengeId: start.body.challengeId, response: { id: 'cred-xyz' }, status: 'approved', approved: true });
  assert.equal(done.code, 201);
  assert.deepEqual([done.body.approved, done.body.status], [false, 'pending']);
  assert.equal(db.t.device_credentials[0].status, 'pending');
  assert.ok(db.writes.filter((w) => w.table === 'device_credentials').every((w) => !('status' in (w.body ?? {})) && !('approved_at' in (w.body ?? {}))),
    'API는 기기 상태·승인 시각을 한 번도 쓰지 않음');
  assert.equal((await call('register', { challengeId: start.body.challengeId, response: { id: 'cred-xyz' } })).code, 400, '같은 등록 문제 재사용 불가');
});

test('승인 전에는 패스키를 확인해도 기기 세션(자료 열쇠)을 주지 않는다 → 주인이 DB에서 승인한 뒤에만 준다', async () => {
  const { db, call } = apiSetup();
  const s0 = await call('register-options', {});
  await call('register', { challengeId: s0.body.challengeId, response: { id: 'cred-xyz' } });
  const key = (await signer(randomUUID())).pub;
  const o1 = await call('session-options', { sessionKey: key });
  const r1 = await call('session', { challengeId: o1.body.challengeId, sessionKey: key, response: { id: 'cred-xyz' } });
  assert.deepEqual([r1.code, r1.body.approved, r1.body.status, r1.body.sessionId], [200, false, 'pending', undefined]);
  assert.equal(db.t.device_sessions.length, 0, '승인 대기 기기에는 세션 없음');
  db.t.device_credentials[0].status = 'approved'; // ← 주인이 SQL Editor에서 승인(notes-step11-devices.sql ④)
  const o2 = await call('session-options', { sessionKey: key });
  const r2 = await call('session', { challengeId: o2.body.challengeId, sessionKey: key, response: { id: 'cred-xyz' } });
  assert.deepEqual([r2.code, r2.body.approved, r2.body.status], [200, true, 'approved']);
  assert.deepEqual(db.t.device_sessions[0].public_jwk, key, '서버는 임시 키의 공개키만 저장');
});

test('세션 요청 검사: 비밀값(d)이 든 키·다른 키로 바꿔치기·패스키 검증 실패·비로그인은 거부', async () => {
  const { db, call } = apiSetup();
  const s0 = await call('register-options', {});
  await call('register', { challengeId: s0.body.challengeId, response: { id: 'cred-xyz' } });
  db.t.device_credentials[0].status = 'approved';
  const key = (await signer(randomUUID())).pub;
  assert.equal((await call('session-options', { sessionKey: { ...key, d: 'secret' } })).code, 400, '비밀값이 든 키');
  const o = await call('session-options', { sessionKey: key });
  const other = (await signer(randomUUID())).pub;
  const swapped = await call('session', { challengeId: o.body.challengeId, sessionKey: other, response: { id: 'cred-xyz' } });
  assert.equal(swapped.code, 400, '패스키가 보증한 키와 다른 키');
  assert.equal(db.t.device_sessions.length, 0);
  assert.equal((await call('register-options', {}, null)).code, 401);
  const bad = apiSetup({ verifyOk: false });
  const b0 = await bad.call('register-options', {});
  assert.equal((await bad.call('register', { challengeId: b0.body.challengeId, response: { id: 'cred-xyz' } })).code, 400);
  assert.equal(bad.db.t.device_credentials.length, 0, '패스키 검증 실패면 등록 안 됨');
});

test('끝까지: 승인 → 기기 세션 → 그 임시 키로 서명한 요청만 앞단 통과', async () => {
  const { db, call } = apiSetup();
  const s0 = await call('register-options', {});
  await call('register', { challengeId: s0.body.challengeId, response: { id: 'cred-xyz' } });
  db.t.device_credentials[0].status = 'approved';
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const jwk = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
  const key = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
  const o = await call('session-options', { sessionKey: key });
  const r = await call('session', { challengeId: o.body.challengeId, sessionKey: key, response: { id: 'cred-xyz' } });
  const gate = createDeviceGate({ verifyLogin, db: db.client, log: () => {} });
  const ts = Date.now(); const nonce = 'n'.repeat(20);
  const canonical = canonicalRequest({ method: 'GET', pathname: `/api/notes/${NOTE}`, search: '', bodySha256: sha256Hex(''), timestamp: ts, nonce, sessionId: r.body.sessionId });
  const sig = Buffer.from(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(canonical))).toString('base64url');
  const headers = { authorization: 'Bearer token-a', 'x-device-session': r.body.sessionId, 'x-device-timestamp': String(ts), 'x-device-nonce': nonce, 'x-device-signature': sig };
  assert.equal(await code(await gate(req('GET', `/api/notes/${NOTE}`, headers))), 'PASS');
});

test('화면: 승인 전에는 자료를 요청·표시하지 않고, 기기 키·세션을 브라우저 저장소에 넣지 않는다', () => {
  const html = readFileSync(join(repo, 'public/index.html'), 'utf8');
  assert.match(html, /if \(!device\.proof\) \{\s*showMessage\('서버가 이 기기를 승인한 뒤에만 자료를 보여 줍니다/u, 'loadNotes: 승인 전에는 자료 요청 없음');
  assert.match(html, /if \(!device\.proof\) \{ closeVault\(\); throw/u, 'api(): 승인 전에는 보호 요청을 보내지 않음');
  assert.match(html, /generateKey\(\{ name: 'ECDSA', namedCurve: 'P-256' \}, false/u, '임시 비밀키는 내보낼 수 없게 만듦');
  assert.deepEqual([...html.matchAll(/localStorage\.setItem\(([^,]+),/gu)].map((m) => m[1].trim()), ['SESSION_KEY'], '새로 저장하는 값 없음');
  assert.doesNotMatch(html, /\b(sessionStorage|indexedDB)\s*\./u, "세션 저장소·브라우저 DB 사용 없음");
  assert.match(html, /done\.data\?\.approved === true && done\.data\.sessionId/u, '서버가 approved:true와 세션을 줄 때만 열림');
});

test('DB: 서버 전용 키는 기기 상태·승인 시각을 고칠 권한이 없다(승인은 SQL Editor에서 주인만)', () => {
  const sql = readFileSync(join(repo, 'supabase/notes-step11-devices.sql'), 'utf8');
  assert.match(sql, /grant update \(counter, last_used_at\) on table public\.device_credentials to service_role;/u);
  assert.doesNotMatch(sql, /grant [^;]*update[^;(]*on table public\.device_credentials/iu, '표 전체 update 권한 없음');
  assert.match(sql, /revoke all on table public\.device_credentials, public\.device_challenges, public\.device_sessions, public\.device_request_nonces\s+from public, anon, authenticated, service_role;/u);
});
