// 12단계 마무리 · 괴물 통과 조건 전수 시험용 로컬 하네스
// 실제 middleware 규칙(src/device-gate.mjs)·api/notes.js·api/restore.js·api/ops.js를 그대로 부르고,
// Supabase만 메모리 안 가짜 표로 바꿉니다(JWT 서명 키·기기 키도 이 실행에서만 만든 가짜 키).
// 배포·실제 DB·심판에는 접속하지 않습니다. 토큰·키·메모 본문은 출력하지 않습니다.
//
// 기대값(오라클)은 코드를 베끼지 않고 README·계약에 적힌 규칙표로 따로 씁니다(아래 gateOracle·apiOracle).
import { createHash, randomUUID, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const repo = resolve(import.meta.dirname, '..');
const config = JSON.parse(readFileSync(join(repo, 'aleph.config.json'), 'utf8'));
const vercel = JSON.parse(readFileSync(join(repo, 'vercel.json'), 'utf8'));
const issuer = config.identityProvider.issuer;
const ORIGIN = new URL(issuer).origin;
const sha = (t) => createHash('sha256').update(String(t ?? ''), 'utf8').digest('hex');

// ---------- 가짜 Supabase(PostgREST 흉내) ----------
export function createFakeSupabase() {
  const T = { notes: [], notes_backup: [], restore_audit: [], device_credentials: [], device_challenges: [], device_sessions: [], device_request_nonces: [] };
  const unique = {
    notes: (r, x) => r.public_id === x.public_id,
    device_credentials: (r, x) => r.credential_id === x.credential_id,
    device_request_nonces: (r, x) => r.session_id === x.session_id && r.nonce === x.nonce,
  };
  let seq = 0;
  const failures = new Set(); // 'device_sessions' 등: 이 표를 부르면 500(DB 오류 흉내)
  const handle = async (url, init) => {
    const table = url.pathname.replace('/rest/v1/', '');
    if (!(table in T)) return Response.json({ message: `no table ${table}` }, { status: 404 });
    if (failures.has(table)) return Response.json({ message: 'simulated db failure', code: 'XX000' }, { status: 500 });
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers);
    const filters = [...url.searchParams].filter(([k]) => !['select', 'columns', 'order', 'limit'].includes(k));
    const match = (r) => filters.every(([k, v]) => (v === 'is.null' ? r[k] == null : v.startsWith('eq.') ? String(r[k]) === v.slice(3) : true));
    const cols = url.searchParams.get('select');
    const pick = (r) => (cols && cols !== '*' ? Object.fromEntries(cols.split(',').map((c) => c.trim()).map((c) => [c, r[c]])) : { ...r });
    const single = (headers.get('accept') || '').includes('vnd.pgrst.object');
    const out = (list, status = 200) => (single
      ? (list.length === 1 ? Response.json(pick(list[0]), { status }) : Response.json({ code: 'PGRST116', details: 'Results contain 0 rows', message: 'no rows' }, { status: 406 }))
      : Response.json(list.map(pick), { status }));
    if (method === 'GET') return out(T[table].filter(match));
    const body = init.body ? JSON.parse(init.body) : null;
    const wantRows = (headers.get('prefer') || '').includes('return=representation');
    if (method === 'POST') {
      if (table === 'notes_backup') return Response.json({ code: '42501', message: 'permission denied' }, { status: 403 });
      const now = new Date().toISOString();
      const rows = (Array.isArray(body) ? body : [body]).map((r) => ({
        ...(table === 'notes' ? { id: ++seq, public_id: randomUUID(), created_at: now, updated_at: now } : {}),
        ...(table === 'restore_audit' ? { id: ++seq, at: now } : {}),
        ...(table.startsWith('device_') && table !== 'device_request_nonces' ? { id: randomUUID(), created_at: now } : {}),
        ...(table === 'device_credentials' ? { status: 'pending' } : {}),
        ...r,
      }));
      for (const r of rows) if (unique[table] && T[table].some((x) => unique[table](x, r))) return Response.json({ code: '23505', message: 'duplicate' }, { status: 409 });
      T[table].push(...rows);
      if (table === 'notes') for (const n of rows) seedBackup(n);
      return wantRows || single ? out(rows, 201) : new Response(null, { status: 201 });
    }
    if (method === 'PATCH') {
      if (table === 'restore_audit' || table === 'notes_backup') return Response.json({ message: 'append-only' }, { status: 403 });
      const hit = T[table].filter(match); hit.forEach((r) => Object.assign(r, body, table === 'notes' ? { updated_at: new Date().toISOString() } : {})); return out(hit);
    }
    if (method === 'DELETE') {
      if (table === 'restore_audit' || table === 'notes_backup') return Response.json({ message: 'append-only' }, { status: 403 });
      const hit = T[table].filter(match); T[table] = T[table].filter((r) => !match(r)); return out(hit);
    }
    return Response.json({ message: 'unsupported' }, { status: 405 });
  };
  // 10단계 트리거 흉내: 메모가 처음 들어갈 때 한 번만 사본
  const seedBackup = (n) => {
    if (!n.owner_id || T.notes_backup.some((b) => b.public_id === n.public_id)) return;
    T.notes_backup.push({ public_id: n.public_id, owner_id: n.owner_id, title: n.title ?? '', content: n.content ?? '',
      title_sha256: sha(n.title ?? ''), content_sha256: sha(n.content ?? ''), created_at: n.created_at, captured_at: new Date().toISOString() });
  };
  const addNote = (owner, label = 'x') => {
    const now = new Date().toISOString();
    const n = { id: ++seq, public_id: randomUUID(), owner_id: owner, title: `가상 메모 ${label}`, content: `가상 내용 ${label}`, sample_marker: null, created_at: now, updated_at: now };
    T.notes.push(n); seedBackup(n); return n.public_id;
  };
  return { T, handle, failures, addNote };
}

