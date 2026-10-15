// 11단계 · 보호 요청 앞단 검사(라우팅 미들웨어가 /api/notes·/api/restore 앞에서 부릅니다)
//
// 로그인 토큰이 있는 요청은 승인된 기기의 서명이 있어야 함수까지 갑니다.
//   1) 서명 머리글 4개가 없으면 403 DEVICE_PROOF_REQUIRED, 모양이 틀리면 403 DEVICE_PROOF_INVALID
//   2) 시각이 서버와 2분 넘게 다르면 403 DEVICE_PROOF_EXPIRED
//   3) 기기 세션이 없거나·만료·다른 사람 것·기기가 승인 상태가 아니면 403 DEVICE_NOT_APPROVED
//   4) 메서드·경로·쿼리·본문 해시·시각·번호·세션에 대한 서명이 맞지 않으면 403 DEVICE_SIGNATURE_INVALID
//   5) 같은 일회용 번호를 다시 쓰면 403 DEVICE_PROOF_REPLAYED
// 로그인 토큰이 없는 요청은 그대로 함수로 보내, 함수가 전처럼 401로 거부합니다(기존 결과 유지).
// 토큰 머리글이 있는데 검증되지 않으면 여기서 401 LOGIN_REQUIRED(확인 중 오류면 403 DEVICE_CHECK_FAILED)로 닫습니다(12단계 마무리).
// 이 검사는 api/notes.js·api/restore.js(9단계 안전 정책 사본 대상)를 고치지 않고 그 앞에 붙습니다.
import { createClient } from '@supabase/supabase-js';
import config from '../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from './verify-login.mjs';
import { ownerKeyOf } from './owner-key.mjs';
import { MAX_SKEW_MS, canonicalRequest, readProofHeaders, sha256Hex, verifyProofSignature, normalizeTarget } from './device-proof.mjs';

const MAX_BODY = 64 * 1024;
const shapeOf = (pathname) => pathname.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu, ':id');

export function createDeviceGate({ env = process.env, verifyLogin = null, db = null, now = () => Date.now(), log = console.warn } = {}) {
  let verify = verifyLogin;
  let client = db;
  const deny = (code, request, url) => {
    log(`device: 거부 403 ${code} method=${request.method} path=${shapeOf(url.pathname)}`);
    return Response.json({ error: code }, { status: 403, headers: { 'cache-control': 'no-store' } });
  };

  return async function deviceGate(request) {
    const url = new URL(request.url);
    const authorization = request.headers.get('authorization');
    if (!authorization) return null; // 토큰 없는 요청: 함수가 401
    verify ??= createLoginVerifier({ config, supabaseSecretKey: env.SUPABASE_SECRET_KEY });
    // 12단계 마무리: 토큰 머리글이 있는데 여기서 확인하지 못한 요청은 함수로 넘기지 않고 여기서 닫습니다.
    // 전에는 함수로 넘겨 401을 받게 했는데, 앞단의 확인만 실패하고 함수의 확인은 성공하면
    // (공개키 목록 조회 일시 실패, 같은 머리글이 두 줄로 와서 앞단·함수가 다르게 읽는 경우 등)
    // 기기 서명 없이 자료가 열렸습니다. 로컬 재현: test/monsters.test.mjs H16·H17.
    let identity = null;
    try { identity = await verify(authorization); } catch {
      return deny('DEVICE_CHECK_FAILED', request, url); // 확인 중 오류: 닫힘
    }
    if (!identity?.userId) {
      log(`device: 거부 401 LOGIN_REQUIRED method=${request.method} path=${shapeOf(url.pathname)}`);
      return Response.json({ error: 'LOGIN_REQUIRED' }, { status: 401, headers: { 'cache-control': 'no-store', 'www-authenticate': 'Bearer' } });
    }
    const ownerKey = ownerKeyOf(identity);

    const proof = readProofHeaders((name) => request.headers.get(name));
    if (proof.error) return deny(proof.error, request, url);
    if (Math.abs(now() - proof.timestamp) > MAX_SKEW_MS) return deny('DEVICE_PROOF_EXPIRED', request, url);

    let bodyText = '';
    if (!['GET', 'HEAD'].includes(request.method)) {
      bodyText = await request.clone().text();
      if (bodyText.length > MAX_BODY) return deny('DEVICE_PROOF_INVALID', request, url);
    }

    client ??= createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const { data: session, error: sessionError } = await client.from('device_sessions')
      .select('id, owner_id, credential_row, public_jwk, expires_at').eq('id', proof.sessionId).maybeSingle();
    if (sessionError) return deny('DEVICE_CHECK_FAILED', request, url);
    if (!session || String(session.owner_id).toLowerCase() !== ownerKey || Date.parse(session.expires_at) <= now()) {
      return deny('DEVICE_NOT_APPROVED', request, url);
    }
    // 세션을 받은 뒤 회수됐을 수도 있으니 요청마다 기기 상태를 다시 봅니다.
    const { data: device } = await client.from('device_credentials').select('id, owner_id, status')
      .eq('id', session.credential_row).maybeSingle();
    if (!device || device.status !== 'approved' || String(device.owner_id).toLowerCase() !== ownerKey) {
      return deny('DEVICE_NOT_APPROVED', request, url);
    }

    const canonical = canonicalRequest({ method: request.method, pathname: url.pathname, search: url.search,
      bodySha256: sha256Hex(bodyText), timestamp: proof.timestamp, nonce: proof.nonce, sessionId: proof.sessionId });
    if (!(await verifyProofSignature(session.public_jwk, canonical, proof.signature))) return deny('DEVICE_SIGNATURE_INVALID', request, url);

    const { error: nonceError } = await client.from('device_request_nonces').insert({ session_id: session.id, nonce: proof.nonce });
    if (nonceError) return deny(nonceError.code === '23505' ? 'DEVICE_PROOF_REPLAYED' : 'DEVICE_CHECK_FAILED', request, url);
    return null; // 통과: 원래 함수로
  };
}

export { normalizeTarget };
