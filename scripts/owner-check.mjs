// npm run owner:check
// 메모 API(api/notes.js)의 소유자 검증을 로컬에서 확인합니다. 실제 Supabase·배포에는 접속하지 않습니다.
//   - 메모리 안의 가짜 DB와, 이 실행에서만 만든 가짜 서명 키로 학생 A·B 토큰을 만듭니다.
//   - 소유자는 가짜 DB 행의 owner_id로만 정해집니다(요청 본문의 값은 쓰지 않음).
//   - 기대: B가 A 메모 조회·수정·삭제 → 403, B 목록에 A 메모 없음, A 본인 조회·수정·추가·삭제 → 허용, 비로그인 → 401.
// 메모 본문·토큰·키는 출력하지 않습니다. 이 결과는 로컬 연습이며 심판 판정이 아닙니다.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function runOwnerCheck(root) {
  root = resolve(root);
  const config = JSON.parse(readFileSync(join(root, 'aleph.config.json'), 'utf8'));
  const issuer = config.identityProvider.issuer;
  const origin = new URL(issuer).origin;
  const josePath = join(root, 'node_modules/jose/dist/webapi/index.js');
  if (!existsSync(josePath)) {
    return [{ name: '준비 필요: node_modules가 없습니다. 저장소 폴더에서 npm install을 한 번 실행하세요', passed: false }];
  }
  const jose = await import(pathToFileURL(josePath).href);
  const { publicKey, privateKey } = await jose.generateKeyPair('ES256', { extractable: true });
  const jwk = { ...(await jose.exportJWK(publicKey)), kid: 'owner-check', alg: 'ES256', use: 'sig' };
  const now = Math.floor(Date.now() / 1000);
  const A = crypto.randomUUID(); const B = crypto.randomUUID();
  const token = (sub) => new jose.SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'ES256', kid: 'owner-check' })
    .setIssuer(issuer).setAudience(config.identityProvider.audience).setSubject(sub).setIssuedAt(now).setExpirationTime(now + 600).sign(privateKey);

  let rows = [
    { public_id: crypto.randomUUID(), owner_id: A, title: 'A의 가상 메모', content: 'a', created_at: '2026-01-01', id: 1 },
    { public_id: crypto.randomUUID(), owner_id: B, title: 'B의 가상 메모', content: 'b', created_at: '2026-01-02', id: 2 },
  ];
  const aNote = rows[0].public_id;
  const snapshotA = () => JSON.stringify(rows.filter((r) => r.owner_id === A));
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input?.url ?? input));
    const method = (init.method ?? 'GET').toUpperCase();
    if (url.href === `${issuer}/.well-known/jwks.json`) return Response.json({ keys: [jwk] });
    if (url.origin !== origin || !url.pathname.startsWith('/rest/v1/notes')) return new Response('blocked', { status: 599 });
    const filters = [...url.searchParams].filter(([, v]) => v.startsWith('eq.')).map(([k, v]) => [k, v.slice(3)]);
    const match = (r) => filters.every(([k, v]) => String(r[k]) === v);
    const select = url.searchParams.get('select');
    const pick = (r) => (select ? Object.fromEntries(select.split(',').map((c) => c.trim()).map((c) => [c, r[c]])) : r);
    const single = (new Headers(init.headers).get('accept') || '').includes('vnd.pgrst.object');
    const out = (list, status = 200) => (single
      ? (list.length === 1 ? Response.json(pick(list[0]), { status }) : Response.json({ code: 'PGRST116' }, { status: 406 }))
      : Response.json(list.map(pick), { status }));
    if (method === 'GET') return out(rows.filter(match));
    if (method === 'POST') { const body = JSON.parse(init.body); rows.push({ id: rows.length + 1, created_at: new Date().toISOString(), ...body }); return new Response(null, { status: 201 }); }
    if (method === 'PATCH') { const body = JSON.parse(init.body); const hit = rows.filter(match); hit.forEach((r) => Object.assign(r, body)); return out(hit); }
    if (method === 'DELETE') { const hit = rows.filter(match); rows = rows.filter((r) => !match(r)); return out(hit); }
    return new Response('unsupported', { status: 405 });
  };
  const saved = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY };
  process.env.SUPABASE_URL = origin;
  process.env.SUPABASE_SECRET_KEY = 'owner-check-local-only';
  const quiet = { warn: console.warn, error: console.error };
  console.warn = () => {}; console.error = () => {};
  const results = [];
  try {
    const { default: handler } = await import(`${pathToFileURL(join(root, 'api/notes.js')).href}?owner-check=${Date.now()}`);
    const call = async (method, path, tok, body) => {
      const r = { headers: {}, setHeader(k, v) { r.headers[k.toLowerCase()] = v; }, status(c) { r.code = c; return { json(b) { r.body = b; }, end() {} }; } };
      const id = /^\/api\/notes\/([^?]+)/u.exec(path)?.[1];
      await handler({ method, url: path, query: id ? { id } : {}, headers: tok ? { authorization: `Bearer ${tok}` } : {}, body }, r);
      return r;
    };
    const ta = await token(A); const tb = await token(B);
    const check = (name, ok) => results.push({ name, passed: Boolean(ok) });
    let before = snapshotA();
    let r = await call('GET', `/api/notes/${aNote}`, tb); check('B가 A 메모 조회 → 403', r.code === 403 && !JSON.stringify(r.body).includes('A의 가상 메모'));
    r = await call('PUT', `/api/notes/${aNote}`, tb, { title: 'x', body: 'y' }); check('B가 A 메모 수정 → 403, A 메모 그대로', r.code === 403 && snapshotA() === before);
    r = await call('DELETE', `/api/notes/${aNote}`, tb); check('B가 A 메모 삭제 → 403, A 메모 그대로', r.code === 403 && snapshotA() === before);
    r = await call('GET', '/api/notes', tb); check('B 목록에 A 메모 없음', r.code === 200 && Array.isArray(r.body) && !r.body.some((n) => n.id === aNote));
    r = await call('GET', `/api/notes/${aNote}`); check('비로그인 조회 → 401', r.code === 401);
    r = await call('GET', `/api/notes/${aNote}`, ta); check('A 본인 메모 조회 → 200', r.code === 200 && r.body?.id === aNote);
    r = await call('PUT', `/api/notes/${aNote}`, ta, { title: '고침', body: 'z' }); check('A 본인 메모 수정 → 200', r.code === 200);
    r = await call('POST', '/api/notes', ta, { title: '새 메모', body: 'n' }); const created = r.body?.id; check('A 메모 추가 → 201', r.code === 201 && created);
    r = await call('DELETE', `/api/notes/${created}`, ta); check('A 메모 삭제 → 204', r.code === 204);
  } catch (error) {
    results.push({ name: `실행 오류: ${error?.message ?? 'unknown'}`, passed: false });
  } finally {
    globalThis.fetch = realFetch;
    console.warn = quiet.warn; console.error = quiet.error;
    if (saved.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = saved.url;
    if (saved.key === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = saved.key;
  }
  return results;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const results = await runOwnerCheck(resolve(import.meta.dirname, '..'));
  for (const item of results) process.stdout.write(`${item.passed ? '통과' : '확인 필요'} · ${item.name}\n`);
  process.stdout.write('가짜 DB로 한 로컬 확인이며 실제 Supabase나 심판 판정이 아닙니다.\n');
  if (results.some((item) => !item.passed)) process.exitCode = 1;
}
