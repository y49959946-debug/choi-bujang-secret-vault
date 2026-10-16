// XDR 보너스 persistence · 경보 한 건을 block / alert / record 로 나눕니다.
// 아래 PATTERNS 는 xdr/persistence/patterns.json 의 패턴 세 개를 그대로 옮겨 적은 것입니다.
// 이 파일은 import·파일 읽기/쓰기·네트워크 없이 decide(alert) 안에서만 계산합니다. 경보 원본은 고치지 않습니다.
//
// 판정 순서
//   1. 지속성 기법 표시(T1543·T1053·T1547)가 없으면 → record (로그인·로그아웃·화면 열기 등)
//   2. 낮은 수준(3 이하)이고 '기존·서명된·평소 시각·그대로·읽기만'처럼 평소 상태를 말하며 위험 신호가 없으면 → record
//   3. 지속성 장치(새 서비스·서비스 실행 파일 변경 / 예약 작업 / 시작 폴더) + 뚜렷한 위험 신호 + 높은 수준(10 이상) → block
//   4. 그 밖의 지속성 표시 경보 → alert (수업 중 만든 작업, 서명 확인 전, 설명만 바뀜처럼 애매한 경우)
// 위험 신호는 원문에 분명히 적힌 것만 셉니다. '서명은 아직 모릅니다'는 '서명 없음'으로 보지 않습니다.
//
// 확신도(confidence) = 경보가 패턴과 얼마나 뚜렷하게 맞는지(0~1).
//   0.85 이상 → block · 0.5 이상 → alert · 그 아래 → record

const PATTERNS = Object.freeze([
  Object.freeze({
    id: 'ps.unsigned_new_service',
    name: '서명 없는 새 서비스 등록·서비스 실행 파일 변경',
    technique: 'T1543.003',
    condition: '평소 목록에 없는 서비스가 새로 등록되거나 서비스 실행 파일이 바뀌었고, 서명이 없거나 실행 파일이 임시 폴더(AppData\\Local\\Temp 등)에 있다.',
    evidence: 'T1543.003 Windows Service: 공격자는 지속성을 위해 Windows 서비스를 만들거나 바꿔 악성 실행 파일을 반복 실행한다 (https://attack.mitre.org/techniques/T1543/003/).',
  }),
  Object.freeze({
    id: 'ps.unfamiliar_scheduled_task',
    name: '낯선 예약 작업',
    technique: 'T1053.005',
    condition: '처음 보는 예약 작업이 임시 폴더의 프로그램을 실행하거나, 작업 이름이 임의 문자열이거나, 수업 시간 밖에 실행된다.',
    evidence: 'T1053.005 Scheduled Task: 공격자는 Windows 작업 스케줄러로 악성 코드를 처음 또는 반복 실행해 지속성을 얻는다 (https://attack.mitre.org/techniques/T1053/005/).',
  }),
  Object.freeze({
    id: 'ps.startup_folder_change',
    name: '시작 폴더 변경',
    technique: 'T1547.001',
    condition: '사용자 시작 폴더(Start Menu\\Programs\\Startup)나 시작 프로그램에 평소 목록에 없는 실행 파일이 추가됐거나, 예약 작업과 같은 임시 파일을 함께 가리킨다.',
    evidence: 'T1547.001 Registry Run Keys / Startup Folder: 공격자는 시작 폴더나 Run 키에 프로그램을 넣어 사용자가 로그인할 때마다 실행되게 한다 (https://attack.mitre.org/techniques/T1547/001/).',
  }),
]);

const [SERVICE, TASK, STARTUP] = PATTERNS;

const BLOCK_AT = 0.85;
const ALERT_AT = 0.5;
const BLOCK_MIN_LEVEL = 10;
const QUIET_MAX_LEVEL = 3;

const PERSISTENCE_TAGS = /^T(1543|1053|1547)(\.\d{3})?$/u;
const SAYS_USUAL = /기존|서명된|평소 시각|그대로|읽기만/u;
const TEMP_EXECUTABLE = /\\AppData\\Local\\Temp\\[^\\]+\.(exe|dll|scr|bat|cmd|ps1|vbs|js)$/iu;
const STARTUP_PATH = /\\Start Menu\\Programs\\Startup\\/iu;

