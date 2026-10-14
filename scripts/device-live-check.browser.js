// BYTE BACK 11단계 · 배포에서 기기 승인·요청 서명 경우의 수 확인 (브라우저 개발자 도구 콘솔에 붙여 넣기)
// - 배포 주소에 로그인한 탭에서 실행합니다. 같은 탭에서 두 번 실행합니다.
//   1차(승인 전): 이 시험용 기기 키를 메모리에 만들어 '승인 대기'로 등록하고, 승인 전 거부를 확인한 뒤 기기 번호 앞자리를 알려 줍니다.
//   → Supabase SQL Editor에서 그 기기를 승인(supabase/notes-step11-devices.sql ④)
//   2차(승인 뒤): 승인 기기의 정상 요청과 괴물 경우의 수(서명 없음·서명 뒤 경로/본문 변경·재전송·시각 초과)를 확인합니다.
// - 시험용 기기 키는 내보낼 수 없게 만들어 이 탭의 메모리(window 변수)에만 둡니다. 토큰·키·메모 본문은 출력하지 않습니다.
(async () => {
  const W = window.__bytebackDeviceCheck ??= { rows: [] };
  const enc = new TextEncoder();
  const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const sha = async (t) => hex(await crypto.subtle.digest('SHA-256', enc.encode(t)));
  const s = JSON.parse(localStorage.getItem('byteback-session') ?? 'null');
  if (!s?.access_token) { console.error('배포 주소에 로그인한 뒤 다시 실행하세요.'); return; }
  const AUTH = { Authorization: `Bearer ${s.access_token}` };
  const rows = [];
  const add = (group, name, expected, actual, ok) => rows.push({ 묶음: group, 시험: name, 기대: expected, 실제: String(actual), 결과: ok ? '통과' : '실패' });
  const call = async (method, path, { headers = {}, body } = {}) => {
    const r = await fetch(path, { method, cache: 'no-store', headers: { ...headers, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body });
    let json = null; try { json = await r.json(); } catch { /* 204 */ }
    return { status: r.status, error: json?.error, json };
  };
  const device = (action, payload) => call('POST', `/api/device/${action}`, { headers: AUTH, body: JSON.stringify(payload ?? {}) });
  if (!W.key) {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
    const j = await crypto.subtle.exportKey('jwk', pair.publicKey);
    W.key = { pair, pub: { kty: j.kty, crv: j.crv, x: j.x, y: j.y } };
  }
  const signText = async (t) => b64u(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, W.key.pair.privateKey, enc.encode(t)));
  const prove = async (purpose) => {
    const start = await device('key-challenge', { deviceKey: W.key.pub, purpose });
    if (start.status !== 200) return start;
    return device(purpose === 'register' ? 'key-register' : 'key-session',
      { challengeId: start.json.challengeId, deviceKey: W.key.pub, signature: await signText(start.json.message), label: '배포 확인 스크립트' });
  };
  const proofHeaders = async ({ method, path, body = '', sessionId, timestamp = Date.now(), nonce }) => {
    const u = new URL(path, location.origin);
    nonce ??= b64u(crypto.getRandomValues(new Uint8Array(18)));
    const canonical = ['aleph-device-v1', method, u.pathname.replace(/\/+$/, '') || '/', u.search, await sha(body), String(timestamp), nonce, sessionId].join('\n');
    return { 'X-Device-Session': sessionId, 'X-Device-Timestamp': String(timestamp), 'X-Device-Nonce': nonce, 'X-Device-Signature': await signText(canonical) };
  };
  const RANDOM_ID = crypto.randomUUID();

  // ---- 1차: 승인 전 ----
  if (!W.deviceId) {
    const reg = await prove('register');
    add('승인 전', '이 기기 승인 요청(메모리 키)', '201 pending', `${reg.status} ${reg.json?.status}`, reg.status === 201 && reg.json?.status === 'pending');
    if (reg.status === 201) W.deviceId = reg.json.deviceId;
  }
  const sess = await prove('session');
  const approved = sess.status === 200 && sess.json?.approved === true && sess.json.sessionId;
  if (!approved) {
    add('승인 전', '승인 전 자료실 열기(세션 요청)', '200 approved:false, 세션 없음', `${sess.status} ${sess.json?.status} 세션:${sess.json?.sessionId ? '있음' : '없음'}`, sess.status === 200 && sess.json?.approved === false && !sess.json.sessionId);
    const r1 = await call('GET', '/api/notes', { headers: AUTH });
    add('승인 전', '괴물 1: 서명 없이 메모 목록(로그인 토큰만)', '403 DEVICE_PROOF_REQUIRED', `${r1.status} ${r1.error}`, r1.status === 403 && r1.error === 'DEVICE_PROOF_REQUIRED');
    const r2 = await call('POST', '/api/restore', { headers: AUTH, body: JSON.stringify({ id: RANDOM_ID }) });
    add('승인 전', '괴물 1: 서명 없이 복구 요청', '403 DEVICE_PROOF_REQUIRED', `${r2.status} ${r2.error}`, r2.status === 403 && r2.error === 'DEVICE_PROOF_REQUIRED');
    const fake = await proofHeaders({ method: 'GET', path: '/api/notes', sessionId: crypto.randomUUID() });
    const r3 = await call('GET', '/api/notes', { headers: { ...AUTH, ...fake } });
    add('승인 전', '없는(꾸민) 기기 세션으로 서명', '403 DEVICE_NOT_APPROVED', `${r3.status} ${r3.error}`, r3.status === 403 && r3.error === 'DEVICE_NOT_APPROVED');
    const r4 = await call('GET', '/api/notes');
    add('승인 전', '토큰 없이 메모 목록(기존 결과)', '401', r4.status, r4.status === 401);
    console.table(rows);
    console.log(`1차(승인 전) 통과 ${rows.filter((r) => r.결과 === '통과').length} · 실패 ${rows.filter((r) => r.결과 === '실패').length}`);
    console.log(`→ Supabase SQL Editor에서 이 기기를 승인한 뒤, 이 탭에서 스크립트를 한 번 더 실행하세요. 기기 번호 앞자리: ${String(W.deviceId).slice(0, 8)}`);
    console.log("   update public.device_credentials set status = 'approved', approved_at = now() where id::text like '" + String(W.deviceId).slice(0, 8) + "%' and status = 'pending';");
    return;
  }

  // ---- 2차: 승인 뒤 ----
  const sid = sess.json.sessionId;
  add('승인 뒤', '승인된 기기로 자료실 열기(세션)', '200 approved:true', `${sess.status} ${sess.json.status}`, true);
  const signed = async (method, path, body) => call(method, path, { headers: { ...AUTH, ...(await proofHeaders({ method, path, body: body ?? '', sessionId: sid })) }, body });
  const list = await signed('GET', '/api/notes');
  add('승인 뒤 정상', '메모 목록', '200', list.status, list.status === 200);
  const made = await signed('POST', '/api/notes', JSON.stringify({ title: '11단계 기기 확인(가상)', body: '가상 내용' }));
  add('승인 뒤 정상', '메모 추가', '201', made.status, made.status === 201);
  const id = made.json?.id;
  const one = await signed('GET', `/api/notes/${id}`);
  add('승인 뒤 정상', '메모 한 건 조회', '200', one.status, one.status === 200);
  const edit = await signed('PUT', `/api/notes/${id}`, JSON.stringify({ title: '11단계 기기 확인(가상)', body: '수정한 가상 내용' }));
  add('승인 뒤 정상', '메모 수정', '200', edit.status, edit.status === 200);

  const h1 = await proofHeaders({ method: 'GET', path: `/api/notes/${id}`, sessionId: sid });
  const m2a = await call('GET', `/api/notes/${RANDOM_ID}`, { headers: { ...AUTH, ...h1 } });
  add('괴물 2', '서명 뒤 메모 ID 변경', '403 DEVICE_SIGNATURE_INVALID', `${m2a.status} ${m2a.error}`, m2a.status === 403 && m2a.error === 'DEVICE_SIGNATURE_INVALID');
  const h2 = await proofHeaders({ method: 'GET', path: '/api/notes', sessionId: sid });
  const m2b = await call('GET', `/api/notes?owner_id=${RANDOM_ID}`, { headers: { ...AUTH, ...h2 } });
  add('괴물 2', '서명 뒤 쿼리 추가', '403 DEVICE_SIGNATURE_INVALID', `${m2b.status} ${m2b.error}`, m2b.status === 403 && m2b.error === 'DEVICE_SIGNATURE_INVALID');
  const h3 = await proofHeaders({ method: 'GET', path: `/api/notes/${id}`, sessionId: sid });
  const m2c = await call('DELETE', `/api/notes/${id}`, { headers: { ...AUTH, ...h3 } });
  add('괴물 2', '서명 뒤 메서드 변경(GET→DELETE)', '403 DEVICE_SIGNATURE_INVALID', `${m2c.status} ${m2c.error}`, m2c.status === 403 && m2c.error === 'DEVICE_SIGNATURE_INVALID');
  const h4 = await proofHeaders({ method: 'POST', path: '/api/notes', body: '{"title":"t","body":"b"}', sessionId: sid });
  const m2d = await call('POST', '/api/restore', { headers: { ...AUTH, ...h4 }, body: '{"title":"t","body":"b"}' });
  add('괴물 2', '서명 뒤 경로 변경(메모→복구)', '403 DEVICE_SIGNATURE_INVALID', `${m2d.status} ${m2d.error}`, m2d.status === 403 && m2d.error === 'DEVICE_SIGNATURE_INVALID');

  const signedBody = JSON.stringify({ title: '11단계 기기 확인(가상)', body: '서명한 내용' });
  const h5 = await proofHeaders({ method: 'PUT', path: `/api/notes/${id}`, body: signedBody, sessionId: sid });
  const m3a = await call('PUT', `/api/notes/${id}`, { headers: { ...AUTH, ...h5 }, body: JSON.stringify({ title: '11단계 기기 확인(가상)', body: '바꿔치기한 내용' }) });
  add('괴물 3', '서명 뒤 수정 본문 변경', '403 DEVICE_SIGNATURE_INVALID', `${m3a.status} ${m3a.error}`, m3a.status === 403 && m3a.error === 'DEVICE_SIGNATURE_INVALID');
  const h6 = await proofHeaders({ method: 'POST', path: '/api/restore', body: JSON.stringify({ id }), sessionId: sid });
  const m3b = await call('POST', '/api/restore', { headers: { ...AUTH, ...h6 }, body: JSON.stringify({ id: RANDOM_ID }) });
  add('괴물 3', '서명 뒤 복구 대상 변경', '403 DEVICE_SIGNATURE_INVALID', `${m3b.status} ${m3b.error}`, m3b.status === 403 && m3b.error === 'DEVICE_SIGNATURE_INVALID');
  const after = await signed('GET', `/api/notes/${id}`);
  add('괴물 3', '바꿔치기 시도 뒤 메모 그대로', '수정한 가상 내용', after.json?.body === '수정한 가상 내용' ? '그대로' : '바뀜', after.json?.body === '수정한 가상 내용');

  const m1 = await call('GET', `/api/notes/${id}`, { headers: AUTH });
  add('괴물 1', '승인 기기라도 서명 없이 조회', '403 DEVICE_PROOF_REQUIRED', `${m1.status} ${m1.error}`, m1.status === 403 && m1.error === 'DEVICE_PROOF_REQUIRED');
  const h7 = await proofHeaders({ method: 'GET', path: `/api/notes/${id}`, sessionId: sid });
  const ok1 = await call('GET', `/api/notes/${id}`, { headers: { ...AUTH, ...h7 } });
  const rp = await call('GET', `/api/notes/${id}`, { headers: { ...AUTH, ...h7 } });
  add('재전송', '같은 서명 요청 다시 보내기', '200 → 403 DEVICE_PROOF_REPLAYED', `${ok1.status} → ${rp.status} ${rp.error}`, ok1.status === 200 && rp.status === 403 && rp.error === 'DEVICE_PROOF_REPLAYED');
  const h8 = await proofHeaders({ method: 'GET', path: `/api/notes/${id}`, sessionId: sid, timestamp: Date.now() - 5 * 60 * 1000 });
  const old = await call('GET', `/api/notes/${id}`, { headers: { ...AUTH, ...h8 } });
  add('시각', '5분 전 시각으로 서명', '403 DEVICE_PROOF_EXPIRED', `${old.status} ${old.error}`, old.status === 403 && old.error === 'DEVICE_PROOF_EXPIRED');
  const noTok = await call('GET', `/api/notes/${id}`, { headers: h7 });
  add('기존 결과', '토큰 없이(서명만) 조회', '401', noTok.status, noTok.status === 401);

  const del = await signed('DELETE', `/api/notes/${id}`);
  add('승인 뒤 정상', '시험 메모 삭제(정리)', '204', del.status, del.status === 204);
  console.table(rows);
  const pass = rows.filter((r) => r.결과 === '통과').length;
  console.log(`2차(승인 뒤) 통과 ${pass} · 실패 ${rows.length - pass} · 기기 번호 앞자리 ${String(W.deviceId).slice(0, 8)} · ${new Date().toISOString()}`);
  console.log("시험용 기기는 회수해 두세요: update public.device_credentials set status = 'revoked' where id::text like '" + String(W.deviceId).slice(0, 8) + "%';");
})();
