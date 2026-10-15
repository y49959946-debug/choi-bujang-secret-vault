// 12단계 제작 1 · 탈환 작전실 요약 API
//   GET /api/ops   (로그인 + 승인 기기 서명 필요: middleware.js가 앞에서 검사)
//
// 판정기 규칙·탐지 사건·회수 상태·복구 버전을 "어디서 확인한 값인지"와 함께 돌려줍니다.
//   source: 'db'         → 이 요청에서 Supabase 기록을 읽어 센 값(요청자 본인 기록만)
//           'server_run' → 이 요청에서 서버가 판정기·탐지기 코드를 가상 입력으로 실행한 결과
//           'build'      → 배포에 들어 있는 고정 값(정책 사본 기준 커밋·지문)
//           'not_run'    → 이 서버에서 실행하지 않았거나 연결되지 않아 결과가 없음(짐작으로 채우지 않음)
// - 메모 본문·제목·토큰·키·전체 ID는 돌려주지 않습니다. ID는 앞 8자리만, 내용은 해시 일치 여부만 셉니다.
// - 수치는 같은 응답의 가린 기록(records)에서 다시 셀 수 있게 만들고, 서버가 직접 대조한 결과(consistency)도 넣습니다.
// - 화면의 성공 문구가 아니라 이 응답 값이 근거입니다.
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import config from '../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from '../src/verify-login.mjs';
import { ownerKeyOf } from '../src/owner-key.mjs';
import { decide, RULE_IDS } from '../src/decider.mjs';
import { detect } from '../src/detect.mjs';
import { TRUSTED_BASELINE } from '../src/policy-diff.mjs';
import { fixtureRequests } from '../scripts/fixture-7.mjs';
import { checkDetection } from '../scripts/detect-test.mjs';

const sha256 = (t) => createHash('sha256').update(String(t ?? ''), 'utf8').digest('hex');
const mask = (v) => (v == null ? null : String(v).slice(0, 8));
const countBy = (rows, key, keys) => Object.fromEntries(keys.map((k) => [k, rows.filter((r) => r[key] === k).length]));

// 판정기 가상 요청(계약 모양). 기대값은 6~8단계 규칙.
function deciderProbes() {
  const { normal, suspicious } = fixtureRequests();
  const req = (over) => ({ ...normal, requestId: crypto.randomUUID(), ...over });
  return [
    ['6단계 등록 기기의 메모 한 건 읽기', req({}), 'allow', 'approved'],
    ['6단계 미등록 기기', req({ deviceRegistered: false }), 'deny', 'device_not_registered'],
    ['7단계 복합 이상 접속', { ...suspicious, requestId: crypto.randomUUID() }, 'step_up', 'step_up_required'],
    ['7단계 다시 확인한 복합 이상 접속', { ...suspicious, requestId: crypto.randomUUID(), stepUp: { verified: true, authAgeSeconds: 60 } }, 'allow', 'approved'],
    ['8단계 메모 전체 목록', req({ path: '/notes', route: 'GET /notes' }), 'deny', 'route_not_allowed'],
    ['8단계 반 공지 읽기', req({ path: '/notices', route: 'GET /notices' }), 'allow', 'approved'],
    ['8단계 반 공지 수정', req({ method: 'PUT', path: '/notices/n1', route: 'PUT /notices/:id' }), 'deny', 'notice_write_denied'],
    ['8단계 강사 자료 삭제', req({ method: 'DELETE', path: '/materials/m1', route: 'DELETE /materials/:id' }), 'deny', 'material_write_denied'],
    ['8단계 구역 밖 경로', req({ path: '/admin', route: 'GET /admin' }), 'deny', 'route_not_allowed'],
  ];
}