const round2 = (value) => Math.round(value * 100) / 100;

function toCount(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  if (typeof value === 'string' && /^\d{1,6}$/u.test(value.trim())) return Number(value.trim());
  return 0;
}

// 원문(설명·경로)에서 지속성 장치를 찾습니다.
function mechanisms(description, path) {
  const found = [];
  const serviceChange = /서비스/u.test(description)
    && /새 서비스|서비스 등록|등록됐|실행 파일이 바뀌/u.test(description)
    && !/등록은 없/u.test(description);
  if (serviceChange) found.push(SERVICE);
  if (/예약 작업/u.test(description)) found.push(TASK);
  if (/시작 폴더|시작 프로그램|시작 항목/u.test(description) || STARTUP_PATH.test(path)) found.push(STARTUP);
  return found;
}

// 원문에 분명히 적힌 위험 신호만 셉니다.
function riskSignals(description, path, count, found) {
  const signals = [];
  if (/서명\s*(이\s*)?없/u.test(description)) signals.push('서명 없음');
  if (/처음 보는/u.test(description)) signals.push('처음 봄');
  if (/평소 목록에 없/u.test(description)) signals.push('평소 목록에 없음');
  if (/임의 문자열/u.test(description)) signals.push('임의 이름');
  if (/수업 시간 밖/u.test(description)) signals.push('수업 시간 밖 실행');
  if (TEMP_EXECUTABLE.test(path)) signals.push('임시 폴더 실행 파일');
  if (count >= 2) signals.push(`${count}건 반복`);
  if (found.includes(TASK) && found.includes(STARTUP)) signals.push('예약 작업과 시작 항목이 함께 가리킴');
  return signals;
}

export function decide(alert) {
  if (!alert || typeof alert !== 'object' || Array.isArray(alert)) {
    return { action: 'record', confidence: 0, reason: '경보 형식이 아니어서 기록만 합니다' };
  }
  const rule = alert.rule && typeof alert.rule === 'object' ? alert.rule : {};
  const data = alert.data && typeof alert.data === 'object' ? alert.data : {};
  const level = Number.isFinite(Number(rule.level)) ? Number(rule.level) : 0;
  const mitre = Array.isArray(rule.mitre) ? rule.mitre.filter((id) => typeof id === 'string') : [];
  const description = typeof rule.description === 'string' ? rule.description : '';
  const path = typeof data.path === 'string' ? data.path : '';
  const count = toCount(data.count);

  // 1. 지속성 기법 표시가 없음
  if (!mitre.some((id) => PERSISTENCE_TAGS.test(id))) {
    return { action: 'record', confidence: 0.05, reason: `정상 활동: 지속성 기법 표시 없음, 수준 ${level}` };
  }

  const found = mechanisms(description, path);
  const signals = riskSignals(description, path, count, found);

  // 2. 평소 상태를 말하는 낮은 수준 경보
  if (level <= QUIET_MAX_LEVEL && SAYS_USUAL.test(description) && signals.length === 0) {
    return { action: 'record', confidence: 0.15, reason: `정상 활동: 평소 상태의 서비스·예약 작업, 위험 신호 없음, 수준 ${level}` };
  }

  // 3. 명확한 공격
  if (found.length && signals.length && level >= BLOCK_MIN_LEVEL) {
    const confidence = round2(Math.min(0.98, BLOCK_AT + 0.01 + 0.03 * (signals.length - 1) + 0.01 * (level - BLOCK_MIN_LEVEL)));
    return {
      action: 'block',
      confidence,
      reason: `${found.map((p) => `${p.name}(${p.technique})`).join(' + ')}: ${signals.join(', ')}, 수준 ${level}`,
    };
  }

  // 4. 애매한 시도
  const confidence = round2(Math.min(0.8, ALERT_AT + 0.03 * Math.max(0, level - 4) + 0.04 * signals.length + (found.length ? 0.02 : 0)));
  const head = found.length
    ? `${found.map((p) => p.name).join(' + ')} 의심`
    : '지속성 장치가 확인되지 않은 지속성 기법 경보';
  return {
    action: 'alert',
    confidence,
    reason: `${head}: 위험 신호 ${signals.length ? signals.join(', ') : '없음'}, 수준 ${level} — 막기 기준 미달`,
  };
}
