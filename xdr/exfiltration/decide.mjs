// XDR 보너스 exfiltration · 경보 한 건을 block / alert / record 로 나눕니다.
// 아래 PATTERNS 는 xdr/exfiltration/patterns.json 의 패턴 세 개를 그대로 옮겨 적은 것입니다.
// 이 파일은 import·파일 읽기/쓰기·네트워크 없이 decide(alert) 안에서만 계산합니다. 경보 원본은 고치지 않습니다.
//
// 판정 순서
//   1. 유출 기법 표시(T1041·T1048)가 없으면 → record (메모·공지 읽기, 새로고침, 로그아웃 등)
//   2. 낮은 수준(3 이하)의 작은 전송(1MB 미만)이고 위험 신호가 없으면 → record (수업 자료 주소 동기화 등)
//   3. 대용량 전송(50MB 이상) + 패턴 표기 + 뚜렷한 위험 신호 + 높은 수준(10 이상) → block
//   4. 그 밖의 유출 기법 경보 → alert (중간 크기 한 건, 처음 보는 주소의 작은 파일, 실패한 전송 등)
// 위험 신호는 원문·전송량에 분명히 있는 것만 셉니다. '외부 전송은 아직 없습니다'처럼 스스로 부정한 것은 세지 않습니다.
//
// 확신도(confidence) = 경보가 패턴과 얼마나 뚜렷하게 맞는지(0~1).
//   0.85 이상 → block · 0.5 이상 → alert · 그 아래 → record

const PATTERNS = Object.freeze([
  Object.freeze({
    id: 'ex.large_to_new_destination',
    name: '처음 보는 목적지로 대용량 전송',
    technique: 'T1048',
    condition: '처음 보거나 평소 쓰지 않던 목적지·포트로 큰 전송량(data.bytes)이나 많은 파일(data.files)이 나간다. 평소 목적지·수업 자료 주소로 가는 작은 전송은 해당하지 않는다.',
    evidence: 'T1048 Exfiltration Over Alternative Protocol: 공격자는 기존 명령 통로와 다른 프로토콜·목적지로 자료를 빼낸다 (https://attack.mitre.org/techniques/T1048/).',
  }),
  Object.freeze({
    id: 'ex.archive_off_hours',
    name: '업무 시간 밖 압축 파일 반출',
    technique: 'T1048',
    condition: '압축 파일이 업무·수업 시간 밖이나 처음 보는 주소로 크게 나간다. 압축 파일을 만들기만 하고 외부 전송이 없으면 해당하지 않는다.',
    evidence: 'T1048 Exfiltration Over Alternative Protocol: 빼낸 자료를 묶어 평소와 다른 경로로 내보내는 반출 형태다 (https://attack.mitre.org/techniques/T1048/).',
  }),
  Object.freeze({
    id: 'ex.repeated_over_c2',
    name: '명령 통로로 반복되는 대용량 전송',
    technique: 'T1041',
    condition: '같은 목적지나 명령 통로로 큰 전송이 짧은 시간에 여러 번 반복되거나, 자료실 전체처럼 많은 자료가 한 번에 외부로 복사된다.',
    evidence: 'T1041 Exfiltration Over C2 Channel: 공격자는 이미 쓰고 있는 명령·제어 통로로 훔친 자료를 빼낸다 (https://attack.mitre.org/techniques/T1041/).',
  }),
]);

const [NEW_DESTINATION, ARCHIVE_OUT, REPEATED] = PATTERNS;

const BLOCK_AT = 0.85;
const ALERT_AT = 0.5;
const BLOCK_MIN_LEVEL = 10;
const QUIET_MAX_LEVEL = 3;
const LARGE_BYTES = 50 * 1000 * 1000;  // 이 이상이면 대용량 전송
const SMALL_BYTES = 1000 * 1000;       // 이 미만이면 작은 전송
const MANY_FILES = 50;                 // 한 번에 이 이상이면 많은 파일
const REPEAT_COUNT = 3;                // 이 이상 반복이면 반복 전송

const EXFIL_TAGS = /^T(1041|1048)(\.\d{3})?$/u;

