// XDR 보너스 privilege · 경보 한 건을 block / alert / record 로 나눕니다.
// 아래 PATTERNS 는 xdr/privilege/patterns.json 의 패턴 세 개를 그대로 옮겨 적은 것입니다.
// 이 파일은 import·파일 읽기/쓰기·네트워크 없이 decide(alert) 안에서만 계산합니다. 경보 원본은 고치지 않습니다.
//
// 판정 순서
//   1. 권한 기법 표시(T1068·T1078)가 없으면 → record (로그인·로그아웃·조회 등)
//   2. 권한 장치(관리자 그룹 추가 / 관리자 명령 실행·권한 전환) + 뚜렷한 위험 신호 + 높은 수준(10 이상) → block
//   3. 그 밖의 권한 기법 경보 → alert (취소된 권한 상승 창, 관리자 그룹이 아닌 그룹, 평소 주소의 명령 한 번 등)
// 위험 신호와 장치는 원문에 분명히 적힌 것만 셉니다. '관리자 그룹은 아닙니다'처럼 스스로 부정한 것은 세지 않습니다.
//
// 확신도(confidence) = 경보가 패턴과 얼마나 뚜렷하게 맞는지(0~1).
//   0.85 이상 → block · 0.5 이상 → alert · 그 아래 → record

const PATTERNS = Object.freeze([
  Object.freeze({
    id: 'pv.admin_group_add',
    name: '평범한 계정의 관리자 그룹 추가',
    technique: 'T1078',
    condition: '평범한 계정이 관리자 그룹(administrators)에 추가되거나, 빠졌던 계정이 곧바로 다시 들어오거나, 한 주소에서 여러 계정이 관리자 그룹에 추가된다. 관리자 그룹이 아닌 과제·수업 그룹은 해당하지 않는다.',
    evidence: 'T1078 Valid Accounts: 공격자는 정상 계정의 자격 증명을 얻어 쓰며, 이를 권한 상승에도 이용한다 (https://attack.mitre.org/techniques/T1078/).',
  }),
  Object.freeze({
    id: 'pv.unfamiliar_admin_command',
    name: '갑자기 얻은 권한으로 실행한 처음 보는 관리자 명령',
    technique: 'T1068',
    condition: '방금 관리자가 된 계정이나 다른 계정의 권한, 처음 보는 주소에서 관리자 명령을 실행하거나, 세션이 관리자 권한으로 바뀐다. 취소되거나 실패한 한 번의 시도는 해당하지 않는다.',
    evidence: 'T1068 Exploitation for Privilege Escalation: 공격자는 약점을 악용해 권한을 높인 뒤 높은 권한으로 명령을 실행한다 (https://attack.mitre.org/techniques/T1068/).',
  }),
  Object.freeze({
    id: 'pv.off_hours_privilege_use',
    name: '업무 시간 밖 권한 사용',
    technique: 'T1078',
    condition: '수업·업무 시간 밖이나 업무처럼 보이지 않는 시각에 관리자 그룹 추가나 관리자 명령이 일어난다.',
    evidence: 'T1078 Valid Accounts 탐지 안내: 계정이 평소와 다른 시각·위치에서 쓰이는 비정상 접근을 살핀다 (https://attack.mitre.org/techniques/T1078/).',
  }),
]);

const [GROUP_ADD, ADMIN_COMMAND, OFF_HOURS] = PATTERNS;

const BLOCK_AT = 0.85;
const ALERT_AT = 0.5;
const BLOCK_MIN_LEVEL = 10;

const PRIVILEGE_TAGS = /^T(1068|1078)(\.\d{3})?$/u;
const ADMIN_GROUP = /^administrators$/iu;

const round2 = (value) => Math.round(value * 100) / 100;

function toCount(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  if (typeof value === 'string' && /^\d{1,6}$/u.test(value.trim())) return Number(value.trim());
  return 0;
}

// 원문에서 권한 장치(패턴)를 찾습니다.
function matchedPatterns(description, group) {
  const found = [];
  const notAdminGroup = /관리자 그룹은 아닙/u.test(description);
  if (!notAdminGroup && (ADMIN_GROUP.test(group) || /관리자 그룹에 (추가|들어)|관리자로 들어/u.test(description))) found.push(GROUP_ADD);
  if (/관리자 명령을 실행했|권한 명령을 실행했|관리자 권한으로 바뀌|다른 계정의 권한으로|그룹 추가와 명령 실행이 같이/u.test(description)) found.push(ADMIN_COMMAND);
  if (/(수업|업무) 시간 밖|업무처럼 보이지 않는 시각/u.test(description)) found.push(OFF_HOURS);
  return found;
}

// 원문에 분명히 적힌 위험 신호만 셉니다.
function riskSignals(description, count, found) {
  const signals = [];
  if (/원격 주소/u.test(description)) signals.push('원격 주소');
  if (/처음 보는|처음 봅니다/u.test(description)) signals.push('처음 보는 주소');
  if (/방금 관리자가 된|곧바로/u.test(description)) signals.push('권한을 얻자마자 명령 실행');
  if (/다른 계정의 권한/u.test(description)) signals.push('다른 계정의 권한 사용');
  if (/평범한 계정/u.test(description)) signals.push('평범한 계정');
  if (/빠진 계정이[^.]*다시/u.test(description)) signals.push('빠진 뒤 곧바로 다시 추가');
  if (count >= 2) signals.push(`${count}건`);
  if (found.includes(OFF_HOURS)) signals.push('업무 시간 밖');
  if (found.includes(GROUP_ADD) && found.includes(ADMIN_COMMAND)) signals.push('그룹 추가와 명령 실행이 함께');
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
  const group = typeof data.group === 'string' ? data.group : '';
  const count = toCount(data.count);

  // 1. 권한 기법 표시가 없음
  if (!mitre.some((id) => PRIVILEGE_TAGS.test(id))) {
    return { action: 'record', confidence: 0.05, reason: `정상 활동: 권한 기법 표시 없음, 수준 ${level}` };
  }

  const found = matchedPatterns(description, group);
  const signals = riskSignals(description, count, found);
  const mechanism = found.filter((p) => p !== OFF_HOURS);

  // 2. 명확한 권한 상승
  if (mechanism.length && signals.length && level >= BLOCK_MIN_LEVEL) {
    const confidence = round2(Math.min(0.98, BLOCK_AT + 0.01 + 0.03 * (signals.length - 1) + 0.01 * (level - BLOCK_MIN_LEVEL)));
    return {
      action: 'block',
      confidence,
      reason: `${found.map((p) => `${p.name}(${p.technique})`).join(' + ')}: ${signals.join(', ')}, 수준 ${level}`,
    };
  }

  // 3. 애매한 시도
  const confidence = round2(Math.min(0.8, ALERT_AT + 0.03 * Math.max(0, level - 4) + 0.04 * signals.length + (mechanism.length ? 0.02 : 0)));
  const head = found.length
    ? `${found.map((p) => p.name).join(' + ')} 의심`
    : '권한 장치가 확인되지 않은 권한 기법 경보';
  return {
    action: 'alert',
    confidence,
    reason: `${head}: 위험 신호 ${signals.length ? signals.join(', ') : '없음'}, 수준 ${level} — 막기 기준 미달`,
  };
}
