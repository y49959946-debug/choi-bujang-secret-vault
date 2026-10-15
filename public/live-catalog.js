// 12단계 제작 2 · 1~11단계 실측표의 요청 목록과 판정 규칙
// - 화면(public/index.html)이 이 목록대로 실제 배포 API에 요청을 보내고, 응답의 상태 코드·오류 코드·x-vercel-id·Date를 기록합니다.
// - 판정은 "기대 = 실제"일 때만 통과입니다. 실행하지 않은 줄은 미실행, 실행했지만 다르면 실패입니다.
// - 출처(source)
//     api     : 배포 API에 실제 HTTP 요청을 보내 받은 응답(통과·실패 집계 대상)
//     sql     : HTTP가 아니라 Supabase SQL Editor 권한 확인으로만 볼 수 있음(이 표에서 실행하지 않음, 집계 제외)
//     note    : 실제로 보내지만 그 단계 규칙의 증거가 아닌 참고 응답(예: 없는 경로의 404). 집계 제외
//     not_run : 이 앱의 API로는 실행할 수 없음(운영 엔진 몫 등). 이유를 적고 통과로 세지 않음
// - 표에는 토큰·메모 본문·전체 ID를 넣지 않습니다. 요청 모양은 {내 시험 메모}·{남의 메모} 같은 자리 표시로만 씁니다.

export const LIVE_SCHEMA = 'byteback.live-check.v1';

// expect: { status, error?, check? }  check는 응답 본문에서 확인할 추가 조건 이름
export const CHECKS = Object.freeze({
  verifiedAll: '복구 응답 verified 모든 칸 true',
  pending: 'status pending(승인 대기)',
  notApprovedNoSession: 'approved false, 기기 세션 없음',
  approvedSession: 'approved true, 기기 세션 있음',
  revokedNoSession: 'status revoked, 기기 세션 없음',
});

const row = (r) => Object.freeze({ phase: 1, needsOther: false, monster: null, ...r });

