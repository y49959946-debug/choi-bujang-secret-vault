// 11단계 · 기기 승인 API (로그인 토큰 필요, 기기 서명은 필요 없음: 기기를 처음 붙이는 단계라서)
//   POST /api/device/register-options  패스키 등록 문제 받기
//   POST /api/device/register          패스키 등록 → 항상 'pending'(승인 대기). 이 API에는 승인으로 바꾸는 코드가 없습니다.
//   POST /api/device/session-options   본문 { sessionKey: 임시 서명 공개키 } → 패스키 확인 문제(그 공개키 지문이 들어감)
//   POST /api/device/session           패스키 확인 → 서버 DB에서 그 기기가 'approved'일 때만 임시 서명 키를 기기 세션으로 등록
//
// 패스키(Windows Hello 등)가 없는 기기용 "메모리 전용 기기 키" 흐름:
//   POST /api/device/key-challenge     본문 { deviceKey: 공개키, purpose: 'register'|'session' } → 일회용 문제
//   POST /api/device/key-register      그 문제에 기기 키로 서명해 키를 가졌음을 증명 → 항상 'pending'(승인 대기)
//   POST /api/device/key-session       같은 증명 → 서버 DB에서 그 기기 키가 'approved'일 때만 기기 세션 등록
//   - 기기 키의 비밀키는 화면 메모리에만 있고 내보낼 수 없습니다(새로고침하면 사라져 다시 승인받아야 함).
//   - 서버는 공개키만 저장합니다(자격 ID 'mem:<지문>'). 승인은 패스키와 똑같이 주인이 SQL Editor에서만 합니다.
//
// - 기기 키(패스키 비밀키)는 운영체제 인증 장치에 있고 브라우저 저장소에 없습니다. 서버는 공개키만 저장합니다.
// - 임시 서명 키의 비밀키는 화면 메모리에만 있고, 서버는 그 공개키만 받습니다(비밀값 d가 있으면 거부).
// - 승인은 주인이 Supabase SQL Editor에서 합니다(supabase/notes-step11-devices.sql ④). 화면 버튼은 승인 "요청"만 남깁니다.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import * as simple from '@simplewebauthn/server';
import config from '../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from '../src/verify-login.mjs';
import { ownerKeyOf } from '../src/owner-key.mjs';
import { PROOF_VERSION, jwkThumbprint, publicJwk, sessionChallengeBytes, verifyProofSignature } from '../src/device-proof.mjs';

const CHALLENGE_MS = 5 * 60 * 1000;
const SESSION_MS = 8 * 60 * 60 * 1000;
const ACTIONS = new Set(['register-options', 'register', 'session-options', 'session', 'key-challenge', 'key-register', 'key-session']);
const MEM = 'mem:';
// 메모리 기기 키가 서명하는 문자열(목적·문제·키 지문을 묶어 다른 용도로 재사용 불가)
export const keyProofMessage = (purpose, challenge, thumbprint) => `${PROOF_VERSION}|device-key|${purpose}|${challenge}|${thumbprint}`;
const HOST = /^[a-z0-9.-]{1,253}(:\d{1,5})?$/iu;

function readBody(request) {
  const raw = request.body;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) { try { const v = JSON.parse(raw); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; } }
  return {};
}
// 패스키는 이 사이트 주소(rpID)에 묶입니다. 요청이 들어온 실제 주소로 정합니다.
function siteOf(request) {
  const host = String(request.headers?.['x-forwarded-host'] ?? request.headers?.host ?? '').split(',')[0].trim().toLowerCase();
  if (!HOST.test(host)) return null;
  const rpID = host.replace(/:\d+$/u, '');
  const local = rpID === 'localhost';
  return { rpID, origin: `${local ? 'http' : 'https'}://${host}` };
}
const userHandle = (ownerKey) => createHash('sha256').update(`byteback-device-user|${ownerKey}`).digest().subarray(0, 16);
const cleanLabel = (v) => String(v ?? '').replace(/[^\p{L}\p{N} ._()-]/gu, '').slice(0, 40);