export function createOpsHandler({ env = process.env, verifyLogin = null, db = null, now = () => Date.now(), log = console.warn } = {}) {
  let verify = verifyLogin;
  let client = db;
  const fail = (response, status, error) => { log(`ops: 거부 ${status} ${error}`); return response.status(status).json({ ok: false, error }); };

  return async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); return fail(response, 405, 'METHOD_NOT_ALLOWED'); }
    if (request.query && Object.keys(request.query).length) return fail(response, 400, 'QUERY_NOT_ALLOWED');
    if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return fail(response, 503, 'SERVER_NOT_CONFIGURED');
    verify ??= createLoginVerifier({ config, supabaseSecretKey: env.SUPABASE_SECRET_KEY });
    let identity = null;
    try { identity = await verify(request.headers?.authorization); } catch { identity = null; }
    if (!identity?.userId) { response.setHeader('WWW-Authenticate', 'Bearer'); return fail(response, 401, 'LOGIN_REQUIRED'); }
    const ownerKey = ownerKeyOf(identity);
    client ??= createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

    try {
      // ---- 판정기 규칙: 서버에서 가상 요청을 실제로 실행 ----
      const probes = [];
      for (const [name, input, decision, reasonCode] of deciderProbes()) {
        const out = await decide(input);
        const shapeOk = out && Object.keys(out).sort().join(',') === 'decision,reasonCode,requestId,ruleIds,schema'
          && out.schema === 'aleph.decision.v1' && out.requestId === input.requestId
          && Array.isArray(out.ruleIds) && out.ruleIds.every((id) => RULE_IDS.includes(id));
        probes.push({ name, expected: `${decision} · ${reasonCode}`, actual: `${out?.decision} · ${out?.reasonCode}`,
          ruleIds: out?.ruleIds ?? [], match: Boolean(shapeOk && out.decision === decision && out.reasonCode === reasonCode) });
      }
      const decider = { source: 'server_run', ruleIds: [...RULE_IDS], ruleCount: RULE_IDS.length,
        probes, matched: probes.filter((p) => p.match).length, total: probes.length };

      // ---- 탐지 사건: 서버에서 가상 사건을 실행. 운영 엔진의 실제 사건은 연결되지 않음 ----
      const cases = await checkDetection(detect);
      const detection = {
        practice: { source: 'server_run', cases: cases.map((c) => ({ name: c.name, match: c.passed })), matched: cases.filter((c) => c.passed).length, total: cases.length },
        live: { source: 'not_run', reason: '운영 반 엔진이 검증한 실제 조회 사건을 이 서버로 전달하는 경로가 없어 결과가 없습니다' },
      };

      // ---- 회수 상태: 요청자 본인의 기기 기록(가림) ----
      const { data: devRows, error: devError } = await client.from('device_credentials')
        .select('id, credential_id, status, created_at, approved_at, last_used_at').eq('owner_id', ownerKey);
      if (devError) return fail(response, 502, 'OPS_DB_FAILED');
      const devices = (devRows ?? []).map((d) => ({ id8: mask(d.id), kind: String(d.credential_id).startsWith('mem:') ? 'memory' : 'passkey',
        status: d.status, createdAt: d.created_at, approvedAt: d.approved_at ?? null, lastUsedAt: d.last_used_at ?? null }))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      const { data: sessRows, error: sessError } = await client.from('device_sessions').select('id, expires_at').eq('owner_id', ownerKey);
      if (sessError) return fail(response, 502, 'OPS_DB_FAILED');
      const activeSessions = (sessRows ?? []).filter((s) => Date.parse(s.expires_at) > now()).length;
      const revocation = { source: 'db', counts: { total: devices.length, ...countBy(devices, 'status', ['pending', 'approved', 'revoked']) },
        activeSessions, records: devices,
        detectorLink: { source: 'not_run', reason: '9단계 탐지의 회수 제안을 기기 회수로 바꾸는 집행은 운영 엔진 몫이라 이 서버에 결과가 없습니다' } };

      // ---- 복구 버전: 정책 사본(배포 고정 값) + 메모 사본·복구 감사 기록(DB) ----
      const { data: auditRows, error: auditError } = await client.from('restore_audit')
        .select('id, at, run_id, public_id, result, reason_code').eq('owner_id', ownerKey);
      if (auditError) return fail(response, 502, 'OPS_DB_FAILED');
      const audit = (auditRows ?? []).map((a) => ({ at: a.at, run8: mask(a.run_id), note8: mask(a.public_id), result: a.result, reason: a.reason_code ?? null }))
        .sort((a, b) => String(b.at).localeCompare(String(a.at)));
      const { data: backupRows, error: backupError } = await client.from('notes_backup')
        .select('public_id, title, content, title_sha256, content_sha256, captured_at').eq('owner_id', ownerKey);
      if (backupError) return fail(response, 502, 'OPS_DB_FAILED');
      const backups = (backupRows ?? []).map((b) => ({ note8: mask(b.public_id), capturedAt: b.captured_at,
        hashOk: sha256(b.title) === b.title_sha256 && sha256(b.content) === b.content_sha256 })); // 본문은 해시만 비교하고 버림
      const resultKeys = ['started', 'restored', 'unchanged', 'rejected', 'failed', 'verify_failed'];
      const restore = {
        policyBaseline: { source: 'build', id: TRUSTED_BASELINE.id, commit7: String(TRUSTED_BASELINE.commit).slice(0, 7), manifest12: String(TRUSTED_BASELINE.manifestSha256).slice(0, 12),
          verification: { source: 'not_run', reason: '정책 사본 파일 대조는 저장소에서 npm run policy:diff로 합니다(배포 함수에는 사본 파일이 없음)' } },
        backups: { source: 'db', total: backups.length, hashOk: backups.filter((b) => b.hashOk).length, records: backups },
        audit: { source: 'db', total: audit.length, counts: countBy(audit, 'result', resultKeys), lastAt: audit[0]?.at ?? null,
          runs: new Set(audit.map((a) => a.run8)).size, records: audit },
      };

      // ---- 수치와 가린 기록 대조(서버가 직접) ----
      const recount = (rows, key, keys) => keys.every((k) => rows.filter((r) => r[key] === k).length === (key === 'status' ? revocation.counts[k] : restore.audit.counts[k]));
      const consistency = {
        devices: revocation.counts.total === revocation.records.length && recount(revocation.records, 'status', ['pending', 'approved', 'revoked']),
        audit: restore.audit.total === restore.audit.records.length && recount(restore.audit.records, 'result', resultKeys),
        backups: restore.backups.total === restore.backups.records.length && restore.backups.hashOk === restore.backups.records.filter((b) => b.hashOk).length,
        decider: decider.matched === decider.probes.filter((p) => p.match).length,
      };

      log(`ops: 요약 devices=${revocation.counts.total} audit=${restore.audit.total} backups=${restore.backups.total} decider=${decider.matched}/${decider.total} detect=${detection.practice.matched}/${detection.practice.total}`);
      return response.status(200).json({
        ok: true, schema: 'byteback.ops.v1', generatedAt: new Date(now()).toISOString(),
        deployment: { commit7: String(env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || null, step: config.step },
        owner8: mask(ownerKey), decider, detection, revocation, restore, consistency,
      });
    } catch {
      return fail(response, 500, 'OPS_SERVER_ERROR');
    }
  };
}

export default createOpsHandler();
