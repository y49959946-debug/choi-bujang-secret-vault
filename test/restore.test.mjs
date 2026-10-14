// 10단계 제작 3 · POST /api/restore 시험 (메모리 안 가짜 DB, 실제 Supabase·배포에는 접속하지 않음)
// 가짜 DB는 supabase/notes-step10-restore.sql과 같은 규칙을 흉내 냅니다:
//   메모가 처음 들어갈 때 사본을 한 번만 만들고(이후 수정 무시), 감사 기록은 넣기만 됩니다.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = resolve(import.meta.dirname, '..');
const sha = (t) => createHash('sha256').update(String(t ?? ''), 'utf8').digest('hex');
const ready = existsSync(join(repo, 'node_modules/jose/dist/webapi/index.js'));

let sharedKeys = null;
async function setup() {
  const config = JSON.parse(readFileSync(join(repo, 'aleph.config.json'), 'utf8'));
  const issuer = config.identityProvider.issuer;
  const origin = new URL(issuer).origin;
  const judgeIssuer = config.judgeIssuer;
  const jose = await import(pathToFileURL(join(repo, 'node_modules/jose/dist/webapi/index.js')).href);
  // 라이브러리가 서명 공개키를 실행 동안 캐시하므로, 시험 전체에서 같은 가짜 키 하나를 씁니다.
  sharedKeys ??= (async () => { const k = await jose.generateKeyPair('ES256', { extractable: true });
    return { keys: k, jwk: { ...(await jose.exportJWK(k.publicKey)), kid: 'k', alg: 'ES256', use: 'sig' } }; })();
  const { keys, jwk } = await sharedKeys;
  const now = Math.floor(Date.now() / 1000);
  const student = (sub) => new jose.SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'ES256', kid: 'k' })
    .setIssuer(issuer).setAudience(config.identityProvider.audience).setSubject(sub).setIssuedAt(now).setExpirationTime(now + 600).sign(keys.privateKey);
  const judge = (sub, run, who) => new jose.SignJWT({ aleph_run: run, aleph_role: 'judge', aleph_identity: who })
    .setProtectedHeader({ alg: 'ES256', kid: 'k' }).setIssuer(judgeIssuer).setAudience(new URL(config.publicAppUrl).hostname)
    .setSubject(sub).setIssuedAt(now).setExpirationTime(now + 600).sign(keys.privateKey);

  const db = { notes: [], notes_backup: [], restore_audit: [], failAudit: false, failAuditFrom: Infinity, auditCalls: 0, backupReads: 0, tamperBackupOnRead: 0 };
  const insertNote = (row) => {
    if (db.notes.some((r) => r.public_id === row.public_id)) return false;
    const full = { created_at: new Date().toISOString(), ...row };
    db.notes.push(full);
    if (full.owner_id && !db.notes_backup.some((b) => b.public_id === full.public_id)) { // 트리거 흉내: 한 번만
      db.notes_backup.push({ public_id: full.public_id, owner_id: full.owner_id, title: full.title ?? '', content: full.content ?? '',
        title_sha256: sha(full.title ?? ''), content_sha256: sha(full.content ?? ''), created_at: full.created_at, captured_at: new Date().toISOString() });
    }
    return true;
  };
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
    const out = (list) => (single ? (list.length === 1 ? Response.json(pick(list[0])) : list.length === 0 ? Response.json({ code: 'PGRST116' }, { status: 406 }) : Response.json({}, { status: 406 }))
      : Response.json(list.map(pick)));
    if (method === 'GET') {
      if (table === 'notes_backup') { db.backupReads += 1; if (db.backupReads === db.tamperBackupOnRead) db.notes_backup.forEach((b) => { b.content = '읽는 사이 바뀐 사본'; b.content_sha256 = sha('읽는 사이 바뀐 사본'); }); }
      return out(db[table].filter(match));
    }
    if (method === 'POST') {
      const body = JSON.parse(init.body);
      if (table === 'restore_audit') { db.auditCalls += 1; if (db.failAudit || db.auditCalls >= db.failAuditFrom) return Response.json({ code: '42501' }, { status: 403 }); db.restore_audit.push({ id: db.restore_audit.length + 1, ...body }); return new Response(null, { status: 201 }); }
      if (table === 'notes_backup') return Response.json({ code: '42501' }, { status: 403 });
      return insertNote(body) ? new Response(null, { status: 201 }) : Response.json({ code: '23505' }, { status: 409 });
    }
    if (method === 'PATCH' && table === 'notes') { const body = JSON.parse(init.body); const hit = db.notes.filter(match); hit.forEach((r) => Object.assign(r, body)); return out(hit); }
    if (method === 'DELETE' && table === 'notes') { const hit = db.notes.filter(match); db.notes = db.notes.filter((r) => !match(r)); return out(hit); }
    return Response.json({ code: 'append-only' }, { status: 400 });
  };
  process.env.SUPABASE_URL = origin;
  process.env.SUPABASE_SECRET_KEY = 'restore-test-local-only';
  console.warn = () => {}; console.error = () => {};
  const stamp = Date.now() + Math.random();
  const notes = (await import(`${pathToFileURL(join(repo, 'api/notes.js')).href}?t=${stamp}`)).default;
  const restore = (await import(`${pathToFileURL(join(repo, 'api/restore.js')).href}?t=${stamp}`)).default;
  const call = async (handler, method, path, token, body, query) => {
    const r = { headers: {}, setHeader(k, v) { r.headers[k.toLowerCase()] = v; }, status(c) { r.code = c; return { json(b) { r.body = b; }, end() {} }; } };
    const id = /^\/api\/notes\/([^?]+)/u.exec(path)?.[1];
    await handler({ method, url: path, query: query ?? (id ? { id } : {}), headers: token ? { authorization: `Bearer ${token}` } : {}, body }, r);
    return r;
  };
  return { db, student, judge, notes: (...a) => call(notes, ...a), restore: (...a) => call(restore, ...a) };
}