// ---------- 전역 fetch 가로채기(JWKS + 가짜 Supabase) ----------
export async function createWorld() {
  const jose = await import(pathToFileURL(join(repo, 'node_modules/jose/dist/webapi/index.js')).href);
  const keys = await jose.generateKeyPair('ES256', { extractable: true });
  const stranger = await jose.generateKeyPair('ES256', { extractable: true });
  const jwk = { ...(await jose.exportJWK(keys.publicKey)), kid: 'k', alg: 'ES256', use: 'sig' };
  const db = createFakeSupabase();
  let jwksDown = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input?.url ?? input));
    if (url.href === `${issuer}/.well-known/jwks.json`) return jwksDown ? new Response('down', { status: 503 }) : Response.json({ keys: [jwk] });
    if (url.origin === ORIGIN) return db.handle(url, init);
    return new Response('blocked in local test', { status: 599 });
  };
  process.env.SUPABASE_URL = ORIGIN;
  process.env.SUPABASE_SECRET_KEY = 'local-only-test-key';
  process.env.VERCEL_GIT_COMMIT_SHA = 'local000000';
  const quiet = { warn: console.warn, error: console.error, log: console.log };
  console.warn = () => {}; console.error = () => {};
  const stamp = `${Date.now()}-${Math.random()}`;
  const load = async (p) => (await import(`${pathToFileURL(join(repo, p)).href}?monsters=${stamp}`));
  const notes = (await load('api/notes.js')).default;
  const restore = (await load('api/restore.js')).default;
  const ops = (await load('api/ops.js')).default;
  const { createDeviceGate } = await load('src/device-gate.mjs');
  const { canonicalRequest, sha256Hex } = await load('src/device-proof.mjs');
  const { ownerKeyOf } = await load('src/owner-key.mjs');
  const middlewareMatcher = matcherFromSource(readFileSync(join(repo, 'middleware.js'), 'utf8'));

  const now = () => Math.floor(Date.now() / 1000);
  const token = (sub, { key = keys.privateKey, exp = now() + 600, iss = issuer, aud = config.identityProvider.audience } = {}) => new jose.SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'ES256', kid: 'k' }).setIssuer(iss).setAudience(aud).setSubject(sub).setIssuedAt(now() - 5).setExpirationTime(exp).sign(key);
  const users = { A: randomUUID(), B: randomUUID() };
  const tokens = {
    none: null,
    forged: `Bearer ${await token(users.A, { key: stranger.privateKey })}`,
    expired: `Bearer ${await token(users.A, { exp: now() - 60 })}`,
    wrongIssuer: `Bearer ${await token(users.A, { iss: 'https://evil.example/auth/v1' })}`,
    A: `Bearer ${await token(users.A)}`,
    B: `Bearer ${await token(users.B)}`,
  };
  const ownerOf = (who) => ownerKeyOf({ userId: users[who], kind: 'student' });

  // 기기: 상태별 자격 + 세션(서명 키는 실제 WebCrypto P-256)
  async function device(who, { status = 'approved', sessionExpired = false } = {}) {
    const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
    const pub = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
    const cred = { id: randomUUID(), owner_id: ownerOf(who), credential_id: `mem:${randomUUID()}`, public_key: '{}', counter: 0, transports: [], status, created_at: new Date().toISOString() };
    db.T.device_credentials.push(cred);
    const session = { id: randomUUID(), owner_id: ownerOf(who), credential_row: cred.id, public_jwk: { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y },
      expires_at: new Date(Date.now() + (sessionExpired ? -60_000 : 3_600_000)).toISOString(), created_at: new Date().toISOString() };
    db.T.device_sessions.push(session);
    const sign = async ({ method, path, body = '', timestamp = Date.now(), nonce = Buffer.from(webcrypto.getRandomValues(new Uint8Array(18))).toString('base64url'), sessionId = session.id }) => {
      const u = new URL(path, 'https://app.test');
      const canonical = canonicalRequest({ method, pathname: u.pathname, search: u.search, bodySha256: sha256Hex(body), timestamp, nonce, sessionId });
      const sig = Buffer.from(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(canonical))).toString('base64url');
      return { 'X-Device-Session': sessionId, 'X-Device-Timestamp': String(timestamp), 'X-Device-Nonce': nonce, 'X-Device-Signature': sig };
    };
    return { cred, session, sign, setStatus: (s) => { cred.status = s; } };
  }

  // ---------- Vercel 흉내: matcher → middleware(gate) → rewrites → 함수 ----------
  // headerLines: [[이름, 값], ...] — 같은 이름이 여러 번 올 수 있음(H16).
  // mode.middlewareHeaders: 'combine'(Fetch 표준: 같은 이름을 ", "로 합침) | 'first'
  // mode.functionHeaders: 'first'(Node: authorization 등은 첫 값만) | 'combine'
  // mode.gate: 바꿔 끼울 gate(오류 흉내 등)
  const defaultGate = createDeviceGate();
  async function send({ method = 'GET', path, headerLines = [], body, contentType }, mode = {}) {
    const url = new URL(path, 'https://app.test');
    const bodyText = body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body));
    const lines = [...headerLines];
    if (bodyText !== undefined) lines.push(['content-type', contentType ?? 'application/json']);
    const fold = (how) => {
      const h = new Headers();
      for (const [k, v] of lines) { if (how === 'first' && h.has(k)) continue; h.append(k, v); }
      return h;
    };
    const gated = middlewareMatcher(url.pathname);
    if (gated) {
      const gate = mode.gate ?? defaultGate;
      let denied;
      try {
        denied = await gate(new Request(url.href, { method, headers: fold(mode.middlewareHeaders ?? 'combine'), body: ['GET', 'HEAD'].includes(method) ? undefined : bodyText }));
      } catch { denied = Response.json({ error: 'DEVICE_CHECK_FAILED' }, { status: 403 }); } // middleware.js의 catch와 같음
      if (denied) return { status: denied.status, body: await denied.json().catch(() => null), layer: 'middleware' };
    }
    // vercel.json rewrites
    let fnPath = url.pathname; const query = {};
    for (const rw of vercel.rewrites ?? []) {
      const re = new RegExp(`^${rw.source.replace(/:([a-z]+)/giu, '(?<$1>[^/]+)')}$`, 'u');
      const m = re.exec(url.pathname);
      if (m) { const dest = rw.destination.replace(/:([a-z]+)/giu, (_, n) => m.groups[n]); const d = new URL(dest, 'https://app.test'); fnPath = d.pathname; for (const [k, v] of d.searchParams) addQuery(query, k, decodeURIComponent(v)); break; }
    }
    for (const [k, v] of url.searchParams) addQuery(query, k, v); // Vercel req.query: 같은 키는 배열
    const handler = { '/api/notes': notes, '/api/notes.js': notes, '/api/restore': restore, '/api/restore.js': restore, '/api/ops': ops, '/api/ops.js': ops }[fnPath];
    if (!handler) return { status: 404, body: null, layer: 'router' };
    const fnHeaders = {};
    for (const [k, v] of fold(mode.functionHeaders ?? 'first')) fnHeaders[k] = v;
    let parsed = bodyText;
    if (bodyText !== undefined && /json/iu.test(fnHeaders['content-type'] ?? '')) { try { parsed = JSON.parse(bodyText); } catch { parsed = bodyText; } }
    const res = { statusCode: 200, headers: {}, payload: undefined,
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; },
      json(b) { this.payload = b; return this; }, end() { return this; }, send(b) { this.payload = b; return this; } };
    await handler({ method, url: url.pathname + url.search, query, headers: fnHeaders, body: parsed }, res);
    return { status: res.statusCode, body: res.payload ?? null, layer: 'function', headers: res.headers };
  }
  const restoreConsole = () => { console.warn = quiet.warn; console.error = quiet.error; globalThis.fetch = realFetch; };
  return { db, users, tokens, ownerOf, device, send, createDeviceGate, setJwksDown: (v) => { jwksDown = v; }, restoreConsole, config };
}