const round2 = (value) => Math.round(value * 100) / 100;

function toCount(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  if (typeof value === 'string' && /^\d{1,15}$/u.test(value.trim())) return Number(value.trim());
  return 0;
}
const megabytes = (bytes) => (bytes >= 1000 * 1000 ? `${Math.round(bytes / 1000 / 1000)}MB` : `${Math.round(bytes / 1000)}KB`);

// 원문·숫자에서 패턴 표기를 찾습니다.
function matchedPatterns(description, count) {
  const found = [];
  if (/처음 보는|처음 봅|평소에 쓰지 않던|외부 주소/u.test(description)) found.push(NEW_DESTINATION);
  if (/압축 파일/u.test(description) && !/외부 전송은 아직 없/u.test(description)) found.push(ARCHIVE_OUT);
  if (count >= REPEAT_COUNT || /반복|자료실 전체|명령 통로/u.test(description)) found.push(REPEATED);
  return found;
}

// 원문·숫자에 분명히 있는 위험 신호만 셉니다.
function riskSignals(description, bytes, files, count) {
  const signals = [];
  if (/처음 보는|처음 봅/u.test(description)) signals.push('처음 보는 목적지');
  if (/평소에 쓰지 않던 포트/u.test(description)) signals.push('평소에 쓰지 않던 포트');
  if (/(수업|업무) 시간 밖/u.test(description)) signals.push('업무 시간 밖');
  if (/압축 파일/u.test(description) && !/외부 전송은 아직 없/u.test(description)) signals.push('압축 파일');
  if (/자료실 전체/u.test(description)) signals.push('자료실 전체 복사');
  if (/목적지 두 곳/u.test(description)) signals.push('목적지 두 곳');
  if (count >= REPEAT_COUNT) signals.push(`${count}번 반복`);
  if (files >= MANY_FILES) signals.push(`파일 ${files}건`);
  if (bytes >= LARGE_BYTES) signals.push(`${megabytes(bytes)} 전송`);
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
  const bytes = toCount(data.bytes);
  const files = toCount(data.files);
  const count = toCount(data.count);

  // 1. 유출 기법 표시가 없음
  if (!mitre.some((id) => EXFIL_TAGS.test(id))) {
    return { action: 'record', confidence: 0.05, reason: `정상 활동: 유출 기법 표시 없음, 수준 ${level}` };
  }

  const found = matchedPatterns(description, count);
  const signals = riskSignals(description, bytes, files, count);
  // 전송량 자체를 뺀 원문 위험 신호(대용량만으로는 막지 않음)
  const textSignals = signals.filter((s) => !s.endsWith(' 전송'));

  // 2. 낮은 수준의 작은 전송
  if (level <= QUIET_MAX_LEVEL && bytes < SMALL_BYTES && textSignals.length === 0) {
    return { action: 'record', confidence: 0.15, reason: `정상 활동: 작은 전송(${bytes}바이트), 위험 신호 없음, 수준 ${level}` };
  }

  // 3. 명확한 유출
  if (bytes >= LARGE_BYTES && found.length && textSignals.length && level >= BLOCK_MIN_LEVEL) {
    const confidence = round2(Math.min(0.98, BLOCK_AT + 0.01 + 0.02 * (textSignals.length - 1) + 0.01 * (level - BLOCK_MIN_LEVEL)));
    return {
      action: 'block',
      confidence,
      reason: `${found.map((p) => `${p.name}(${p.technique})`).join(' + ')}: ${signals.join(', ')}, 수준 ${level}`,
    };
  }

  // 4. 애매한 시도
  const confidence = round2(Math.min(0.8, ALERT_AT + 0.03 * Math.max(0, level - 4) + 0.03 * textSignals.length));
  const head = found.length
    ? `${found.map((p) => p.name).join(' + ')} 의심`
    : '대용량·반출 표기가 없는 유출 기법 경보';
  return {
    action: 'alert',
    confidence,
    reason: `${head}: 전송 ${megabytes(bytes)}, 위험 신호 ${textSignals.length ? textSignals.join(', ') : '없음'}, 수준 ${level} — 막기 기준 미달`,
  };
}