export const LIVE_ROWS = Object.freeze([
  // ── 1차: 쓰는 기기(승인된 이 화면)로 실행 ──
  row({ id: 's1-public-data', stage: '1·2', kind: '금지', source: 'api', shape: 'GET /data.json · 토큰 없음', expect: { status: 404 } }),
  row({ id: 's1-home', stage: '1·2', kind: '정상', source: 'api', shape: 'GET / (화면) · 토큰 없음', expect: { status: 200 } }),
  row({ id: 's3-no-token', stage: '3', kind: '금지', source: 'api', shape: 'GET /api/notes · 토큰 없음', expect: { status: 401, error: 'LOGIN_REQUIRED' } }),
  row({ id: 's3-forged-token', stage: '3', kind: '금지', source: 'api', shape: 'GET /api/notes · 위조 토큰', expect: { status: 401, error: 'LOGIN_REQUIRED' } }),
  row({ id: 's4-create', stage: '4', kind: '정상', source: 'api', shape: 'POST /api/notes · 본인 · 서명', expect: { status: 201 } }),
  row({ id: 's4-read-own', stage: '4', kind: '정상', source: 'api', shape: 'GET /api/notes/{내 시험 메모} · 본인 · 서명', expect: { status: 200 } }),
  row({ id: 's4-list-own', stage: '4', kind: '정상', source: 'api', shape: 'GET /api/notes · 본인 · 서명', expect: { status: 200 } }),
  row({ id: 's4-edit-own', stage: '4', kind: '정상', source: 'api', shape: 'PUT /api/notes/{내 시험 메모} · 본인 · 서명', expect: { status: 200 } }),
  row({ id: 's4-read-other', stage: '4', kind: '금지', source: 'api', needsOther: true, shape: 'GET /api/notes/{남의 메모} · 본인 · 서명', expect: { status: 403, error: 'OWNER_MISMATCH' } }),
  row({ id: 's4-edit-other', stage: '4', kind: '금지', source: 'api', needsOther: true, shape: 'PUT /api/notes/{남의 메모} · 본인 · 서명', expect: { status: 403, error: 'OWNER_MISMATCH' } }),
  row({ id: 's4-delete-other', stage: '4', kind: '금지', source: 'api', needsOther: true, shape: 'DELETE /api/notes/{남의 메모} · 본인 · 서명', expect: { status: 403, error: 'OWNER_MISMATCH' } }),
  row({ id: 's5-browser-key', stage: '5', kind: '금지', source: 'sql', shape: '브라우저 공개 키로 Supabase notes 직접 호출', reason: '화면에 공개 키가 없어 HTTP로 시험하지 않습니다. supabase/notes-step5-revoke.sql ①(anon·authenticated 권한 없음)으로 따로 확인' }),
  row({ id: 's6-unsigned', stage: '6', kind: '금지', source: 'api', shape: 'GET /api/notes · 본인 토큰 · 기기 서명 없음', expect: { status: 403, error: 'DEVICE_PROOF_REQUIRED' } }),
  row({ id: 's6-fake-session', stage: '6', kind: '금지', source: 'api', shape: 'GET /api/notes · 본인 토큰 · 없는 기기 세션으로 서명', expect: { status: 403, error: 'DEVICE_NOT_APPROVED' } }),
  row({ id: 's6-testdev-register', stage: '6', kind: '준비', source: 'api', shape: 'POST /api/device/key-register · 시험용 기기 키 승인 요청', expect: { status: 201, check: 'pending' } }),
  row({ id: 's6-testdev-before', stage: '6', kind: '금지', source: 'api', shape: 'POST /api/device/key-session · 승인 전 시험용 기기', expect: { status: 200, check: 'notApprovedNoSession' } }),
  row({ id: 's7-step-up', stage: '7', kind: '금지', source: 'not_run', shape: '복합 이상 접속 재확인(step_up)', reason: '재확인은 운영 반 엔진이 판정기를 불러 처리합니다. 이 앱의 API는 판정기를 부르지 않아 HTTP로 실행할 수 없음(작전실 「판정기 규칙」의 서버 실행 결과는 가상 요청)' }),
  row({ id: 's8-query-owner', stage: '8', kind: '금지', source: 'api', shape: 'GET /api/notes?owner_id=… · 본인 · 서명', expect: { status: 400, error: 'QUERY_NOT_ALLOWED' } }),
  row({ id: 's8-body-role', stage: '8', kind: '금지', source: 'api', shape: 'POST /api/notes 본문 role · 본인 · 서명', expect: { status: 403, error: 'ROLE_NOT_TRUSTED' } }),
  row({ id: 's8-body-owner', stage: '8', kind: '금지', source: 'api', shape: 'POST /api/notes 본문 owner_id · 본인 · 서명', expect: { status: 403, error: 'OWNER_MISMATCH' } }),
  row({ id: 's8-zone-note', stage: '8', kind: '참고', source: 'note', shape: 'GET /api/notices · 본인 토큰', expect: { status: 404 }, reason: '이 앱에는 공지·강사 자료 API가 없어 경로 없음 404입니다. 구역 규칙이 막은 증거가 아니므로 집계하지 않음. 구역 규칙(ZONE_NOT_ALLOWED)은 api/notes.js가 경로를 스스로 /api/notes로 계산해 HTTP로는 도달할 수 없음' }),
  row({ id: 's9-detect', stage: '9', kind: '금지', source: 'not_run', shape: '낯선 네트워크 다량 조회 → 기기 회수', reason: '실제 조회 사건 전달과 회수 집행은 운영 반 엔진 몫. 이 앱에는 그 경로가 없음(작전실 「탐지 사건」의 서버 실행 결과는 가상 사건)' }),
  row({ id: 's10-tamper', stage: '10', kind: '준비', source: 'api', shape: 'PUT /api/notes/{내 시험 메모} · 내용 변조 · 서명', expect: { status: 200 } }),
  row({ id: 's10-restore-own', stage: '10', kind: '정상', source: 'api', shape: 'POST /api/restore {내 시험 메모} · 서명', expect: { status: 200, check: 'verifiedAll' } }),
  row({ id: 's10-restore-other', stage: '10', kind: '금지', source: 'api', needsOther: true, shape: 'POST /api/restore {남의 메모} · 서명', expect: { status: 404, error: 'BACKUP_NOT_FOUND' } }),
  row({ id: 's10-restore-unsigned', stage: '10', kind: '금지', source: 'api', shape: 'POST /api/restore · 본인 토큰 · 기기 서명 없음', expect: { status: 403, error: 'DEVICE_PROOF_REQUIRED' } }),
  row({ id: 's10-restore-extra', stage: '10', kind: '금지', source: 'api', shape: 'POST /api/restore 본문 {id, owner_id} · 서명', expect: { status: 400, error: 'INVALID_RESTORE_REQUEST' } }),
  row({ id: 's11-signed-ok', stage: '11', kind: '정상', source: 'api', shape: 'GET /api/notes/{내 시험 메모} · 정상 서명', expect: { status: 200 } }),
  row({ id: 's11-tamper-id', stage: '11', kind: '금지', source: 'api', shape: '{내 시험 메모} 조회로 서명 → 다른 메모 ID로 보냄', expect: { status: 403, error: 'DEVICE_SIGNATURE_INVALID' } }),
  row({ id: 's11-tamper-method', stage: '11', kind: '금지', source: 'api', shape: 'GET으로 서명 → DELETE로 보냄', expect: { status: 403, error: 'DEVICE_SIGNATURE_INVALID' } }),
  row({ id: 's11-tamper-route', stage: '11', kind: '금지', source: 'api', shape: 'POST /api/notes로 서명 → POST /api/restore로 보냄(같은 본문)', expect: { status: 403, error: 'DEVICE_SIGNATURE_INVALID' } }),
  row({ id: 's11-tamper-body', stage: '11', kind: '금지', source: 'api', shape: 'PUT 본문 A로 서명 → 본문 B로 보냄', expect: { status: 403, error: 'DEVICE_SIGNATURE_INVALID' } }),
  row({ id: 's11-replay-first', stage: '11', kind: '정상', source: 'api', shape: '재전송 시험 1회째(같은 서명 첫 사용)', expect: { status: 200 } }),
  row({ id: 's11-replay-second', stage: '11', kind: '금지', source: 'api', shape: '재전송 시험 2회째(같은 서명·번호 다시)', expect: { status: 403, error: 'DEVICE_PROOF_REPLAYED' } }),
  row({ id: 's11-expired', stage: '11', kind: '금지', source: 'api', shape: '5분 전 시각으로 서명', expect: { status: 403, error: 'DEVICE_PROOF_EXPIRED' } }),
  row({ id: 'm1-no-auth', stage: '12', monster: '①', kind: '금지', source: 'api', needsOther: true, shape: '괴물 ① 1: GET /api/notes/{남의 메모} · 토큰 없음', expect: { status: 401, error: 'LOGIN_REQUIRED' } }),
  row({ id: 'm1-other', stage: '12', monster: '①', kind: '금지', source: 'api', needsOther: true, shape: '괴물 ① 2(곧바로): GET /api/notes/{남의 메모} · 본인 · 서명', expect: { status: 403, error: 'OWNER_MISMATCH' } }),
  row({ id: 'm2-unsigned', stage: '12', monster: '②', kind: '금지', source: 'api', shape: '괴물 ② 1: GET /api/notes · 본인 토큰 · 미등록(서명 없음)', expect: { status: 403, error: 'DEVICE_PROOF_REQUIRED' } }),
  row({ id: 'm3-unsigned-edit', stage: '12', monster: '③', kind: '금지', source: 'api', shape: '괴물 ③ 1(복구 직후): PUT /api/notes/{내 시험 메모} · 본인 토큰 · 서명 없음', expect: { status: 403, error: 'DEVICE_PROOF_REQUIRED' } }),
  row({ id: 'm3-zone-note', stage: '12', monster: '③', kind: '참고', source: 'note', shape: '괴물 ③ 2: GET /api/notices · 본인 토큰', expect: { status: 404 }, reason: '경로 없음 404(구역 규칙 증거 아님, 집계 제외)' }),
  row({ id: 'm3-after-read', stage: '12', monster: '③', kind: '정상', source: 'api', shape: '괴물 ③ 뒤: GET /api/notes/{내 시험 메모} · 서명(복구 내용 그대로)', expect: { status: 200 } }),

  // ── 2차: 시험용 기기를 SQL로 승인한 뒤 ──
  row({ id: 's6-testdev-approved', stage: '6', phase: 2, kind: '정상', source: 'api', shape: 'POST /api/device/key-session · 승인된 시험용 기기', expect: { status: 200, check: 'approvedSession' } }),
  row({ id: 's6-testdev-read', stage: '6', phase: 2, kind: '정상', source: 'api', shape: 'GET /api/notes/{내 시험 메모} · 시험용 기기 서명', expect: { status: 200 } }),

  // ── 3차: 시험용 기기를 SQL로 회수한 뒤 ──
  row({ id: 'm2-revoked', stage: '12', phase: 3, monster: '②', kind: '금지', source: 'api', shape: '괴물 ② 2: GET /api/notes/{내 시험 메모} · 회수된 시험용 기기 서명', expect: { status: 403, error: 'DEVICE_NOT_APPROVED' } }),
  row({ id: 'm2-revoked-session', stage: '12', phase: 3, monster: '②', kind: '금지', source: 'api', shape: 'POST /api/device/key-session · 회수된 시험용 기기', expect: { status: 200, check: 'revokedNoSession' } }),
  row({ id: 's4-delete-own', stage: '4', phase: 3, kind: '정상', source: 'api', shape: 'DELETE /api/notes/{내 시험 메모} · 본인 · 서명(시험 메모 정리)', expect: { status: 204 } }),

  // ── 목록 밖 ──
  row({ id: 'x41-list', stage: '12', kind: '금지', source: 'not_run', shape: '41종 공격 전체', reason: '41종 공격 목록을 받지 못했습니다. 대응 여부를 확인할 수 없어 통과로 세지 않음' }),
]);