export function createDeviceHandler({ env = process.env, verifyLogin = null, db = null, webauthn = simple, now = () => Date.now(), log = console.warn } = {}) {
  let verify = verifyLogin;
  let client = db;
  const fail = (response, status, error, action) => {
    log(`device: 거부 ${status} ${error} action=${action ?? '-'}`);
    return response.status(status).json({ ok: false, error });
  };

  // 일회용 문제를 꺼내며 바로 "사용함"으로 표시(같은 문제를 두 번 못 씀)
  async function takeChallenge(id, ownerKey, purpose, rpID) {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/iu.test(id)) return null;
    const { data } = await client.from('device_challenges').update({ used_at: new Date(now()).toISOString() })
      .eq('id', id).eq('owner_id', ownerKey).eq('purpose', purpose).eq('rp_id', rpID).is('used_at', null)
      .select('id, challenge, nonce, key_thumbprint, expires_at').maybeSingle();
    if (!data || Date.parse(data.expires_at) <= now()) return null;
    return data;
  }

  return async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    const action = String(request.query?.action ?? '');
    if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); return fail(response, 405, 'METHOD_NOT_ALLOWED', action); }
    if (!ACTIONS.has(action)) return fail(response, 404, 'UNKNOWN_ACTION', action);
    if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return fail(response, 503, 'SERVER_NOT_CONFIGURED', action);
    verify ??= createLoginVerifier({ config, supabaseSecretKey: env.SUPABASE_SECRET_KEY });
    let identity = null;
    try { identity = await verify(request.headers?.authorization); } catch { identity = null; }
    if (!identity?.userId) { response.setHeader('WWW-Authenticate', 'Bearer'); return fail(response, 401, 'LOGIN_REQUIRED', action); }
    const ownerKey = ownerKeyOf(identity);
    const site = siteOf(request);
    if (!site) return fail(response, 400, 'BAD_HOST', action);
    const body = readBody(request);
    if (!body) return fail(response, 400, 'INVALID_BODY', action);
    client ??= createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

    try {
      const { data: mine, error: mineError } = await client.from('device_credentials')
        .select('id, credential_id, public_key, counter, transports, rp_id, status').eq('owner_id', ownerKey);
      if (mineError) return fail(response, 502, 'DEVICE_DB_FAILED', action);
      const hereAll = (mine ?? []).filter((d) => d.rp_id === site.rpID);
      const here = hereAll.filter((d) => !String(d.credential_id).startsWith(MEM)); // 패스키 기기
      const memDevices = hereAll.filter((d) => String(d.credential_id).startsWith(MEM)); // 메모리 키 기기

      if (action === 'key-challenge') {
        const thumb = jwkThumbprint(body.deviceKey);
        if (!thumb || !['register', 'session'].includes(body.purpose)) return fail(response, 400, 'DEVICE_KEY_INVALID', action);
        const challenge = randomBytes(32).toString('base64url');
        const { data: row, error } = await client.from('device_challenges').insert({
          owner_id: ownerKey, purpose: body.purpose, challenge, key_thumbprint: thumb, rp_id: site.rpID,
          expires_at: new Date(now() + CHALLENGE_MS).toISOString(),
        }).select('id').single();
        if (error || !row) return fail(response, 502, 'DEVICE_DB_FAILED', action);
        return response.status(200).json({ ok: true, challengeId: row.id, challenge, message: keyProofMessage(body.purpose, challenge, thumb) });
      }

      if (action === 'key-register' || action === 'key-session') {
        const purpose = action === 'key-register' ? 'register' : 'session';
        const key = publicJwk(body.deviceKey);
        const thumb = jwkThumbprint(body.deviceKey);
        if (!key || !thumb) return fail(response, 400, 'DEVICE_KEY_INVALID', action);
        const challenge = await takeChallenge(body.challengeId, ownerKey, purpose, site.rpID);
        if (!challenge || challenge.key_thumbprint !== thumb) return fail(response, 400, 'CHALLENGE_INVALID', action);
        // 기기 키를 가졌다는 증명: 서버가 낸 문제에 그 키로 서명
        if (!(await verifyProofSignature(key, keyProofMessage(purpose, challenge.challenge, thumb), body.signature))) {
          return fail(response, 401, 'DEVICE_KEY_NOT_VERIFIED', action);
        }
        const credentialId = `${MEM}${thumb}`;
        if (purpose === 'register') {
          const { data: row, error } = await client.from('device_credentials').insert({
            owner_id: ownerKey, credential_id: credentialId, public_key: JSON.stringify(key), counter: 0, transports: [],
            rp_id: site.rpID, label: cleanLabel(body.label || '메모리 키 기기'),
            // status는 넣지 않습니다 → DB 기본값 'pending'(승인 대기)
          }).select('id, status, created_at').single();
          if (error || !row) return fail(response, error?.code === '23505' ? 409 : 502, error?.code === '23505' ? 'DEVICE_EXISTS' : 'DEVICE_DB_FAILED', action);
          log(`device: 등록 pending(메모리 키) id=${String(row.id).slice(0, 8)}`);
          return response.status(201).json({ ok: true, approved: false, status: row.status, deviceId: row.id, createdAt: row.created_at });
        }
        const device = memDevices.find((d) => d.credential_id === credentialId);
        if (!device) return fail(response, 404, 'NO_DEVICE', action);
        await client.from('device_credentials').update({ last_used_at: new Date(now()).toISOString() }).eq('id', device.id);
        if (device.status !== 'approved') return response.status(200).json({ ok: true, approved: false, status: device.status, deviceId: device.id });
        const sessionId = randomUUID();
        const expiresAt = new Date(now() + SESSION_MS).toISOString();
        const { error } = await client.from('device_sessions').insert({ id: sessionId, owner_id: ownerKey, credential_row: device.id, public_jwk: key, expires_at: expiresAt });
        if (error) return fail(response, 502, 'DEVICE_DB_FAILED', action);
        return response.status(200).json({ ok: true, approved: true, status: 'approved', deviceId: device.id, sessionId, expiresAt });
      }

      if (action === 'register-options') {
        const options = await webauthn.generateRegistrationOptions({
          rpName: 'BYTE BACK 내 자료실', rpID: site.rpID, userID: userHandle(ownerKey),
          userName: `byteback-${ownerKey.slice(0, 8)}`, userDisplayName: '내 자료실 사용자',
          attestationType: 'none', preferredAuthenticatorType: 'localDevice',
          authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'discouraged', userVerification: 'required' },
          excludeCredentials: here.map((d) => ({ id: d.credential_id, transports: d.transports ?? [] })),
        });
        const { data: row, error } = await client.from('device_challenges').insert({
          owner_id: ownerKey, purpose: 'register', challenge: options.challenge, rp_id: site.rpID,
          expires_at: new Date(now() + CHALLENGE_MS).toISOString(),
        }).select('id').single();
        if (error || !row) return fail(response, 502, 'DEVICE_DB_FAILED', action);
        return response.status(200).json({ ok: true, challengeId: row.id, options });
      }

      if (action === 'register') {
        const challenge = await takeChallenge(body.challengeId, ownerKey, 'register', site.rpID);
        if (!challenge) return fail(response, 400, 'CHALLENGE_INVALID', action);
        let result;
        try {
          result = await webauthn.verifyRegistrationResponse({ response: body.response, expectedChallenge: challenge.challenge,
            expectedOrigin: site.origin, expectedRPID: site.rpID, requireUserVerification: true });
        } catch { result = { verified: false }; }
        if (!result?.verified || !result.registrationInfo?.credential) return fail(response, 400, 'PASSKEY_NOT_VERIFIED', action);
        const cred = result.registrationInfo.credential;
        const { data: row, error } = await client.from('device_credentials').insert({
          owner_id: ownerKey, credential_id: cred.id, public_key: Buffer.from(cred.publicKey).toString('base64url'),
          counter: cred.counter ?? 0, transports: cred.transports ?? [], rp_id: site.rpID, label: cleanLabel(body.label),
          // status는 넣지 않습니다 → DB 기본값 'pending'(승인 대기)
        }).select('id, status, created_at').single();
        if (error || !row) return fail(response, error?.code === '23505' ? 409 : 502, error?.code === '23505' ? 'DEVICE_EXISTS' : 'DEVICE_DB_FAILED', action);
        log(`device: 등록 pending id=${String(row.id).slice(0, 8)}`);
        return response.status(201).json({ ok: true, approved: false, status: row.status, deviceId: row.id, createdAt: row.created_at });
      }

      if (action === 'session-options') {
        const thumb = jwkThumbprint(body.sessionKey);
        if (!thumb) return fail(response, 400, 'SESSION_KEY_INVALID', action);
        const usable = here.filter((d) => d.status !== 'revoked');
        if (!usable.length) return fail(response, 404, 'NO_DEVICE', action);
        const nonce = randomBytes(24).toString('base64url');
        const options = await webauthn.generateAuthenticationOptions({ rpID: site.rpID, userVerification: 'required',
          challenge: sessionChallengeBytes(nonce, thumb),
          allowCredentials: usable.map((d) => ({ id: d.credential_id, transports: d.transports ?? [] })) });
        const { data: row, error } = await client.from('device_challenges').insert({
          owner_id: ownerKey, purpose: 'session', challenge: options.challenge, nonce, key_thumbprint: thumb, rp_id: site.rpID,
          expires_at: new Date(now() + CHALLENGE_MS).toISOString(),
        }).select('id').single();
        if (error || !row) return fail(response, 502, 'DEVICE_DB_FAILED', action);
        return response.status(200).json({ ok: true, challengeId: row.id, options });
      }

      // action === 'session'
      const key = publicJwk(body.sessionKey);
      const thumb = jwkThumbprint(body.sessionKey);
      if (!key || !thumb) return fail(response, 400, 'SESSION_KEY_INVALID', action);
      const challenge = await takeChallenge(body.challengeId, ownerKey, 'session', site.rpID);
      if (!challenge) return fail(response, 400, 'CHALLENGE_INVALID', action);
      // 패스키가 서명한 문제 안에 이 임시 키의 지문이 들어 있어야 합니다.
      const expected = Buffer.from(sessionChallengeBytes(challenge.nonce, thumb)).toString('base64url');
      if (challenge.key_thumbprint !== thumb || challenge.challenge !== expected) return fail(response, 400, 'SESSION_KEY_MISMATCH', action);
      const device = here.find((d) => d.credential_id === body.response?.id);
      if (!device) return fail(response, 404, 'NO_DEVICE', action);
      let result;
      try {
        result = await webauthn.verifyAuthenticationResponse({ response: body.response, expectedChallenge: challenge.challenge,
          expectedOrigin: site.origin, expectedRPID: site.rpID, requireUserVerification: true,
          credential: { id: device.credential_id, publicKey: new Uint8Array(Buffer.from(device.public_key, 'base64url')),
            counter: Number(device.counter ?? 0), transports: device.transports ?? [] } });
      } catch { result = { verified: false }; }
      if (!result?.verified) return fail(response, 401, 'PASSKEY_NOT_VERIFIED', action);
      await client.from('device_credentials').update({ counter: result.authenticationInfo?.newCounter ?? device.counter,
        last_used_at: new Date(now()).toISOString() }).eq('id', device.id);

      // 승인 여부는 서버 DB의 상태로만 정합니다.
      if (device.status !== 'approved') {
        return response.status(200).json({ ok: true, approved: false, status: device.status, deviceId: device.id });
      }
      const sessionId = randomUUID();
      const expiresAt = new Date(now() + SESSION_MS).toISOString();
      const { error } = await client.from('device_sessions').insert({ id: sessionId, owner_id: ownerKey, credential_row: device.id,
        public_jwk: key, expires_at: expiresAt });
      if (error) return fail(response, 502, 'DEVICE_DB_FAILED', action);
      return response.status(200).json({ ok: true, approved: true, status: 'approved', deviceId: device.id, sessionId, expiresAt });
    } catch {
      return fail(response, 500, 'DEVICE_SERVER_ERROR', action);
    }
  };
}

export default createDeviceHandler();
