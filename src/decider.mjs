// ALEPH SDP 엔진이 확인한 요청만 받는 학생 판정기 시작점입니다.
// 6단계부터 규칙을 하나씩 추가합니다. 이 기본 응답은 모든 요청을 거부합니다.
// 요청 본문의 userId, role, 기기 키, 토큰을 별도로 믿거나 저장하지 마세요.
//
// 6단계 device_registered: 엔진이 확인한 request.deviceRegistered가 true일 때만 자료실 읽기(GET)를 허용합니다.
// 미등록(false)이거나 값이 없으면 device_not_registered로 거부합니다.
// 계약(docs/DECIDER_REQUEST.md)에 있는 deviceRegistered·method만 읽고, request.device 같은 없는 값은 쓰지 않습니다.
// 읽기가 아닌 요청은 시작 틀의 starter.deny 규칙대로 거부합니다.
export const RULE_IDS = Object.freeze(['starter.deny', 'device_registered']);

const READ_METHODS = new Set(['GET']);

const respond = (request, decision, reasonCode, ruleIds) => ({
  schema: 'aleph.decision.v1',
  requestId: request?.requestId,
  decision,
  reasonCode,
  ruleIds,
});

// 7단계 입력 검사: 엔진이 넘긴 가상 접속 정보(signals·recentEvents)의 출처를 가립니다.
// - signals.source가 'judge_fixture'일 때만 엔진이 검증해 넘긴 심판 가상 사건으로 봅니다(신뢰 출처).
// - 'none'은 "접속 정보 없음"입니다. 실제 경로는 region/network가 'unknown'입니다.
// - 그 밖의 출처(브라우저·클라이언트 헤더 등)나 모양이 틀린 값은 신뢰하지 않습니다.
// 값이 없거나 출처가 불명확하면 null로 둡니다. 'local'·'usual' 같은 정상값으로 채우지 않습니다.
// 요청 객체 자신이 가진 값만 읽고, 계약에 없는 headers·geo·identity 같은 칸은 읽지 않습니다.
// 이번에는 입력을 가려 읽기만 하며, 이 결과로 판정을 바꾸는 규칙은 아직 없습니다.
const TRUSTED_SIGNAL_SOURCES = new Set(['judge_fixture']);
const SIGNAL_WORD = /^[a-z][a-z0-9_]{0,31}$/u;
const MAX_RECENT_EVENTS = 12;

const ownValue = (object, key) => (object !== null && typeof object === 'object' && !Array.isArray(object)
  && Object.hasOwn(object, key) ? object[key] : undefined);

const signalWord = (value) => (typeof value === 'string' && SIGNAL_WORD.test(value) && value !== 'unknown'
  ? value : null);

export function readAccessContext(request) {
  const signals = ownValue(request, 'signals');
  const rawSource = ownValue(signals, 'source');
  const source = TRUSTED_SIGNAL_SOURCES.has(rawSource) ? rawSource
    : rawSource === 'none' ? 'none' : 'untrusted';
  const trusted = source !== 'untrusted' && source !== 'none';

  const hourValue = ownValue(signals, 'hour');
  const hour = trusted && Number.isInteger(hourValue) && hourValue >= 0 && hourValue <= 23 ? hourValue : null;

  const rawEvents = ownValue(request, 'recentEvents');
  const recentEvents = Array.isArray(rawEvents) && rawEvents.length <= MAX_RECENT_EVENTS
    ? rawEvents.filter((event) => signalWord(ownValue(event, 'kind')) !== null
        && Number.isInteger(ownValue(event, 'ageSeconds')) && ownValue(event, 'ageSeconds') >= 0
        && Number.isInteger(ownValue(event, 'count')) && ownValue(event, 'count') >= 0)
      .map((event) => Object.freeze({ kind: event.kind, ageSeconds: event.ageSeconds, count: event.count }))
    : [];

  return Object.freeze({
    source,          // 'judge_fixture' | 'none' | 'untrusted'
    trusted,         // 엔진이 검증해 넘긴 가상 접속 정보일 때만 true
    region: trusted ? signalWord(ownValue(signals, 'region')) : null,
    network: trusted ? signalWord(ownValue(signals, 'network')) : null,
    hour,
    recentEvents: Object.freeze(recentEvents), // 엔진이 준 최근 사건(행동). 모양이 틀린 항목은 버립니다.
  });
}

export async function decide(request) {
  // 6단계: 등록된 기기가 아니면 다른 판단보다 먼저 거부합니다.
  // 요청 객체 자신이 가진 deviceRegistered만 믿습니다(상속·프로토타입으로 끼워 넣은 값은 무시).
  const registered = request !== null && typeof request === 'object'
    && Object.hasOwn(request, 'deviceRegistered') && request.deviceRegistered === true;
  if (!registered) {
    return respond(request, 'deny', 'device_not_registered', ['device_registered']);
  }

  // 등록 기기의 자료실 읽기만 허용합니다.
  if (READ_METHODS.has(request.method)) {
    return respond(request, 'allow', 'approved', ['device_registered']);
  }

  // 그 밖의 요청은 시작 틀 기본값대로 거부합니다.
  return respond(request, 'deny', 'starter_not_ready', [RULE_IDS[0]]);
}
