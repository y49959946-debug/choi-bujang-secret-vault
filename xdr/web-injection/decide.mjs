// XDR 보너스 web-injection · 경보 한 건을 block / alert / record 로 나눕니다.
// 경보 원본은 읽기만 하고 고치지 않습니다. import·파일 읽기/쓰기·네트워크 없이 이 함수 안에서만 계산합니다.
// 막을지 알릴지를 가르는 기준 숫자는 이 파일에만 둡니다(patterns.json 에는 공격 형태만 있습니다).
//
// 판정 순서
//   1. T1190 표시도 없고 요청도 1건 이하 → record (평소 조회·화면 열기·로그아웃 등)
//   2. 높은 경보 수준 + 아래 패턴 표기 + 같은 표기 반복 → block (명확한 공격)
//   3. 그 밖의 T1190 경보 → alert (한 번뿐인 따옴표·수업 이름처럼 애매한 요청)
// 셋 중 하나라도 빠지면 막지 않고 알리기만 합니다. 정상 사용자를 막는 것보다 한 번 더 보는 쪽을 고릅니다.
//
// 확신도(confidence)는 "공격 패턴과 얼마나 뚜렷하게 맞는지"입니다.
//   block 0.85 이상 · alert 0.5 이상 0.85 미만 · record 0.5 미만
// 반복 횟수·수준이 높을수록 같은 구간 안에서 조금씩 높아집니다.
// 이유에는 패턴 이름과 경보에 있는 숫자(건수·수준)만 적고, 원문에 없는 말은 덧붙이지 않습니다.

// patterns.json 의 패턴 네 개와 이름·근거를 옮겨 적은 것입니다.
// match 는 경보 설명(rule.description)에서 그 패턴의 표기를 알아보는 말입니다.
// 네 패턴 모두 같은 기준(높은 수준 + 반복)을 넘을 때만 막고, 어느 패턴에도 맞지 않는 형태는 alert 로만 올립니다.
const PATTERNS = Object.freeze([
  {
    id: 'wi.sql_in_request',
    name: '요청 인자 안의 SQL 구문',
    technique: 'T1190',
    weakness: 'CWE-89',
    match: /SQL\s*(구문|표기|표식)|데이터베이스 조회를 이어 붙이는/u,
    evidence: 'T1190 사례: 공개 웹·DB 서버를 노린 SQL 주입 (https://attack.mitre.org/techniques/T1190/), CWE-89 (https://cwe.mitre.org/data/definitions/89.html)',
  },
  {
    id: 'wi.script_tag_in_request',
    name: '요청 인자 안의 스크립트 태그',
    technique: 'T1190',
    weakness: 'CWE-79',
    match: /스크립트\s*(삽입|표식|표기)/u,
    evidence: 'T1190 탐지: 접근 로그의 공격형 입력 (https://attack.mitre.org/techniques/T1190/), CWE-79 (https://cwe.mitre.org/data/definitions/79.html)',
  },
  {
    id: 'wi.path_traversal_repeat',
    name: '경로 거슬러 올라가기(../) 반복',
    technique: 'T1190',
    weakness: 'CWE-22',
    match: /거슬러 올라가는 표기|경로 이탈 표기/u,
    evidence: 'T1190 사례: 초기 접근을 위한 디렉터리 이동 취약점 악용 (https://attack.mitre.org/techniques/T1190/), CWE-22 (https://cwe.mitre.org/data/definitions/22.html)',
  },
  {
    id: 'wi.command_separator_in_request',
    name: '요청 인자 안의 명령 구분자',
    technique: 'T1190',
    weakness: 'CWE-78',
    match: /명령 구분자 표기/u,
    evidence: 'T1190 탐지 안내: 접근 로그의 공격형 입력 (https://attack.mitre.org/techniques/T1190/), CWE-78 (https://cwe.mitre.org/data/definitions/78.html)',
  },
]);

const BLOCK_MIN_LEVEL = 10;    // 이 수준 이상이어야 막기 후보가 됩니다.
const BLOCK_MIN_REPEATS = 5;   // 같은 표기가 이 횟수 이상 들어와야 막기 후보가 됩니다.
const NORMAL_MAX_REQUESTS = 1; // T1190 표시가 없고 요청이 이 건수 이하이면 정상으로 봅니다.

// 확신도 구간
const BLOCK_MIN = 0.86;
const BLOCK_MAX = 0.98;
const ALERT_MIN = 0.5;
const ALERT_MAX = 0.8;
const RECORD_CONFIDENCE = 0.05;

// 원문이 스스로 "공격 표기가 아니다"라고 밝힌 경보는 알리되 확신도를 낮춥니다.
const SAYS_NOT_ATTACK = /표식은 아닙니다|공격 표기는 없습니다/u;

const round2 = (value) => Math.round(value * 100) / 100;
const scale = (value, from, to, min, max) => {
  const ratio = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return round2(min + (max - min) * ratio);
};

function toCount(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  if (typeof value === 'string' && /^\d{1,6}$/u.test(value.trim())) return Number(value.trim());
  return 0;
}

const label = (p) => `${p.name}(${p.technique}, ${p.weakness})`;

export function decide(alert) {
  if (!alert || typeof alert !== 'object' || Array.isArray(alert)) {
    return { action: 'record', confidence: 0, reason: '경보 형식이 아니어서 기록만 합니다' };
  }

  const rule = alert.rule && typeof alert.rule === 'object' ? alert.rule : {};
  const data = alert.data && typeof alert.data === 'object' ? alert.data : {};
  const level = Number.isFinite(Number(rule.level)) ? Number(rule.level) : 0;
  const mitre = Array.isArray(rule.mitre) ? rule.mitre : [];
  const description = typeof rule.description === 'string' ? rule.description : '';
  const t1190 = mitre.some((id) => id === 'T1190');
  const requests = toCount(data.count);
  const matched = PATTERNS.filter((p) => p.match.test(description));

  // 1. 정상 요청
  if (!t1190 && requests <= NORMAL_MAX_REQUESTS) {
    return {
      action: 'record',
      confidence: RECORD_CONFIDENCE,
      reason: `정상 요청: T1190 표시 없음, 수준 ${level}`,
    };
  }

  // 2. 명확한 공격: 높은 수준 + 패턴 표기 + 반복
  if (t1190 && matched.length && level >= BLOCK_MIN_LEVEL && requests >= BLOCK_MIN_REPEATS) {
    const extra = (matched.length - 1) * 2 + (level - BLOCK_MIN_LEVEL);
    return {
      action: 'block',
      confidence: scale(requests + extra, BLOCK_MIN_REPEATS, 20, BLOCK_MIN, BLOCK_MAX),
      reason: `${matched.map(label).join(' + ')}: 표기 ${requests}건, 수준 ${level}`,
    };
  }

  // 3. 애매한 요청
  const saysNot = SAYS_NOT_ATTACK.test(description);
  const confidence = saysNot
    ? ALERT_MIN
    : scale(level + Math.min(requests, 5), 5, 15, ALERT_MIN + 0.05, ALERT_MAX);
  const head = matched.length
    ? `${matched.map(label).join(' + ')} 의심`
    : '알려진 패턴과 맞지 않는 T1190 경보';
  return {
    action: 'alert',
    confidence,
    reason: `${head}: 요청 ${requests}건, 수준 ${level} — 막기 기준 미달`,
  };
}