function addQuery(q, k, v) { if (k in q) q[k] = [].concat(q[k], v); else q[k] = v; }

// middleware.js의 matcher 배열을 그대로 읽어 path-to-regexp 규칙(:path*)을 흉내 냅니다(대소문자 구분).
export function matcherFromSource(src) {
  const m = /matcher:\s*\[([^\]]+)\]/u.exec(src);
  const pats = [...m[1].matchAll(/'([^']+)'/gu)].map((x) => x[1]);
  const res = pats.map((p) => new RegExp(`^${p.replace(/\./gu, '\\.').replace(/\/:path\*/gu, '(?:/.*)?')}$`, 'u'));
  return (pathname) => res.some((re) => re.test(pathname));
}

// ---------- 오라클(규칙표) ----------
// 관문 규칙(README 11단계·src/device-gate.mjs 머리말에 적힌 순서):
//  보호 경로가 아니면 → 함수로 / 토큰 없음·검증 안 됨 → 함수로(함수가 401)
//  서명 머리글 없음 REQUIRED → 모양 틀림 INVALID → 시각 ±2분 밖 EXPIRED → 세션 없음·만료·남의 것·기기 미승인 NOT_APPROVED
//  → 서명 불일치 SIGNATURE_INVALID → 번호 재사용 REPLAYED → 통과
//  (12단계 마무리 수정 뒤) 토큰 머리글이 있는데 검증 안 됨 → 앞단 401 LOGIN_REQUIRED
export function gateOracle(c) {
  if (c.identity === 'none') return { pass: true };
  if (!c.validToken) return { status: 401, code: 'LOGIN_REQUIRED' };
  if (c.sig === 'none') return { code: 'DEVICE_PROOF_REQUIRED' };
  if (c.sig === 'malformed') return { code: 'DEVICE_PROOF_INVALID' };
  if (c.sig === 'ts_past' || c.sig === 'ts_future') return { code: 'DEVICE_PROOF_EXPIRED' };
  if (c.device !== 'approved') return { code: 'DEVICE_NOT_APPROVED' };
  if (['tamper_method', 'tamper_path', 'tamper_query', 'tamper_body'].includes(c.sig)) return { code: 'DEVICE_SIGNATURE_INVALID' };
  if (c.sig === 'replay') return { code: 'DEVICE_PROOF_REPLAYED' };
  return { pass: true };
}
// 함수 규칙(README 3·4·8·10·12단계): 로그인 401 → 메서드 405 → 대상(내 것 2xx, 남의 것 403 OWNER_MISMATCH, 없음 404)
export function apiOracle(c) {
  // 복구·작전실은 로그인보다 메서드를 먼저 봅니다(둘 다 거부, 순서만 다름: 토큰 없는 다른 메서드는 405).
  if (!c.validToken) return (c.api === 'restore' && c.method !== 'POST') || (c.api === 'ops' && c.method !== 'GET') ? { status: [401, 405] } : { status: [401] };
  if (c.api === 'notes') {
    const one = c.target !== 'collection';
    const allowed = one ? ['GET', 'PUT', 'DELETE'] : ['GET', 'POST'];
    if (!allowed.includes(c.method)) return { status: [405] };
    if (!one) return { status: [c.method === 'POST' ? 201 : 200], ownOnly: c.method === 'GET' };
    if (c.target === 'missing') return { status: [404] };
    if (c.target === 'other') return { status: [403], error: 'OWNER_MISMATCH' };
    return { status: [c.method === 'DELETE' ? 204 : 200] };
  }
  if (c.api === 'restore') {
    if (c.method !== 'POST') return { status: [405] };
    if (c.target === 'own') return { status: [200], verified: true };
    return { status: [404], error: 'BACKUP_NOT_FOUND' };
  }
  if (c.api === 'ops') return c.method === 'GET' ? { status: [200], ownOnly: true } : { status: [405] };
  throw new Error('unknown api');
}
