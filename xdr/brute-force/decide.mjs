// XDR 보너스 brute-force · 경보 한 건을 block / alert / record 로 나눕니다.
// 경보 원본은 읽기만 하고 고치지 않습니다. import·파일 읽기/쓰기·네트워크 없이 이 함수 안에서만 계산합니다.
// 막을지 알릴지를 가르는 기준 숫자는 이 파일에만 둡니다(patterns.json 에는 공격 형태만 있습니다).
//
// 판정 순서
//   1. T1110 표시도 없고 실패도 1건 이하 → record (정상 로그인·로그아웃·세션 유지 등)
//   2. 높은 경보 수준과 아래 패턴 증거가 함께 있음 → block (명확한 공격)
//   3. 그 밖의 로그인 실패 → alert (오타·잠금 뒤 재시도처럼 애매한 시도)
// 증거가 하나뿐이면 막지 않고 알리기만 합니다. 정상 사용자를 막는 것보다 한 번 더 보는 쪽을 고릅니다.
//
// 확신도(confidence)는 "공격 패턴과 얼마나 뚜렷하게 맞는지"입니다.
//   block 0.85 이상 · alert 0.5 이상 0.85 미만 · record 0.5 미만
// 실패 건수·계정 수가 많을수록 같은 구간 안에서 조금씩 높아집니다.

// patterns.json 의 패턴 세 개와 이름·근거를 옮겨 적은 것입니다.
const PATTERNS = Object.freeze({
  rapid: {
    id: 'bf.rapid_failures_same_source',
    name: '같은 주소의 짧은 시간 로그인 실패 연속',
    technique: 'T1110',
    evidence: 'T1110: 반복적·순차적 방식으로 비밀번호를 체계적으로 추측한다 (https://attack.mitre.org/techniques/T1110/)',
  },
  guessing: {
    id: 'bf.password_guessing_same_account',
    name: '같은 주소·같은 계정에 대한 비밀번호 추측',
    technique: 'T1110.001',
    evidence: 'T1110.001: 같거나 비슷한 계정을 노린 인증 실패가 연이어 나타난다 (https://attack.mitre.org/techniques/T1110/001/)',
  },
  spraying: {
    id: 'bf.password_spraying_many_accounts',
    name: '여러 계정에 같은 비밀번호 대입',
    technique: 'T1110.003',
    evidence: 'T1110.003: 흔한 비밀번호 하나 또는 소수를 여러 계정에 넣는다 (https://attack.mitre.org/techniques/T1110/003/)',
  },
});

const BLOCK_MIN_LEVEL = 10;      // 이 수준 이상이어야 막기 후보가 됩니다.
const RAPID_MIN_FAILURES = 30;   // 짧은 시간 실패가 이 건수 이상이면 반복 추측으로 봅니다.
const SPRAY_MIN_ACCOUNTS = 5;    // 서로 다른 계정이 이 개수 이상이면 여러 계정 대상으로 봅니다.
const NORMAL_MAX_FAILURES = 1;   // 실패가 이 건수 이하이고 T1110 표시가 없으면 정상으로 봅니다.

// 확신도 구간
const BLOCK_MIN = 0.86;
const BLOCK_MAX = 0.98;
const ALERT_MIN = 0.5;
const ALERT_MAX = 0.8;
const RECORD_BASE = 0.05;

// 설명의 "두 계정"처럼 우리말 수를 읽습니다.
const KOREAN_NUMBERS = Object.freeze({
  한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10,
});

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