const A = crypto.randomUUID(); const B = crypto.randomUUID();
const ORIGINAL = { title: 'B의 가상 메모', body: '침해 전 내용\n둘째 줄 😀' };

async function scenario() {
  const env = await setup();
  const ta = await env.student(A); const tb = await env.student(B);
  await env.notes('POST', '/api/notes', ta, { title: 'A의 가상 메모', body: 'A 내용' });
  const made = await env.notes('POST', '/api/notes', tb, ORIGINAL);
  return { ...env, ta, tb, id: made.body.id };
}
const snapshotOthers = (db, id) => JSON.stringify(db.notes.filter((r) => r.public_id !== id));

test('변조된 B 메모: B가 복원하면 그 한 건의 ID·소유자·내용 해시가 사본과 같아진다', { skip: !ready && 'npm install 필요' }, async () => {
  const env = await scenario();
  await env.notes('PUT', `/api/notes/${env.id}`, env.tb, { title: '변조', body: '변조된 내용' });
  const others = snapshotOthers(env.db, env.id);
  const r = await env.restore('POST', '/api/restore', env.tb, { id: env.id });
  assert.equal(r.code, 200);
  assert.deepEqual(r.body.verified, { id: true, owner: true, contentHash: true });
  assert.equal(r.body.auditRecorded, true);
  assert.equal(r.body.backupReread, true);
  // 응답만으로 ID·소유자·해시 대조(심판은 다시 조회하지 않음)
  const bk = env.db.notes_backup.find((b) => b.public_id === env.id);
  assert.equal(r.body.id, bk.public_id);
  assert.equal(r.body.ownerId, bk.owner_id);
  assert.equal(r.body.contentSha256, bk.content_sha256);
  assert.equal(r.body.titleSha256, bk.title_sha256);
  assert.deepEqual(r.body.restoredNote, { id: bk.public_id, ownerId: bk.owner_id, titleSha256: bk.title_sha256, contentSha256: bk.content_sha256 });
  assert.equal(r.body.backup.ownerId, bk.owner_id);
  assert.deepEqual([r.body.owner, r.body.owner_id], [bk.owner_id, bk.owner_id], '다른 이름도 같은 소유자');
  assert.deepEqual([r.body.contentHash, r.body.content_sha256, r.body.title_sha256], [bk.content_sha256, bk.content_sha256, bk.title_sha256], '다른 이름도 같은 해시');
  assert.deepEqual(r.body.changes, ['title', 'content']);
  assert.match(String(r.body.backupVersion?.capturedAt), /^\d{4}-/u);
  const row = env.db.notes.find((n) => n.public_id === env.id);
  const backup = env.db.notes_backup.find((b) => b.public_id === env.id);
  assert.equal(row.public_id, backup.public_id);
  assert.equal(row.owner_id, backup.owner_id);
  assert.equal(sha(row.content), backup.content_sha256);
  assert.equal(r.body.contentSha256, backup.content_sha256);
  assert.equal(JSON.stringify(r.body).includes('침해 전 내용'), false, '응답에 본문 없음');
  assert.equal(snapshotOthers(env.db, env.id), others, '다른 메모 보존');
  assert.deepEqual(env.db.restore_audit.map((a) => a.result), ['started', 'restored']);
  assert.equal(JSON.stringify(env.db.restore_audit).includes('침해 전 내용'), false, '감사 기록에 본문 없음');
});