// 응답 본문에서 허용한 모양의 오류 코드만 꺼냄(본문 내용은 남기지 않음)
export function errorCodeOf(body) {
  const code = body && typeof body === 'object' ? body.error : null;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{2,47}$/u.test(code) ? code : null;
}

// 추가 조건 확인(본문에서 필요한 사실만 참·거짓으로)
export function checkOf(name, body) {
  if (!name) return null;
  const b = body && typeof body === 'object' ? body : {};
  switch (name) {
    case 'verifiedAll': return Boolean(b.verified) && Object.keys(b.verified).length > 0 && Object.values(b.verified).every((v) => v === true);
    case 'pending': return b.status === 'pending' && b.approved === false;
    case 'notApprovedNoSession': return b.approved === false && !b.sessionId;
    case 'approvedSession': return b.approved === true && typeof b.sessionId === 'string';
    case 'revokedNoSession': return b.status === 'revoked' && b.approved === false && !b.sessionId;
    default: return false;
  }
}

// 판정: 실행한 api·note 줄만. 상태 코드, (있으면) 오류 코드, (있으면) 추가 조건이 모두 같아야 통과
export function verdictOf(rowDef, actual) {
  if (rowDef.source === 'sql' || rowDef.source === 'not_run') return '미실행';
  if (!actual || actual.status == null) return '미실행';
  const e = rowDef.expect;
  const ok = actual.status === e.status && (e.error ? actual.error === e.error : true) && (e.check ? actual.check === true : true);
  if (rowDef.source === 'note') return ok ? '참고(일치)' : '참고(다름)';
  return ok ? '통과' : '실패';
}

export function summarize(results) {
  const counted = results.filter((r) => r.source === 'api');
  const count = (v) => counted.filter((r) => r.verdict === v).length;
  return {
    api: { total: counted.length, run: counted.filter((r) => r.verdict !== '미실행').length, pass: count('통과'), fail: count('실패'), notRun: count('미실행') },
    allowed: { pass: counted.filter((r) => r.kind === '정상' && r.verdict === '통과').length, total: counted.filter((r) => r.kind === '정상').length },
    denied: { pass: counted.filter((r) => r.kind === '금지' && r.verdict === '통과').length, total: counted.filter((r) => r.kind === '금지').length },
    excluded: { sql: results.filter((r) => r.source === 'sql').length, note: results.filter((r) => r.source === 'note').length, notRun: results.filter((r) => r.source === 'not_run').length },
  };
}