// data.accounts("user01,user02,…")와 설명의 "계정 N개"·"N개 계정"·"두 계정" 가운데 큰 값을 씁니다.
function accountCount(data, description) {
  let listed = 0;
  if (typeof data?.accounts === 'string') {
    listed = new Set(data.accounts.split(',').map((name) => name.trim()).filter(Boolean)).size;
  } else if (Array.isArray(data?.accounts)) {
    listed = new Set(data.accounts.filter((name) => typeof name === 'string' && name)).size;
  }
  const digits = /계정\s*(\d{1,4})\s*개|(\d{1,4})\s*개\s*계정/u.exec(description);
  const fromDigits = digits ? Number(digits[1] ?? digits[2]) : 0;
  const words = /(?:^|\s)(다섯|여섯|일곱|여덟|아홉|한|두|세|네|열)\s*계정/u.exec(description);
  const fromWords = words ? KOREAN_NUMBERS[words[1]] : 0;
  return Math.max(listed, fromDigits, fromWords);
}

export function decide(alert) {
  if (!alert || typeof alert !== 'object' || Array.isArray(alert)) {
    return { action: 'record', confidence: 0, reason: '경보 형식이 아니어서 기록만 합니다' };
  }

  const rule = alert.rule && typeof alert.rule === 'object' ? alert.rule : {};
  const data = alert.data && typeof alert.data === 'object' ? alert.data : {};
  const level = Number.isFinite(Number(rule.level)) ? Number(rule.level) : 0;
  const mitre = Array.isArray(rule.mitre) ? rule.mitre : [];
  const description = typeof rule.description === 'string' ? rule.description : '';
  const t1110 = mitre.some((id) => typeof id === 'string' && id.startsWith('T1110'));
  const failures = toCount(data.count);
  const accounts = accountCount(data, description);
  const samePassword = /같은 비밀번호/u.test(description);
  const manyAccountsSaid = /여러 계정/u.test(description);
  // 한 계정을 노렸거나 비밀번호를 바꿔 가며 넣었다는 말이 있을 때만 '비밀번호 추측'으로 부릅니다.
  const oneAccountGuess = /같은 계정|한 계정|비밀번호를[^.]*바꿔/u.test(description);

  // 1. 정상 활동
  if (!t1110 && failures <= NORMAL_MAX_FAILURES) {
    return {
      action: 'record',
      confidence: round2(RECORD_BASE + failures * 0.1),
      reason: `정상 활동: T1110 표시 없음, 로그인 실패 ${failures}건`,
    };
  }

  // 2. 명확한 공격: 높은 수준 + 패턴 증거
  if (t1110 && level >= BLOCK_MIN_LEVEL) {
    if (accounts >= SPRAY_MIN_ACCOUNTS || (manyAccountsSaid && samePassword)) {
      const p = PATTERNS.spraying;
      const shown = accounts || '여러';
      const fact = samePassword
        ? `계정 ${shown}개에 같은 비밀번호 대입`
        : `계정 ${shown}개 대상 로그인 실패`;
      return {
        action: 'block',
        confidence: scale(Math.max(accounts, SPRAY_MIN_ACCOUNTS) + (samePassword ? 3 : 0),
          SPRAY_MIN_ACCOUNTS, 20, BLOCK_MIN, BLOCK_MAX),
        reason: `${p.name}(${p.technique}): ${fact}, 수준 ${level}`,
      };
    }
    if (failures >= RAPID_MIN_FAILURES) {
      const p = oneAccountGuess ? PATTERNS.guessing : PATTERNS.rapid;
      return {
        action: 'block',
        confidence: scale(failures, RAPID_MIN_FAILURES, 90, BLOCK_MIN, BLOCK_MAX),
        reason: `${p.name}(${p.technique}): 로그인 실패 ${failures}건, 수준 ${level}`,
      };
    }
  }

  // 3. 애매한 시도
  const p = accounts >= 2 ? PATTERNS.spraying : PATTERNS.rapid;
  const accountText = accounts >= 2 ? `계정 ${accounts}개, ` : '';
  return {
    action: 'alert',
    confidence: scale(Math.max(failures, accounts * 2) + Math.max(0, level - 5),
      0, 15, ALERT_MIN, ALERT_MAX),
    reason: `${p.name} 의심(${p.technique}): ${accountText}로그인 실패 ${failures}건, 수준 ${level} — 막기 기준 미달`,
  };
}
