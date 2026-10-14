// The student changes this check as each stage adds an attack to the same app.
// Never return tokens, private keys, real names, or note bodies.
//
// 1단계: 비로그인 화면에서 공개 가상 메모(data.json)가 보이는지 확인합니다.
// 2단계부터(현재 8단계): 같은 배포 주소에 로그인 없이 요청을 보내, 보호가 실제로 막는지 확인합니다.
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

async function statusOf(url) {
  try {
    const response = await fetch(url, {
      redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(10000),
    });
    return response.status;
  } catch {
    return null;
  }
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

const describe = (status, blockedStatus) => (status === null
  ? '요청이 완료되지 않음(미확인)'
  : status === blockedStatus ? `HTTP ${status}로 막힘` : `HTTP ${status} (기대와 다름)`);

export async function runAttackChecks(config) {
  const app = deployedApp(config);
  if (config.step === 1) return firstStageCheck(config, app);
  if (!Number.isInteger(config.step) || config.step < 1 || config.step > 12) {
    throw new Error('aleph.config.json의 step을 확인해 주세요.');
  }

  const sampleId = '00000000-0000-4000-8000-000000000001';
  const [dataJson, noteList, oneNote] = await Promise.all([
    statusOf(new URL('/data.json', app)),
    statusOf(new URL('/api/notes', app)),
    statusOf(new URL(`/api/notes/${sampleId}`, app)),
  ]);
  return [
    { attackId: 'anonymous_note_read', expected: '공개 data.json이 없어 404',
      observed: describe(dataJson, 404) },
    { attackId: 'anonymous_note_list', expected: '로그인 없는 메모 목록 요청은 401',
      observed: describe(noteList, 401) },
    { attackId: 'anonymous_other_note_read', expected: '로그인 없는 메모 한 건 요청은 401',
      observed: describe(oneNote, 401) },
  ];
}
