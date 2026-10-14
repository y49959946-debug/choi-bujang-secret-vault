// 10단계 제작 3 · 메모 한 건 복원 경로
//   POST /api/restore   본문: { "id": "<메모 UUID>" }
//
// 비공개 메모 사본(public.notes_backup)에서 요청자 본인의 메모 한 건만 되돌립니다.
//   - 사본은 메모가 처음 만들어질 때 DB 트리거가 한 번만 만들고(이후 수정은 사본에 반영되지 않음),
//     anon·authenticated 권한이 없어 서버 함수만 읽습니다. 이 함수는 사본을 읽기만 하고 고치지 않습니다.
//   - 신원은 로그인 검증(src/verify-login.mjs) 결과로만 정합니다. 본문의 owner_id·role 등은 받지 않고 거부합니다.
//   - 복원 전 대조: 사본이 요청자 소유인지(ID·소유자), 사본의 제목·내용 해시가 맞는지(사본 무결성),
//     지금 행이 있으면 그 주인도 요청자인지. 하나라도 어긋나면 아무것도 쓰지 않습니다.
//   - 복원: 삭제됐으면 그 한 건을 다시 넣고, 변조됐으면 ID·주인 조건을 함께 걸어 그 한 건만 고칩니다.
//     다른 메모는 건드리지 않습니다.
//   - 복원 후 대조: 다시 읽어 ID·소유자·내용 해시가 사본과 같은지 확인하고, 결과만(해시) 응답합니다.
//   - 감사 기록: public.restore_audit에 시작·결과를 덧붙이기만 합니다(DB 트리거로 수정·삭제 금지).
//     시작 기록을 쓸 수 없으면 복원하지 않습니다. 메모 본문·토큰은 기록하지 않습니다.
import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import config from '../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from '../src/verify-login.mjs';
import { ownerKeyOf } from '../src/owner-key.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const sha256 = (text) => createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex');
const BACKUP_COLUMNS = 'public_id, owner_id, title, content, title_sha256, content_sha256, created_at, captured_at';

let verifyLogin = null;
let db = null;

function fail(response, status, error) {
  return response.status(status).json({ ok: false, error });
}

function readBody(request) {
  const raw = request.body;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch { return null; }
  }
  return null;
}

