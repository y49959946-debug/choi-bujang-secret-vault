// 10단계 로컬 재시험용 가짜 자료실 (메모리 안 가짜 DB + 이 실행에서만 만든 가짜 서명 키)
// 실제 Supabase·배포·심판에는 접속하지 않습니다. 메모 본문·토큰·키는 출력하지 않습니다.
// 가짜 DB는 supabase/notes-step10-restore.sql과 같은 규칙을 흉내 냅니다:
//   메모가 처음 들어갈 때 사본을 한 번만 만들고(이후 수정 무시), 사본은 서버도 쓸 수 없고, 감사 기록은 넣기만 됩니다.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const sha256 = (text) => createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex');

export function fakeVaultReady(root) {
  return existsSync(join(resolve(root), 'node_modules/jose/dist/webapi/index.js'));
}

export async function createFakeVault(root) {
  root = resolve(root);
  const config = JSON.parse(readFileSync(join(root, 'aleph.config.json'), 'utf8'));
  const issuer = config.identityProvider.issuer;
  const origin = new URL(issuer).origin;
  const judgeIssuer = config.judgeIssuer;
  const jose = await import(pathToFileURL(join(root, 'node_modules/jose/dist/webapi/index.js')).href);
  const kid = 'recheck';
  const pair = await jose.generateKeyPair('ES256', { extractable: true });
  const stranger = await jose.generateKeyPair('ES256', { extractable: true }); // 서명 위조 시험용(공개키 목록에 없음)
  const jwk = { ...(await jose.exportJWK(pair.publicKey)), kid, alg: 'ES256', use: 'sig' };
  const now = Math.floor(Date.now() / 1000);

  const studentToken = (sub, { key = pair.privateKey, exp = now + 600, iat = now, iss = issuer, aud = config.identityProvider.audience } = {}) => new jose.SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'ES256', kid }).setIssuer(iss).setAudience(aud)
    .setSubject(sub).setIssuedAt(iat).setExpirationTime(exp).sign(key);
  const judgeToken = (sub, run, who, { key = pair.privateKey, exp = now + 600, iat = now, iss = judgeIssuer, aud = new URL(config.publicAppUrl).hostname } = {}) => new jose.SignJWT({ aleph_run: run, aleph_role: 'judge', aleph_identity: who })
    .setProtectedHeader({ alg: 'ES256', kid }).setIssuer(iss).setAudience(aud)
    .setSubject(sub).setIssuedAt(iat).setExpirationTime(exp).sign(key);

  const db = { notes: [], notes_backup: [], restore_audit: [] };
  const insertNote = (row) => {
    if (db.notes.some((r) => r.public_id === row.public_id)) return false;
    const full = { created_at: new Date().toISOString(), ...row };
    db.notes.push(full);
    if (full.owner_id && !db.notes_backup.some((b) => b.public_id === full.public_id)) { // 트리거 흉내: 처음 한 번만
      db.notes_backup.push({ public_id: full.public_id, owner_id: full.owner_id, title: full.title ?? '', content: full.content ?? '',
        title_sha256: sha256(full.title ?? ''), content_sha256: sha256(full.content ?? ''), created_at: full.created_at, captured_at: new Date().toISOString() });
    }
    return true;
  };

  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input?.url ?? input));
    const method = (init.method ?? 'GET').toUpperCase();
    if (url.href === `${issuer}/.well-known/jwks.json` || url.href === `${judgeIssuer}/.well-known/jwks.json`) return Response.json({ keys: [jwk] });
    const table = url.pathname.replace('/rest/v1/', '');
    if (url.origin !== origin || !(table in db)) return new Response('blocked', { status: 599 });
    const filters = [...url.searchParams].filter(([, v]) => v.startsWith('eq.')).map(([k, v]) => [k, v.slice(3)]);
    const match = (r) => filters.every(([k, v]) => String(r[k]) === v);
    const select = url.searchParams.get('select');
    const pick = (r) => (select ? Object.fromEntries(select.split(',').map((c) => c.trim()).map((c) => [c, r[c]])) : r);
    const single = (new Headers(init.headers).get('accept') || '').includes('vnd.pgrst.object');
    const out = (list) => (single
      ? (list.length === 1 ? Response.json(pick(list[0])) : Response.json({ code: 'PGRST116' }, { status: 406 }))
      : Response.json(list.map(pick)));
    if (method === 'GET') return out(db[table].filter(match));
    if (method === 'POST') {
      const body = JSON.parse(init.body);
      if (table === 'restore_audit') { db.restore_audit.push({ id: db.restore_audit.length + 1, ...body }); return new Response(null, { status: 201 }); }
      if (table === 'notes_backup') return Response.json({ code: '42501' }, { status: 403 });
      return insertNote(body) ? new Response(null, { status: 201 }) : Response.json({ code: '23505' }, { status: 409 });
    }
    if (method === 'PATCH' && table === 'notes') { const body = JSON.parse(init.body); const hit = db.notes.filter(match); hit.forEach((r) => Object.assign(r, body)); return out(hit); }
    if (method === 'DELETE' && table === 'notes') { const hit = db.notes.filter(match); db.notes = db.notes.filter((r) => !match(r)); return out(hit); }
    return Response.json({ code: 'append-only' }, { status: 400 });
  };
  const saved = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY, warn: console.warn, error: console.error };
  process.env.SUPABASE_URL = origin;
  process.env.SUPABASE_SECRET_KEY = 'recheck-local-only';
  console.warn = () => {}; console.error = () => {};

  const stamp = `${Date.now()}-${Math.random()}`;
  const notesHandler = (await import(`${pathToFileURL(join(root, 'api/notes.js')).href}?recheck=${stamp}`)).default;
  const restoreHandler = (await import(`${pathToFileURL(join(root, 'api/restore.js')).href}?recheck=${stamp}`)).default;
  const call = async (handler, method, path, token, body, query) => {
    const r = { headers: {}, setHeader(k, v) { r.headers[k.toLowerCase()] = v; }, status(c) { r.code = c; return { json(b) { r.body = b; }, end() {} }; } };
    const id = /^\/api\/notes\/([^?]+)/u.exec(path)?.[1];
    await handler({ method, url: path, query: query ?? (id ? { id } : {}), headers: token ? { authorization: `Bearer ${token}` } : {}, body }, r);
    return r;
  };
  const close = () => {
    globalThis.fetch = realFetch;
    console.warn = saved.warn; console.error = saved.error;
    if (saved.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = saved.url;
    if (saved.key === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = saved.key;
  };
  return {
    db, config, now, close,
    studentToken, judgeToken, strangerKey: stranger.privateKey,
    notes: (...a) => call(notesHandler, ...a),
    restore: (...a) => call(restoreHandler, ...a),
  };
}
