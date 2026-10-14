// 11단계 · 기기 요청 서명 규칙(서버·화면·시험이 같은 규칙을 씁니다)
//
// 보호 요청(메모·복구 API)마다 브라우저 메모리에만 있는 임시 서명 키(ECDSA P-256)로 아래 문자열에 서명합니다.
//   aleph-device-v1 \n 메서드 \n 경로 \n 쿼리 \n 본문 SHA-256 \n 시각(ms) \n 일회용 번호 \n 기기 세션 ID
// - 경로·쿼리·본문이 하나라도 바뀌면 서명이 맞지 않습니다(서명 뒤 경로 변경·본문 변경 거부).
// - 시각은 서버 시각과 2분 안이어야 하고, 일회용 번호는 다시 쓸 수 없습니다(재전송 거부).
// - 임시 서명 키의 공개키는 패스키로 확인한 승인 기기에만 묶입니다(api/device.js의 기기 세션).
import { createHash, webcrypto } from 'node:crypto';

export const PROOF_VERSION = 'aleph-device-v1';
export const MAX_SKEW_MS = 2 * 60 * 1000;
export const PROOF_HEADERS = Object.freeze({
  session: 'x-device-session', timestamp: 'x-device-timestamp', nonce: 'x-device-nonce', signature: 'x-device-signature',
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const NONCE = /^[A-Za-z0-9_-]{16,64}$/u;
const SIG = /^[A-Za-z0-9_-]{86}$/u; // ECDSA P-256 서명 64바이트(r||s)의 base64url
const B64URL_32 = /^[A-Za-z0-9_-]{43}$/u; // P-256 좌표 32바이트

export const sha256Hex = (text) => createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex');

// /api/notes?id=<id> 와 /api/notes/<id> 는 같은 대상으로 봅니다(Vercel 다시 쓰기 전후 모양이 달라도 같은 서명 문자열).
// 끝의 / 는 뺍니다. 그 밖의 쿼리는 그대로 서명에 들어갑니다.
export function normalizeTarget(pathname, search = '') {
  let path = String(pathname || '/');
  if (path.length > 1) path = path.replace(/\/+$/u, '');
  const params = new URLSearchParams(search);
  const keys = [...params.keys()];
  if (path === '/api/notes' && keys.length === 1 && keys[0] === 'id') return { path: `/api/notes/${params.get('id')}`, search: '' };
  return { path, search: search && search !== '?' ? (search.startsWith('?') ? search : `?${search}`) : '' };
}

export function canonicalRequest({ method, pathname, search, bodySha256, timestamp, nonce, sessionId }) {
  const target = normalizeTarget(pathname, search);
  return [PROOF_VERSION, String(method).toUpperCase(), target.path, target.search, bodySha256, String(timestamp), nonce, sessionId].join('\n');
}

// 임시 서명 키의 공개키만 받습니다(비밀값 d가 있으면 거부).
export function publicJwk(jwk) {
  if (!jwk || typeof jwk !== 'object' || Array.isArray(jwk) || 'd' in jwk) return null;
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !B64URL_32.test(jwk.x ?? '') || !B64URL_32.test(jwk.y ?? '')) return null;
  return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
}

// RFC 7638 JWK 지문
export function jwkThumbprint(jwk) {
  const pub = publicJwk(jwk);
  if (!pub) return null;
  return createHash('sha256').update(JSON.stringify({ crv: pub.crv, kty: pub.kty, x: pub.x, y: pub.y }), 'utf8').digest('base64url');
}

// 패스키 확인 문제(challenge)에 임시 서명 키 지문을 넣습니다. 패스키 서명이 곧 "이 임시 키를 이 기기가 보증함"이 됩니다.
export function sessionChallengeBytes(nonce, thumbprint) {
  return createHash('sha256').update(`${PROOF_VERSION}|session|${nonce}|${thumbprint}`, 'utf8').digest();
}

// 요청 서명 머리글 모양 검사(값은 로그에 남기지 않습니다)
export function readProofHeaders(get) {
  const sessionId = get(PROOF_HEADERS.session); const timestamp = get(PROOF_HEADERS.timestamp);
  const nonce = get(PROOF_HEADERS.nonce); const signature = get(PROOF_HEADERS.signature);
  if (!sessionId && !timestamp && !nonce && !signature) return { error: 'DEVICE_PROOF_REQUIRED' };
  if (!UUID.test(sessionId ?? '') || !/^\d{13}$/u.test(timestamp ?? '') || !NONCE.test(nonce ?? '') || !SIG.test(signature ?? '')) {
    return { error: 'DEVICE_PROOF_INVALID' };
  }
  return { sessionId: sessionId.toLowerCase(), timestamp: Number(timestamp), nonce, signature };
}

export async function verifyProofSignature(jwk, canonical, signatureB64url) {
  const pub = publicJwk(jwk);
  if (!pub || !SIG.test(signatureB64url ?? '')) return false;
  try {
    const key = await webcrypto.subtle.importKey('jwk', { ...pub, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key,
      Buffer.from(signatureB64url, 'base64url'), new TextEncoder().encode(canonical));
  } catch { return false; }
}