async function audit(supabase, row) {
  const { error } = await supabase.from('restore_audit').insert(row);
  return !error;
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Vary', 'Authorization');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return fail(response, 405, 'METHOD_NOT_ALLOWED');
  }
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) return fail(response, 500, 'SERVER_NOT_CONFIGURED');

  let identity = null;
  try {
    verifyLogin ??= createLoginVerifier({ config, supabaseSecretKey: secretKey });
    identity = await verifyLogin(request.headers?.authorization);
  } catch { identity = null; }
  if (!identity?.userId) {
    response.setHeader('WWW-Authenticate', 'Bearer');
    return fail(response, 401, 'LOGIN_REQUIRED');
  }
  const ownerKey = ownerKeyOf(identity);

  // 쿼리로 대상·기능을 고르지 않습니다. 본문은 id 하나만 받습니다.
  if (request.query && Object.keys(request.query).length) return fail(response, 400, 'QUERY_NOT_ALLOWED');
  const body = readBody(request);
  if (!body || Object.keys(body).length !== 1 || typeof body.id !== 'string' || !UUID.test(body.id)) {
    return fail(response, 400, 'INVALID_RESTORE_REQUEST');
  }
  const id = body.id.toLowerCase();
  const runId = randomUUID();

  db ??= createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const supabase = db;
  const record = (result, reason, extra = {}) => audit(supabase, {
    run_id: runId, public_id: id, owner_id: ownerKey, result, reason_code: reason, ...extra,
  });

  try {
    // 1) 요청자 본인의 사본 찾기(ID와 소유자를 함께 조건으로)
    const { data: backup, error: backupError } = await supabase.from('notes_backup').select(BACKUP_COLUMNS)
      .eq('public_id', id).eq('owner_id', ownerKey).maybeSingle();
    if (backupError) return fail(response, 502, 'RESTORE_DB_FAILED');
    if (!backup) {
      await record('rejected', 'no_backup_for_owner');
      return fail(response, 404, 'BACKUP_NOT_FOUND');
    }
    // 2) 사본 무결성: 저장된 해시와 다시 계산한 해시가 같아야 합니다.
    if (backup.public_id !== id || backup.owner_id !== ownerKey
        || sha256(backup.content) !== backup.content_sha256 || sha256(backup.title) !== backup.title_sha256) {
      await record('rejected', 'backup_integrity_failed');
      return fail(response, 409, 'BACKUP_INTEGRITY_FAILED');
    }
    // 3) 지금 행의 주인 확인(다른 사람 행이면 덮어쓰지 않음)
    const { data: current, error: currentError } = await supabase.from('notes').select('public_id, owner_id, title, content')
      .eq('public_id', id).maybeSingle();
    if (currentError) return fail(response, 502, 'RESTORE_DB_FAILED');
    if (current && current.owner_id !== ownerKey) {
      await record('rejected', 'current_owner_mismatch');
      return fail(response, 409, 'OWNER_CONFLICT');
    }
    const before = current ? { state: 'modified', content_sha256: sha256(current.content) } : { state: 'deleted', content_sha256: null };
    if (current && sha256(current.content) === backup.content_sha256 && sha256(current.title) === backup.title_sha256) {
      await record('unchanged', 'already_matches_backup', { content_sha256: backup.content_sha256 });
      return response.status(200).json({ ok: true, restored: false, id, contentSha256: backup.content_sha256, verified: { id: true, owner: true, contentHash: true } });
    }

    // 4) 시작 기록(못 쓰면 복원하지 않음)
    if (!(await record('started', before.state, { before_content_sha256: before.content_sha256, content_sha256: backup.content_sha256 }))) {
      return fail(response, 503, 'AUDIT_UNAVAILABLE');
    }

    // 5) 한 건만 복원
    if (current) {
      const { error } = await supabase.from('notes')
        .update({ title: backup.title, content: backup.content, updated_at: new Date().toISOString() })
        .eq('public_id', id).eq('owner_id', ownerKey);
      if (error) { await record('failed', 'update_failed'); return fail(response, 502, 'RESTORE_DB_FAILED'); }
    } else {
      const row = { public_id: id, owner_id: ownerKey, title: backup.title, content: backup.content };
      if (backup.created_at) row.created_at = backup.created_at;
      const { error } = await supabase.from('notes').insert(row);
      if (error) { await record('failed', error.code === '23505' ? 'insert_conflict' : 'insert_failed'); return fail(response, 409, 'RESTORE_CONFLICT'); }
    }

    // 6) 복원 후 대조
    const { data: after } = await supabase.from('notes').select('public_id, owner_id, title, content').eq('public_id', id).maybeSingle();
    const verified = {
      id: after?.public_id === backup.public_id,
      owner: after?.owner_id === backup.owner_id,
      contentHash: sha256(after?.content) === backup.content_sha256 && sha256(after?.title) === backup.title_sha256,
    };
    const ok = verified.id && verified.owner && verified.contentHash;
    // 7) 결과 감사 기록. 메모는 이미 복원됐으므로 되돌리지 않고, 결과 기록이 빠졌다는 사실을 응답(auditRecorded)과 로그에 남깁니다.
    const auditRecorded = await record(ok ? 'restored' : 'verify_failed', ok ? 'matches_backup' : 'after_mismatch', { content_sha256: ok ? backup.content_sha256 : sha256(after?.content) });
    if (!auditRecorded) console.warn('[restore] result audit missing');
    if (!ok) return response.status(500).json({ ok: false, error: 'RESTORE_VERIFY_FAILED', id, verified, auditRecorded });
    return response.status(200).json({ ok: true, restored: true, id, contentSha256: backup.content_sha256, verified, auditRecorded });
  } catch {
    return fail(response, 500, 'RESTORE_SERVER_ERROR');
  }
}
