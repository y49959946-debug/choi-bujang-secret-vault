// 9단계에서 학생이 채우는 탐지 함수입니다. 이 기본값은 어떤 접속도 회수하지 않습니다.
// 반 엔진이 검증한 사건만 전달해야 하며, 브라우저가 보낸 사용자 번호는 받지 않습니다.
//
// 9단계 제작 1 · 입력 정리: 가상 사건에서 아래 다섯 값만 읽습니다.
//   시각(at) · 가명 사용자(subjectId, 연습 형식은 identity.sub) · 기기(deviceId) · 요청 종류(method) · 판정(decision)
// 메모 내용·토큰·실명 등 그 밖의 칸은 읽지도, 저장하지도, 출력하지도 않습니다.
// 사건 객체 자신이 가진 값만 읽습니다(상속·프로토타입으로 끼워 넣은 값은 무시).
// 이번 제작은 입력 처리만 바꾸며, 탐지 결과는 아직 언제나 observe입니다.

const SUBJECT = /^[\x21-\x7e]{1,256}$/u;      // 공백 없는 가명 ID
const DEVICE = /^[0-9a-f]{16}$/u;              // 엔진이 확인한 16자리 소문자 16진수 기기 ID
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const DECISIONS = new Set(['allow', 'deny', 'step_up']);

const ownValue = (object, key) => (object !== null && typeof object === 'object' && !Array.isArray(object)
  && Object.hasOwn(object, key) ? object[key] : undefined);

// 사건 하나 → { atMs, subject, device, method, decision } 또는 null(읽을 수 없는 사건)
// device·decision은 사건에 없으면 null입니다. 시각·사용자·요청 종류가 없거나 모양이 틀리면 그 사건은 버립니다.
export function readDetectionEvent(event) {
  const at = ownValue(event, 'at');
  const atMs = typeof at === 'string' ? Date.parse(at) : Number.NaN;
  if (!Number.isFinite(atMs)) return null;

  const rawSubject = ownValue(event, 'subjectId') ?? ownValue(ownValue(event, 'identity'), 'sub');
  if (typeof rawSubject !== 'string' || !SUBJECT.test(rawSubject)) return null;

  const method = ownValue(event, 'method');
  if (typeof method !== 'string' || !METHODS.has(method)) return null;

  const rawDevice = ownValue(event, 'deviceId');
  const rawDecision = ownValue(event, 'decision');
  return Object.freeze({
    atMs,
    subject: rawSubject,
    device: typeof rawDevice === 'string' && DEVICE.test(rawDevice) ? rawDevice : null,
    method,
    decision: typeof rawDecision === 'string' && DECISIONS.has(rawDecision) ? rawDecision : null,
  });
}

// 사건 배열 → 읽을 수 있는 사건만 시각 순으로 정리한 배열
export function readDetectionEvents(events) {
  if (!Array.isArray(events)) throw new TypeError('invalid_detection_events');
  return Object.freeze(events.map(readDetectionEvent).filter(Boolean).sort((a, b) => a.atMs - b.atMs));
}

export function detect(events) {
  readDetectionEvents(events); // 입력 정리만 합니다. 탐지 규칙은 다음 제작에서 추가합니다.
  return { action: 'observe' };
}
