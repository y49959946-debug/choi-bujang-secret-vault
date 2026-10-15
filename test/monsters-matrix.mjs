// 12단계 마무리 · 축 조합 전수 실행기(로컬). test/monsters.test.mjs와 scripts/monsters-report.mjs가 씁니다.
import { randomUUID } from 'node:crypto';
import { gateOracle, apiOracle } from './monsters-lib.mjs';

export const AXES = {
  identity: ['none', 'forged', 'expired', 'wrongIssuer', 'A'],
  device: ['none', 'pending', 'approved', 'revoked', 'otherOwner', 'sessionExpired'],
  sig: ['valid', 'none', 'malformed', 'tamper_method', 'tamper_path', 'tamper_query', 'tamper_body', 'ts_past', 'ts_future', 'ts_edge_ok', 'replay'],
  call: [
    ...['own', 'other', 'missing'].flatMap((target) => ['GET', 'PUT', 'DELETE', 'POST', 'HEAD', 'OPTIONS', 'PATCH'].map((method) => ({ api: 'notes', target, method }))),
    ...['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'].map((method) => ({ api: 'notes', target: 'collection', method })),
    ...['own', 'other', 'missing'].flatMap((target) => ['POST', 'GET', 'PUT', 'DELETE'].map((method) => ({ api: 'restore', target, method }))),
    ...['GET', 'POST'].map((method) => ({ api: 'ops', target: 'self', method })),
  ],
};

const ALT = { GET: 'DELETE', DELETE: 'GET', PUT: 'POST', POST: 'PUT', HEAD: 'GET', OPTIONS: 'GET', PATCH: 'PUT' };
const noBody = (m) => ['GET', 'HEAD', 'DELETE', 'OPTIONS'].includes(m);

export async function runMatrix(w, { onCase } = {}) {
  const devices = {
    pending: await w.device('A', { status: 'pending' }),
    approved: await w.device('A'),
    revoked: await w.device('A', { status: 'revoked' }),
    otherOwner: await w.device('B'),
    sessionExpired: await w.device('A', { sessionExpired: true }),
  };
  const results = [];
  for (const identity of AXES.identity) for (const device of AXES.device) for (const sig of (device === 'none' ? ['none'] : AXES.sig)) for (const call of AXES.call) {
    // 매 경우 새 자료(앞 경우의 삭제·복구가 영향을 주지 않게)
    w.db.T.notes = []; w.db.T.notes_backup = []; w.db.T.restore_audit = []; w.db.T.device_request_nonces = [];
    const own = w.db.addNote(w.ownerOf('A'), 'own'); const other = w.db.addNote(w.ownerOf('B'), 'other');
    const id = { own, other, missing: randomUUID() }[call.target];
    const path = call.api === 'notes' ? (call.target === 'collection' ? '/api/notes' : `/api/notes/${id}`) : call.api === 'restore' ? '/api/restore' : '/api/ops';
    const bodyObj = call.api === 'restore' ? (noBody(call.method) ? undefined : { id }) : (noBody(call.method) ? undefined : { title: '가상 시험 제목', body: '가상 시험 내용' });
    const body = bodyObj === undefined ? undefined : JSON.stringify(bodyObj);
    const auth = w.tokens[identity];
    const headerLines = auth ? [['authorization', auth]] : [];
    const dev = devices[device];
    let proof = null;
    if (dev && sig !== 'none') {
      const s = (o) => dev.sign({ method: call.method, path, body: body ?? '', ...o });
      proof = await ({
        valid: () => s({}), replay: () => s({}),
        malformed: async () => ({ ...(await s({})), 'X-Device-Nonce': 'x' }),
        tamper_method: () => s({ method: ALT[call.method] }),
        tamper_path: () => s({ path: call.api === 'notes' ? `/api/notes/${randomUUID()}` : '/api/notes' }),
        tamper_query: () => s({ path: `${path}?q=1` }),
        tamper_body: () => s({ body: `${body ?? ''}{"x":1}` }),
        ts_past: () => s({ timestamp: Date.now() - 121_000 }), ts_future: () => s({ timestamp: Date.now() + 121_000 }),
        ts_edge_ok: () => s({ timestamp: Date.now() - 115_000 }),
      })[sig]();
    }
    const lines = [...headerLines, ...(proof ? Object.entries(proof) : [])];
    if (sig === 'replay') await w.send({ method: call.method, path, headerLines: lines, body }); // 1회째(같은 서명 첫 사용)
    const actual = await w.send({ method: call.method, path, headerLines: lines, body });
    const c = { identity, device, sig: device === 'none' ? 'none' : sig, ...call, validToken: identity === 'A' };
    const g = gateOracle(c);
    let ok; let expected;
    if (!g.pass) {
      const st = g.status ?? 403;
      expected = `${st} ${g.code} (middleware)`;
      ok = actual.layer === 'middleware' && actual.status === st && actual.body?.error === g.code;
    } else {
      const a = apiOracle(c);
      expected = `${a.status.join('|')}${a.error ? ` ${a.error}` : ''} (function)`;
      ok = actual.layer === 'function' && a.status.includes(actual.status) && (!a.error || actual.body?.error === a.error);
      if (ok && a.verified) ok = Object.values(actual.body?.verified ?? {}).length > 0 && Object.values(actual.body.verified).every((v) => v === true);
      if (ok && a.ownOnly) { const text = JSON.stringify(actual.body ?? ''); ok = !text.includes(other) && !text.includes(w.ownerOf('B').slice(0, 8)); }
    }
    // 거부된 응답에는 메모 내용이 없어야 함
    const denied = actual.status >= 400;
    const leak = denied && /가상 내용|가상 메모/u.test(JSON.stringify(actual.body ?? ''));
    if (leak) ok = false;
    const row = { ...c, expected, actual: `${actual.status}${actual.body?.error ? ` ${actual.body.error}` : ''} (${actual.layer})`, ok, leak };
    results.push(row); onCase?.(row);
  }
  return results;
}

export function summarizeMatrix(results) {
  const by = (key) => Object.fromEntries([...new Set(results.map((r) => r[key]))].map((v) => {
    const rs = results.filter((r) => r[key] === v); return [v, { total: rs.length, pass: rs.filter((r) => r.ok).length }];
  }));
  return { total: results.length, pass: results.filter((r) => r.ok).length, fail: results.filter((r) => !r.ok).length,
    allowed2xx: results.filter((r) => /^2/u.test(r.actual)).length, leaks: results.filter((r) => r.leak).length,
    byIdentity: by('identity'), byDevice: by('device'), bySig: by('sig'), byApi: by('api'), byMethod: by('method') };
}
