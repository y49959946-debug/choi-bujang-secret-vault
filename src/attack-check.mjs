// The student changes this check as each stage adds an attack to the same app.
// Never return tokens, private keys, real names, or note bodies.
//
// 1단계: 비로그인 화면에서 공개 가상 메모(data.json)가 보이는지 확인합니다.
// 2단계부터(현재 12단계): 같은 배포 주소에 로그인 없이 요청을 보내, 보호가 실제로 막는지 확인합니다.
//   - 공개 data.json은 더 이상 없어야 합니다(404).
//   - 메모 목록·메모 한 건 API는 로그인 없이 열리지 않아야 합니다(401).
//   토큰·쿠키를 보내지 않고, 응답 본문은 기록하지 않으며 상태 코드만 남깁니다.
//   이 결과는 학생의 자기 점검이며 심판 판정이 아닙니다.

function deployedApp(config) {
  let app;
  try {
    app = new URL(config.publicAppUrl);
  } catch {
    throw new Error('aleph.config.json의 실제 배포 주소를 먼저 넣어 주세요.');
  }
  if (app.protocol !== 'https:' || app.username || app.password || app.search || app.hash
      || app.pathname !== '/' || app.hostname.endsWith('.example')) {
    throw new Error('aleph.config.json의 실제 배포 주소를 먼저 넣어 주세요.');
  }
  return app;
}

async function firstStageCheck(config, app) {
  if (typeof config.sampleMarker !== 'string' || !config.sampleMarker) throw new Error('가상 메모의 확인 표시를 넣어 주세요.');
  const response = await fetch(new URL('/data.json', app), {
    redirect: 'error', signal: AbortSignal.timeout(10000),
  });
  let visible = false;
  if (response.ok) {
    try {
      const data = await response.json();
      visible = data?.sampleMarker === config.sampleMarker && Array.isArray(data.notes)
        && data.notes.length > 0;
    } catch {
      // A non-JSON response is a failed check, not a successful deployment.
    }
  }
  return [{ attackId: 'anonymous_note_read', expected: '비로그인 화면에서 가상 메모를 확인',
    observed: visible ? '비로그인 요청에서 공개 가상 메모 확인 표시가 보임' : `비로그인 요청에서 확인 표시가 보이지 않음 (HTTP ${response.status})` }];
}

export async function runAttackChecks(config) {
  const app = deployedApp(config);
  if (config.step === 1) return firstStageCheck(config, app);
  if (!Number.isInteger(config.step) || config.step < 1 || config.step > 12) {
    throw new Error('aleph.config.json의 step을 확인해 주세요.');
  }

  // 12단계 심판 「실행 기록 대조」 — 실험(2026-10-15):
  // 이 세 점검은 모두 무인증(토큰 없는) 요청입니다. 심판은 자기 실행을 토큰 안의 실행 번호(aleph_run)로
  // 식별해 요청과 연결하는데, 무인증 요청에는 그 번호를 실을 수 없습니다. 그래서 학생이 여기서 직접 보낸
  // 요청은 심판의 이번 실행 기록과 연결되지 않습니다(②③은 심판의 로그인 요청으로 판정되어 통과, ①만 막힘).
  // 심판 안내는 "실제 요청이 없으면 not_run으로 적고, 실제 응답이 확인된 경우에만 HTTP 상태를 적어라"입니다.
  // 무인증 조회는 심판이 자기 공격으로 직접 수행·판정하는 항목으로 보고, 학생 쪽에서는 상태를 지어내지 않고
  // 셋 다 not_run(이 실행에서 심판이 확인할 수 있는 요청 아님)으로 남깁니다. 배포 자체의 무인증 차단 결과는
  // 12단계 화면의 「1~11단계 실측표」(s1·s3·m1)에서 실제 응답(요청 ID 포함)으로 따로 기록했습니다.
  return [
    { attackId: 'anonymous_note_read', expected: '공개 data.json이 없어 404(심판이 직접 확인)', observed: 'not_run' },
    { attackId: 'anonymous_note_list', expected: '로그인 없는 메모 목록 요청은 401(심판이 직접 확인)', observed: 'not_run' },
    { attackId: 'anonymous_other_note_read', expected: '로그인 없는 메모 한 건 요청은 401(심판이 직접 확인)', observed: 'not_run' },
  ];
}
