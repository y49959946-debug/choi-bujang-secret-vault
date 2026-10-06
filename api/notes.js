// 4단계: 로그인한 사람의 가상 메모 목록·추가·조회·수정·삭제 API. 모두 본인 메모로만 제한합니다.
//   GET    /api/notes      → 로그인 사용자의 메모 배열 [{id,title,body}]
//   POST   /api/notes      → {id?,title,body} 저장, owner_id는 서버가 확인한 사용자 ID → 201 {id}
//   GET    /api/notes/:id  → 본인 메모면 {id,title,body}, 아니면 404
//   PUT    /api/notes/:id  → {title,body}로 고침, 기존·새 행 소유자가 모두 본인일 때만 → 200 {id,title,body}, 아니면 404
//   DELETE /api/notes/:id  → 본인 메모만 → 204, 아니면 404
// (/api/notes/:id는 vercel.json rewrites가 이 함수로 보냅니다.)
//
// 신원은 시작 틀 src/verify-login.mjs(createLoginVerifier)의 토큰 검사 결과로만 정합니다.
// 브라우저가 보낸 userId·role·owner_id는 읽지도 믿지도 않습니다.
// SUPABASE_URL과 서버 전용 SUPABASE_SECRET_KEY는 Vercel 환경변수에서만 읽고,
// 키·토큰은 응답·로그·브라우저 파일에 넣지 않습니다.
//
// 소유자 검사: 모든 한 건 요청은 DB 조건에 owner_id = 서버가 확인한 사용자 ID를 함께 겁니다.
// 남의 메모는 존재 여부도 드러내지 않도록 없는 메모와 똑같이 404로 거부합니다(기본 거부).
// 본문에 다른 사람의 owner_id(또는 userId)를 넣어 소유자를 바꾸려 하면 403으로 거부합니다.
// URL의 쿼리 값(owner_id 등)은 읽지 않습니다. DB 권한(GRANT·RLS) 강화는 다음 제작에서 합니다.
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import config from '../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from '../src/verify-login.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const TITLE_MAX = 120;
const BODY_MAX = 2000;
const COLUMNS = 'public_id, title, content, owner_id';

let verifyLogin = null;
function loginVerifier() {
  verifyLogin ??= createLoginVerifier({ config, supabaseSecretKey: process.env.SUPABASE_SECRET_KEY });
  return verifyLogin;
}

let db = null;
function database(url, secretKey) {
  db ??= createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return db;
}

const toNote = (row) => ({ id: row.public_id, title: row.title, body: row.content });

