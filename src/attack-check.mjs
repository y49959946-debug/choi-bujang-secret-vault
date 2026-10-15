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

// 받은 응답의 HTTP 상태만 꺼냅니다. 응답이 없으면 null.
// 12단계 심판 「실행 기록 대조」: 배포(Vercel)가 실제로 보낸 응답에는 항상 요청 ID 머리글 x-vercel-id가 붙습니다.
// 이 머리글이 없는 응답(중간 장치·차단 장치가 대신 돌려준 응답 등)은 요청이 배포에 닿았는지 확인할 수 없으므로
// 받은 응답으로 치지 않고 null(→ not_run)로 둡니다. 요청 ID 값 자체는 기록하지 않습니다.
const VERCEL_REQUEST_ID = /^[a-z0-9]+::[A-Za-z0-9:_-]{6,120}$/u;
async function responseOf(url) {
  try {
    const response = await fetch(url, {
      redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(10000),
    });
    const requestId = response.headers?.get?.('x-vercel-id') ?? '';
    if (!VERCEL_REQUEST_ID.test(requestId)) return null;
    return { status: response.status };
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

// 12단계 심판 「실행 기록 대조」: observed에는 실제로 받은 HTTP 상태만 적습니다(예: "HTTP 404").
// 기대와 같은지 다른지, 요청 ID 같은 다른 글은 붙이지 않습니다. 응답을 받지 못했으면(네트워크 차단·시간 초과 등)
// 결과를 짐작하지 않고 'not_run'만 적습니다.
const describe = (res) => (res ? `HTTP ${res.status}` : 'not_run');

const pause = (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());
// 대기 시간(밀리초). 시험에서만 ATTACK_CHECK_GAP_MS=0 으로 줄입니다. 0~10000 정수만 받습니다.
function gapMs() {
  const raw = process.env.ATTACK_CHECK_GAP_MS;
  if (raw === undefined || raw === '') return 1500;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 10000 ? n : 1500;
}

export async function runAttackChecks(config) {
  const app = deployedApp(config);
  if (config.step === 1) return firstStageCheck(config, app);
  if (!Number.isInteger(config.step) || config.step < 1 || config.step > 12) {
    throw new Error('aleph.config.json의 step을 확인해 주세요.');
  }

  // 12단계 심판 「실행 기록 대조」: 세 점검은 제출한 배포 주소(aleph.config.json의 publicAppUrl,
  // 제출 화면의 "내 배포 주소"와 같은 주소)로만 보냅니다. 다른 주소를 찾아 바꾸지 않습니다.
  // 점검마다 요청 하나씩, 차례대로 보냅니다(같은 순간에 섞여 들어가지 않게).
  // 12단계 시험(근거 없는 시도): 요청 사이와 마지막 요청 뒤에 잠깐 기다립니다(기본 1.5초).
  // 요청 기록이 심판 쪽에 늦게 들어올 가능성을 시험하려는 것이며, 요청 내용·주소·기록 규칙은 바꾸지 않습니다.
  const gap = gapMs();
  const sampleId = '00000000-0000-4000-8000-000000000001';
  const dataJson = await responseOf(new URL('/data.json', app));
  await pause(gap);
  const noteList = await responseOf(new URL('/api/notes', app));
  await pause(gap);
  const oneNote = await responseOf(new URL(`/api/notes/${sampleId}`, app));
  await pause(gap);
  return [
    { attackId: 'anonymous_note_read', expected: '공개 data.json이 없어 404',
      observed: describe(dataJson) },
    { attackId: 'anonymous_note_list', expected: '로그인 없는 메모 목록 요청은 401',
      observed: describe(noteList) },
    { attackId: 'anonymous_other_note_read', expected: '로그인 없는 메모 한 건 요청은 401',
      observed: describe(oneNote) },
  ];
}
