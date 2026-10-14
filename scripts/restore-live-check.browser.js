// BYTE BACK 10단계 · 배포에서 시험 계정 B로 복구와 복구 직후 재시험 (브라우저 개발자 도구 콘솔에 붙여 넣기)
// - https://choi-bujang-secret-vault-sandy.vercel.app 탭에서 실행합니다(시험 계정 B의 이메일·비밀번호를 물음).
// - 11단계부터는 보호 요청에 기기 서명이 필요해, 이 스크립트의 메모·복구 요청은 403 DEVICE_PROOF_REQUIRED가 나오는 것이 정상입니다.
// - 토큰·메모 본문은 출력하지 않습니다. 결과표와 해시 앞 12자리만 출력합니다.
// - 가상 메모 한 건을 만들어 변조→복구, 삭제→복구한 뒤, 복구 직후 금지 요청과 정상 요청을 다시 보냅니다.
(async () => {
  const rows = [];
  const add = (group, name, expected, actual, ok) => rows.push({ 묶음: group, 시험: name, 기대: expected, 실제: actual, 결과: ok ? '통과' : '실패' });
  const sha = async (t) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(t ?? ''))))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  // 로그인 토큰은 브라우저 저장소에서 읽지 않습니다. 시험 계정으로 직접 로그인해 이 탭 메모리(window 변수)에만 둡니다.
  const LOGIN = window.__bytebackCheckLogin ??= {};
  if (!LOGIN.token) {
    const email = prompt('시험 계정 이메일');
    const password = email ? prompt('시험 계정 비밀번호 (이 탭 메모리에서만 쓰고 저장·출력하지 않음)') : null;
    if (!email || !password) { console.error('로그인 정보를 넣지 않아 멈춥니다.'); return; }
    const r = await fetch('/api/auth/login', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d?.access_token) { console.error('로그인하지 못했습니다.'); return; }
    LOGIN.token = d.access_token;
  }
  const auth = { Authorization: `Bearer ${LOGIN.token}` };
  const call = async (method, path, { body, headers = auth } = {}) => {
    const r = await fetch(path, { method, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let json = null; try { json = await r.json(); } catch { /* 204 등 */ }
    return { status: r.status, json };
  };
  const started = new Date().toISOString();
  const title = '10단계 복구 시험 메모(가상)';
  const text = `침해 전 가상 내용 ${started}`;
  const [titleSha, textSha] = [await sha(title), await sha(text)];

  // 1) 메모 만들기(사본 생성)
  const made = await call('POST', '/api/notes', { body: { title, body: text } });
  const id = made.json?.id;
  add('준비', 'B 메모 만들기', '201', made.status, made.status === 201 && !!id);
  if (!id) { console.table(rows); return; }

  const checkRestore = async (label) => {
    const r = await call('POST', '/api/restore', { body: { id } });
    const b = r.json ?? {};
    const v = b.verified ?? {};
    add(label, '복구 요청', '200 restored:true', `${r.status} restored:${b.restored}`, r.status === 200 && b.restored === true);
    add(label, '응답 ID = 지정한 ID', id.slice(0, 8), String(b.id).slice(0, 8), b.id === id);
    add(label, '응답 소유자 = 사본 소유자', '같음', b.ownerId && b.ownerId === b.backup?.ownerId ? '같음' : '다름', !!b.ownerId && b.ownerId === b.backup?.ownerId);
    add(label, '응답 내용 해시 = 침해 전 내용 해시', textSha.slice(0, 12), String(b.contentSha256).slice(0, 12), b.contentSha256 === textSha && b.backup?.contentSha256 === textSha);
    add(label, '응답 제목 해시 = 침해 전 제목 해시', titleSha.slice(0, 12), String(b.titleSha256).slice(0, 12), b.titleSha256 === titleSha);
    add(label, 'verified 모두 true', 'id·owner·contentHash·otherNotesUnchanged·auditHistoryPreserved',
      JSON.stringify(v), ['id', 'owner', 'contentHash', 'otherNotesUnchanged', 'auditHistoryPreserved'].every((k) => v[k] === true));
    add(label, '감사 기록', 'started→restored, 이전 기록 보존', `${(b.audit?.recorded ?? []).join('→')} ${b.audit?.entriesBefore}→${b.audit?.entriesAfter} 보존:${b.audit?.previousEntriesPreserved}`,
      b.audit?.recorded?.join() === 'started,restored' && b.audit?.previousEntriesPreserved === true && b.audit?.entriesAfter >= b.audit?.entriesBefore + 2);
    add(label, '다른 메모 그대로', 'otherNotesUnchanged:true', `확인 ${b.scope?.otherNotesChecked}건, ${b.scope?.otherNotesUnchanged}`, b.scope?.otherNotesUnchanged === true && b.scope?.restoredNotes === 1);
    add(label, '응답에 본문 없음', '없음', JSON.stringify(b).includes(text) ? '있음' : '없음', !JSON.stringify(b).includes(text));
    const read = await call('GET', `/api/notes/${id}`);
    add(label, '복구 뒤 B가 다시 조회', '200, 내용 해시 같음', `${read.status}`, read.status === 200 && (await sha(read.json?.body)) === textSha && (await sha(read.json?.title)) === titleSha);
  };

  // 2) 변조 → 복구
  const put = await call('PUT', `/api/notes/${id}`, { body: { title: '변조된 제목(가상)', body: '변조된 내용(가상)' } });
  add('변조 뒤 복구', 'B 메모 변조', '200', put.status, put.status === 200);
  await checkRestore('변조 뒤 복구');

  // 3) 삭제 → 복구
  const del = await call('DELETE', `/api/notes/${id}`);
  add('삭제 뒤 복구', 'B 메모 삭제', '204', del.status, del.status === 204);
  await checkRestore('삭제 뒤 복구');

  // 4) 복구 직후 금지 요청 다시 보내기
  const none = { headers: {} };
  const forged = { headers: { Authorization: 'Bearer forged.tok.x' } };
  const deny = [
    ['1·2단계: 공개 data.json', 'GET', '/data.json', none, null, [404]],
    ['3단계: 토큰 없이 메모 목록', 'GET', '/api/notes', none, null, [401]],
    ['3단계: 토큰 없이 복구된 메모 조회', 'GET', `/api/notes/${id}`, none, null, [401]],
    ['3단계: 위조 토큰으로 메모 조회', 'GET', `/api/notes/${id}`, forged, null, [401]],
    ['4·8단계: 쿼리로 소유자 지정', 'GET', '/api/notes?owner_id=00000000-0000-4000-8000-000000000000', {}, null, [400, 403]],
    ['4단계: 본문 owner_id로 남의 주인 지정', 'POST', '/api/notes', {}, { title: 't', body: 'b', owner_id: '00000000-0000-4000-8000-000000000000' }, [400, 403]],
    ['8단계: 본문 role로 권한 올리기', 'POST', '/api/notes', {}, { title: 't', body: 'b', role: 'instructor' }, [400, 403]],
    ['10단계: 토큰 없이 복구 요청', 'POST', '/api/restore', none, { id }, [401]],
    ['10단계: 복구 요청에 owner_id 칸', 'POST', '/api/restore', {}, { id, owner_id: '00000000-0000-4000-8000-000000000000' }, [400]],
    ['10단계: GET으로 복구 경로', 'GET', '/api/restore', {}, null, [405]],
  ];
  for (const [name, method, path, opt, body, codes] of deny) {
    const r = await call(method, path, { ...opt, ...(body ? { body } : {}) });
    add('복구 직후 금지 요청', name, codes.join('/'), r.status, codes.includes(r.status));
  }

  // 5) 복구 직후 정상 요청
  const one = await call('GET', `/api/notes/${id}`);
  add('복구 직후 정상 요청', 'B 본인 메모 조회', '200, 내용 해시 같음', one.status, one.status === 200 && (await sha(one.json?.body)) === textSha);
  const list = await call('GET', '/api/notes');
  add('복구 직후 정상 요청', 'B 본인 메모 목록', '200 또는 8단계 정책 거부', list.status, [200, 403, 404, 405].includes(list.status));
  const after = await call('GET', `/api/notes/${id}`);
  add('복구 직후 정상 요청', '금지 요청 뒤에도 메모 그대로', '내용 해시 같음', after.status, after.status === 200 && (await sha(after.json?.body)) === textSha);

  console.table(rows);
  const pass = rows.filter((r) => r.결과 === '통과').length;
  console.log(`배포 B 계정 복구·재시험: 통과 ${pass} · 실패 ${rows.length - pass} · 시작 ${started} · 시험 메모 ID 앞자리 ${id.slice(0, 8)}`);
})();