test('삭제된 B 메모: 그 한 건만 다시 넣고 ID·소유자·해시가 사본과 같다', { skip: !ready && 'npm install 필요' }, async () => {
  const env = await scenario();
  await env.notes('DELETE', `/api/notes/${env.id}`, env.tb);
  const count = env.db.notes.length;
  const r = await env.restore('POST', '/api/restore', env.tb, { id: env.id });
  assert.equal(r.code, 200);
  assert.equal(env.db.notes.length, count + 1);
  const row = env.db.notes.find((n) => n.public_id === env.id);
  assert.equal(row.owner_id, env.db.notes_backup.find((b) => b.public_id === env.id).owner_id);
  assert.equal(sha(row.content), sha(ORIGINAL.body));
  assert.equal(r.body.ownerId, row.owner_id, '삭제 뒤 복구 응답에도 소유자');
  assert.equal(r.body.contentSha256, sha(ORIGINAL.body), '삭제 뒤 복구 응답에도 내용 해시');
  const read = await env.notes('GET', `/api/notes/${env.id}`, env.tb);
  assert.equal(read.code, 200, 'B는 복원한 메모를 다시 읽을 수 있음');
});

test('A는 B 메모를 복원할 수 없고, 아무것도 바뀌지 않는다', { skip: !ready && 'npm install 필요' }, async () => {
  const env = await scenario();
  await env.notes('PUT', `/api/notes/${env.id}`, env.tb, { title: '변조', body: '변조된 내용' });
  const before = JSON.stringify(env.db.notes);
  const r = await env.restore('POST', '/api/restore', env.ta, { id: env.id });
  assert.equal(r.code, 404);
  assert.equal(JSON.stringify(env.db.notes), before);
  const after = await env.notes('GET', `/api/notes/${env.id}`, env.ta);
  assert.equal(after.code, 403, 'B의 A 메모 요청처럼, A의 B 메모 요청도 계속 거부');
});

test('본문의 owner_id·role 같은 칸, 쿼리, 잘못된 ID, GET, 비로그인은 거부한다', { skip: !ready && 'npm install 필요' }, async () => {
  const env = await scenario();
  const before = JSON.stringify(env.db.notes);
  for (const [label, args, code] of [
    ['owner_id 칸', ['POST', '/api/restore', env.ta, { id: env.id, owner_id: B }], 400],
    ['role 칸', ['POST', '/api/restore', env.tb, { id: env.id, role: 'instructor' }], 400],
    ['ID 두 개', ['POST', '/api/restore', env.tb, { id: [env.id, env.id] }], 400],
    ['잘못된 ID', ['POST', '/api/restore', env.tb, { id: 'export' }], 400],
    ['쿼리로 대상', ['POST', '/api/restore', env.tb, { id: env.id }, { id: env.id }], 400],
    ['GET', ['GET', '/api/restore', env.tb], 405],
    ['비로그인', ['POST', '/api/restore', null, { id: env.id }], 401],
    ['사본에 없는 ID', ['POST', '/api/restore', env.tb, { id: crypto.randomUUID() }], 404],
  ]) {
    const r = await env.restore(...args);
    assert.equal(r.code, code, label);
  }
  assert.equal(JSON.stringify(env.db.notes), before);
});

test('쓰기 직전에 사본을 다시 읽어 처음 검증한 사본과 다르면 멈추고 쓰지 않는다', { skip: !ready && 'npm install 필요' }, async () => {
  const env = await scenario();
  await env.notes('PUT', `/api/notes/${env.id}`, env.tb, { title: '변조', body: '변조된 내용' });
  env.db.tamperBackupOnRead = env.db.backupReads + 2; // 첫 읽기(검증)는 그대로, 다시 읽을 때 사본이 바뀜
  const before = JSON.stringify(env.db.notes);
  const r = await env.restore('POST', '/api/restore', env.tb, { id: env.id });
  assert.equal(r.code, 409);
  assert.equal(r.body.error, 'BACKUP_UNVERIFIED');
  assert.equal(JSON.stringify(env.db.notes), before);
});