function noteIdFrom(request) {
  const fromQuery = request.query?.id;
  if (typeof fromQuery === 'string') return fromQuery;
  const match = /^\/api\/notes\/([^/?#]+)/u.exec(request.url ?? '');
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
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

// title·body만 받습니다. owner_id는 아래 ownerChangeAttempt로 따로 검사하고, 저장에는 쓰지 않습니다.
function validFields(input) {
  if (!input || typeof input.title !== 'string' || typeof input.body !== 'string') return null;
  const title = input.title.trim();
  if (!title || title.length > TITLE_MAX || input.body.length > BODY_MAX) return null;
  return { title, content: input.body };
}

// 본문이 다른 사람을 소유자로 지정하면 true. 본인 ID와 같거나 없으면 false.
const OWNER_FIELDS = ['owner_id', 'ownerId', 'userId', 'user_id'];
function ownerChangeAttempt(input, userId) {
  if (!input) return false;
  return OWNER_FIELDS.some((key) => Object.hasOwn(input, key)
    && String(input[key]).toLowerCase() !== userId);
}

function fail(response, status, error) {
  return response.status(status).json({ error });
}

function dbError(response, error, action) {
  console.error(`notes: ${action} 실패`, error?.code ?? 'unknown');
  return fail(response, 502, 'NOTES_DB_FAILED');
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Vary', 'Authorization');

  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    console.error('notes: SUPABASE_URL 또는 SUPABASE_SECRET_KEY 환경변수가 없습니다.');
    return fail(response, 500, 'SERVER_NOT_CONFIGURED');
  }

  let verify;
  try {
    verify = loginVerifier();
  } catch (error) {
    console.error('notes: 로그인 검사기 설정 오류', error?.message ?? 'unknown');
    return fail(response, 500, 'LOGIN_VERIFIER_NOT_CONFIGURED');
  }

  let identity = null;
  try {
    identity = await verify(request.headers?.authorization);
  } catch {
    identity = null;
  }
  if (!identity?.userId) {
    response.setHeader('WWW-Authenticate', 'Bearer');
    return fail(response, 401, 'LOGIN_REQUIRED');
  }
  // 서버가 확인한 사용자 ID. DB(uuid)는 소문자로 돌려주므로 비교를 위해 소문자로 맞춥니다.
  const userId = String(identity.userId).toLowerCase();

  const method = request.method ?? 'GET';
  const noteId = noteIdFrom(request);
  const supabase = database(url, secretKey);

  try {
    // ----- /api/notes -----
    if (noteId === null) {
      if (method === 'GET') {
        const { data, error } = await supabase.from('notes').select(COLUMNS)
          .eq('owner_id', userId)
          .order('created_at', { ascending: true }).order('id', { ascending: true });
        if (error) return dbError(response, error, '목록 조회');
        return response.status(200).json((data ?? []).map(toNote));
      }
      if (method === 'POST') {
        const input = readBody(request);
        if (ownerChangeAttempt(input, userId)) return fail(response, 403, 'OWNER_MISMATCH');
        const fields = validFields(input);
        if (!fields) return fail(response, 400, 'INVALID_NOTE');
        let id = input.id;
        if (id === undefined || id === null || id === '') id = randomUUID();
        if (typeof id !== 'string' || !UUID.test(id)) return fail(response, 400, 'INVALID_ID');
        id = id.toLowerCase();
        const { error } = await supabase.from('notes')
          .insert({ public_id: id, owner_id: userId, ...fields });
        if (error?.code === '23505') return fail(response, 409, 'ID_CONFLICT');
        if (error) return dbError(response, error, '추가');
        return response.status(201).json({ id });
      }
      response.setHeader('Allow', 'GET, POST');
      return fail(response, 405, 'METHOD_NOT_ALLOWED');
    }

    // ----- /api/notes/:id -----
    if (!['GET', 'PUT', 'DELETE'].includes(method)) {
      response.setHeader('Allow', 'GET, PUT, DELETE');
      return fail(response, 405, 'METHOD_NOT_ALLOWED');
    }
    if (!UUID.test(noteId)) return fail(response, 404, 'NOT_FOUND');
    const id = noteId.toLowerCase();

    if (method === 'GET') {
      const { data, error } = await supabase.from('notes').select(COLUMNS)
        .eq('public_id', id).eq('owner_id', userId).maybeSingle();
      if (error) return dbError(response, error, '한 건 조회');
      if (!data || data.owner_id !== userId) return fail(response, 404, 'NOT_FOUND');
      return response.status(200).json(toNote(data));
    }

    if (method === 'PUT') {
      const input = readBody(request);
      // 새 행의 소유자: 본문이 다른 사람을 소유자로 지정하면 거부합니다.
      if (ownerChangeAttempt(input, userId)) return fail(response, 403, 'OWNER_MISMATCH');
      const fields = validFields(input);
      if (!fields) return fail(response, 400, 'INVALID_NOTE');
      // 기존 행의 소유자: owner_id = 본인 조건이 맞는 행만 고칩니다. 새 행의 owner_id도 본인으로 고정합니다.
      const { data, error } = await supabase.from('notes')
        .update({ ...fields, owner_id: userId, updated_at: new Date().toISOString() })
        .eq('public_id', id).eq('owner_id', userId).select(COLUMNS).maybeSingle();
      if (error) return dbError(response, error, '수정');
      if (!data) return fail(response, 404, 'NOT_FOUND');
      if (data.owner_id !== userId) {
        console.error('notes: 수정 후 소유자 불일치');
        return fail(response, 500, 'NOTES_SERVER_ERROR');
      }
      return response.status(200).json(toNote(data));
    }

    // DELETE
    const { data, error } = await supabase.from('notes')
      .delete().eq('public_id', id).eq('owner_id', userId).select('public_id');
    if (error) return dbError(response, error, '삭제');
    if (!data?.length) return fail(response, 404, 'NOT_FOUND');
    return response.status(204).end();
  } catch {
    console.error('notes: 서버 오류');
    return fail(response, 500, 'NOTES_SERVER_ERROR');
  }
}
