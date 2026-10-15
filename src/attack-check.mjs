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
async function responseOf(url) {
  try {
    const response = await fetch(url, {
      redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(10000),
    });
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

// 12단계 심판 「실행 기록 대조」: 요청이 끝나지 않아(네트워크 차단·시간 초과 등) 받은 HTTP 상태가 없으면
// 결과를 짐작하지 않고 정해진 미실행 표시 'not_run'만 적습니다. 상태를 받았으면 그 상태를 그대로 적습니다.
// 12단계 심판 「실행 기록 대조」: observed에는 실제로 받은 HTTP 상태만 적습니다(예: "HTTP 404").
// 기대와 같은지 다른지, 요청 ID 같은 다른 글은 붙이지 않습니다. 응답을 받지 못했으면 'not_run'.
const describe = (res) => (res ? `HTTP ${res.status}` : 'not_run');

// 허용하는 배포 주소: 이 저장소 프로젝트의 커밋별 Vercel 배포 주소(<저장소 이름>-<배포 해시>-<팀>.vercel.app)
// 또는 aleph.config.json에 적힌 주소와 같은 호스트. 그 밖의 호스트는 받지 않습니다.
const repoSlug = (config) => String(config.repoUrl ?? '').toLowerCase().replace(/\/+$/u, '').split('/').pop() ?? '';
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
function allowedDeployHost(config, app, hostname) {
  if (hostname === app.hostname) return true;
  const slug = repoSlug(config);
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/u.test(slug)) return false;
  return new RegExp(`^${escapeRe(slug)}-[a-z0-9]{6,32}-[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.vercel\\.app$`, 'u').test(hostname);
}
const sameRepo = (a, b) => typeof a === 'string' && typeof b === 'string'
  && a.toLowerCase().replace(/\/+$/u, '') === b.toLowerCase().replace(/\/+$/u, '');

export async function deploymentTarget(config, app) {
  try {
    const response = await fetch(new URL('/aleph.json', app), {
      redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return app;
    const identity = await response.json();
    const url = new URL(identity?.publicAppUrl);
    if (identity?.schema !== 'aleph.defense.deployment.v1' || !sameRepo(identity.repoUrl, config.repoUrl)
        || url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password
        || !allowedDeployHost(config, app, url.hostname)) return app;
    return url;
  } catch {
    return app;
  }
}

export async function runAttackChecks(config) {
  const app = deployedApp(config);
  if (config.step === 1) return firstStageCheck(config, app);
  if (!Number.isInteger(config.step) || config.step < 1 || config.step > 12) {
    throw new Error('aleph.config.json의 step을 확인해 주세요.');
  }

  // 12단계: 점검 대상은 심판이 확인하는 그 배포(빌드가 만든 /aleph.json의 publicAppUrl, 커밋마다 고유 주소)입니다.
  // aleph.config.json의 publicAppUrl은 시작 틀 README가 말하는 "이전 방식의 자리표시자"라 고정 별칭일 수 있습니다.
  // 같은 저장소의 배포 확인 파일일 때만 그 주소를 쓰고, 아니면 설정 주소를 그대로 씁니다.
  const target = await deploymentTarget(config, app);
  // 점검마다 요청 하나씩, 차례대로 보냅니다(같은 순간에 섞여 들어가지 않게).
  const sampleId = '00000000-0000-4000-8000-000000000001';
  const dataJson = await responseOf(new URL('/data.json', target));
  const noteList = await responseOf(new URL('/api/notes', target));
  const oneNote = await responseOf(new URL(`/api/notes/${sampleId}`, target));
  return [
    { attackId: 'anonymous_note_read', expected: '공개 data.json이 없어 404',
      observed: describe(dataJson) },
    { attackId: 'anonymous_note_list', expected: '로그인 없는 메모 목록 요청은 401',
      observed: describe(noteList) },
    { attackId: 'anonymous_other_note_read', expected: '로그인 없는 메모 한 건 요청은 401',
      observed: describe(oneNote) },
  ];
}