test('사본이 변조됐으면(해시 불일치) 쓰지 않는다', { skip: !ready && 'npm install 필요' }, async () => {
  const env = await scenario();
  await env.notes('PUT', `/api/notes/${env.id}`, env.tb, { title: '변조', body: '변조된 내용' });
  env.db.notes_backup.find((b) => b.public_id === env.id).content = '사본 변조';
  const before = JSON.stringify(env.db.notes);
  const r = await env.restore('POST', '/api/restore', env.tb, { id: env.id });
  assert.equal(r.code, 409);
  assert.equal(r.body.error, 'BACKUP_INTEGRITY_FAILED');
  assert.equal(JSON.stringify(env.db.notes), before);
});

test('지금 행의 주인이 다른 사람으로 바뀌어 있으면 덮어쓰지 않는다', { skip: !ready && 'npm install 필요' }, async () => {
  const env = await scenario();
  env.db.notes.find((n) => n.public_id === env.id).owner_id = A;
  const before = JSON.stringify(env.db.notes);
  const r = await env.restore('POST', '/api/restore', env.tb, { id: env.id });
  assert.equal(r.code, 409);
  assert.equal(JSON.stringify(env.db.notes), before);
});

test('감사 시작 기록을 쓸 수 없으면 복원하지 않는다', { skip: !ready && 'npm install 필요' }, async () => {
  const env = await scenario();
  await env.notes('PUT', `/api/notes/${env.id}`, env.tb, { title: '변조', body: '변조된 내용' });
  env.db.failAudit = true;
  const before = JSON.stringify(env.db.notes);
  const r = await env.restore('POST', '/api/restore', env.tb, { id: env.id });
  assert.equal(r.code, 503);
  assert.equal(JSON.stringify(env.db.notes), before);
});

test('결과 감사 기록이 실패하면 응답에 auditRecorded:false로 알린다(시작 기록은 남음)', { skip: !ready && 'npm install 필요' }, async () => {
  const env = await scenario();
  await env.notes('PUT', `/api/notes/${env.id}`, env.tb, { title: '변조', body: '변조된 내용' });
  env.db.failAuditFrom = env.db.auditCalls + 2; // 시작 기록은 성공, 결과 기록부터 실패
  const r = await env.restore('POST', '/api/restore', env.tb, { id: env.id });
  assert.equal(r.code, 200);
  assert.equal(r.body.auditRecorded, false);
  assert.deepEqual(env.db.restore_audit.map((a) => a.result), ['started']);
});

test('두 번 복원해도 한 건만 남고, 앞선 감사 기록은 보존된다', { skip: !ready && 'npm install 필요' }, async () => {
  const env = await scenario();
  await env.notes('PUT', `/api/notes/${env.id}`, env.tb, { title: '변조', body: '변조된 내용' });
  await env.restore('POST', '/api/restore', env.tb, { id: env.id });
  const firstAudit = JSON.stringify(env.db.restore_audit);
  const r = await env.restore('POST', '/api/restore', env.tb, { id: env.id });
  assert.equal(r.code, 200);
  assert.equal(r.body.restored, false);
  assert.equal(env.db.notes.filter((n) => n.public_id === env.id).length, 1);
  assert.ok(JSON.stringify(env.db.restore_audit).startsWith(firstAudit.slice(0, -1)));
});

test('심판 시험 계정 A·B(같은 sub): 메모 API와 같은 소유자 키로 B만 B 메모를 복원한다', { skip: !ready && 'npm install 필요' }, async () => {
  const env = await setup();
  const sub = crypto.randomUUID(); const run = crypto.randomUUID();
  const ja = await env.judge(sub, run, 'a'); const jb = await env.judge(sub, run, 'b');
  const made = await env.notes('POST', '/api/notes', jb, ORIGINAL);
  assert.equal(made.code, 201);
  await env.notes('PUT', `/api/notes/${made.body.id}`, jb, { title: '변조', body: '변조된 내용' });
  assert.equal((await env.restore('POST', '/api/restore', ja, { id: made.body.id })).code, 404, '심판 A는 B 메모 복원 불가');
  const r = await env.restore('POST', '/api/restore', jb, { id: made.body.id });
  assert.equal(r.code, 200, '메모 API가 저장한 소유자 키와 복원 API의 소유자 키가 같음');
  const bk = env.db.notes_backup.find((b) => b.public_id === made.body.id);
  assert.deepEqual([r.body.id, r.body.ownerId, r.body.contentSha256], [bk.public_id, bk.owner_id, bk.content_sha256], '심판 B: 응답만으로 ID·소유자·해시 일치');
  assert.deepEqual(r.body.verified, { id: true, owner: true, contentHash: true });
});
