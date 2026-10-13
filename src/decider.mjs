// ALEPH SDP 엔진이 확인한 요청만 받는 학생 판정기 시작점입니다.
// 6단계부터 규칙을 하나씩 추가합니다. 이 기본 응답은 모든 요청을 거부합니다.
// 요청 본문의 userId, role, 기기 키, 토큰을 별도로 믿거나 저장하지 마세요.
//
// 규칙 순서 (계약 docs/DECIDER_REQUEST.md에 있는 값만 읽습니다. request.device·role 같은 없는 값은 쓰지 않습니다.)
// 6단계 device_registered: request.deviceRegistered가 true가 아니면 가장 먼저 device_not_registered로 거부합니다.
// 8단계 resource_zones: 엔진이 확인한 deviceId·subjectId·method·path·route가 맞는 구역 경로만 들입니다.
//   owner_notes_zone(내 메모 다섯 경로)만 허용하고, class_notices_zone(강사 공지 구역)·알 수 없는 경로는 거부합니다.
// 7단계 step_up_required: 허용될 요청이라도 복합 이상 접속이면, 방금 다시 확인한 경우가 아닌 한 추가 확인을 요청합니다.
// 그 밖의 요청은 시작 틀의 starter.deny 규칙대로 거부합니다.
export const RULE_IDS = Object.freeze([
  'starter.deny', 'device_registered', 'step_up_required',
  'resource_zones', 'owner_notes_zone', 'class_notices_zone',
]);


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
// 이 결과는 아래 step_up_required 규칙이 씁니다.
// recentEvents가 계약 한도(12개)를 넘어도 버리거나 자르지 않고 모양이 맞는 사건을 모두 셉니다.
// (사건을 많이 넣거나 앞에 빈 사건을 채워 대량 읽기를 숨기지 못하게 합니다.)
const TRUSTED_SIGNAL_SOURCES = new Set(['judge_fixture']);
const SIGNAL_WORD = /^[a-z][a-z0-9_]{0,31}$/u;

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
  const recentEvents = Array.isArray(rawEvents)
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

// 7단계 step_up_required: 평소와 다른 시각 + 처음 보는 네트워크 + 짧은 시간 많은 자료 읽기가
// 엔진이 검증한 가상 사건(신뢰 출처)에서 세 가지 모두 겹칠 때만 추가 확인(step_up)을 요청합니다.
// - 지역(region)은 근거로 쓰지 않습니다. 지역 하나로 거부하거나 영구 차단하지 않습니다.
// - 거부(deny)가 아니라 추가 확인이므로, 다시 로그인해 확인되면 허용으로 돌아옵니다.
// - 사유는 응답의 reasonCode(step_up_required)와 ruleIds(step_up_required)에 남깁니다.
// - 출처가 불명확하거나 값이 없으면 그 조건은 '겹침'으로 세지 않습니다(정상값으로 채우지도 않습니다).
const UNUSUAL_HOUR = (hour) => hour !== null && hour >= 0 && hour < 6; // 새벽 0~5시
const UNUSUAL_NETWORKS = new Set(['unusual', 'new', 'first_seen']);
const BURST_WINDOW_SECONDS = 600; // 최근 10분
const BURST_MIN_COUNT = 10;       // 이 건수 이상이면 '갑자기 많이 읽음'
const STEP_UP_FRESH_SECONDS = 300; // 엔진이 확인한 재로그인이 5분 안이면 확인된 것으로 봅니다.

function unusualAccess(context) {
  if (!context.trusted) return false;
  const burst = context.recentEvents
    .filter((event) => event.ageSeconds <= BURST_WINDOW_SECONDS)
    .reduce((sum, event) => sum + event.count, 0) >= BURST_MIN_COUNT;
  return UNUSUAL_HOUR(context.hour) && UNUSUAL_NETWORKS.has(context.network) && burst;
}

function freshlyVerified(request) {
  const stepUp = ownValue(request, 'stepUp');
  const age = ownValue(stepUp, 'authAgeSeconds');
  return ownValue(stepUp, 'verified') === true && Number.isInteger(age)
    && age >= 0 && age <= STEP_UP_FRESH_SECONDS;
}

// 8단계 구역 규칙: 엔진이 확인한 method·path·route와 쿼리 길이만으로 자원 구역을 정합니다.
// (src/resources.mjs와 같은 규칙입니다. 엔진이 이 파일 하나만 불러와도 동작하도록 import하지 않고 옮겨 적었습니다.)
// - 허용하는 경로는 아래 표뿐이며, path와 route가 서로 맞아야 합니다. 표에 없거나 어긋나면 거부합니다.
// - 기능은 쿼리로 고르지 않습니다. 쿼리가 붙은 요청(queryLength > 0)은 거부합니다.
// - 경로의 마지막 칸은 자료 ID뿐입니다. :id와 같은 깊이에 export 같은 기능 경로를 두지 않으므로,
//   /notes/export 같은 요청도 기능이 아니라 'export'라는 ID의 메모 한 건으로만 다뤄집니다.
// - 계약에 역할(role) 칸이 없으므로 모든 주체를 일반 학생으로 봅니다. 학생은 자기 메모 구역만 쓰고,
//   강사 공지 구역은 읽기·수정 모두 거부합니다(저장된 강사 권한과 공지 API가 아직 없습니다).
// - 계약에 메모 주인 칸이 없어, "B가 A의 메모"인지는 판정기가 알 수 없습니다. 그 거부는 자료 API(api/notes.js)의
//   owner_id 검사가 맡고, 판정기는 구역·동작·경로를 막습니다.
const ITEM_ID = /^[A-Za-z0-9_-]{1,64}$/u;
// 엔진이 확인한 주체·기기: subjectId는 공백 없는 가명 ID, deviceId는 16자리 소문자 16진수입니다.
// 둘 중 하나라도 없거나 모양이 틀리면, 누구의 어느 기기인지 모르는 요청이므로 구역에 들이지 않습니다.
const SUBJECT_ID = /^[\x21-\x7e]{1,256}$/u;
const DEVICE_ID = /^[0-9a-f]{16}$/u;
// 빈 쿼리의 SHA-256 지문. 쿼리 길이가 0이면 지문도 이 값이어야 합니다(쿼리로 기능·구역을 고르지 못하게).
const EMPTY_QUERY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const ZONE_ROUTES = Object.freeze({
  // 내 메모 구역: 읽기·수정(추가·고침·삭제). aleph.config.json의 allowedRoutes와 같은 다섯 경로입니다.
  // 남의 메모인지는 판정기가 알 수 없으므로, 자료 API(api/notes.js)가 저장된 owner_id로 다시 막습니다.
  'GET /notes': 'owner_notes',
  'POST /notes': 'owner_notes',
  'GET /notes/:id': 'owner_notes',
  'PUT /notes/:id': 'owner_notes',
  'DELETE /notes/:id': 'owner_notes',
});

// path → 'GET /notes/:id' 같은 route 모양 (자원 경로가 아니면 null)
function routeShape(method, path) {
  if (typeof method !== 'string' || typeof path !== 'string' || path.length > 256) return null;
  const match = /^\/(notes|notices)(?:\/([^/?#]+))?$/u.exec(path);
  if (!match) return null;
  if (match[2] !== undefined && !ITEM_ID.test(match[2])) return null;
  return `${method} /${match[1]}${match[2] === undefined ? '' : '/:id'}`;
}

// 구역 판단: { zone } 이거나 { deny: [reasonCode, ruleId] } 이거나 null(이전 규칙에 맡김)
function zoneFor(request) {
  const method = ownValue(request, 'method');
  const path = ownValue(request, 'path');
  const route = ownValue(request, 'route');
  const shape = routeShape(method, path);
  const queryLength = ownValue(request, 'queryLength');
  if (!shape || shape !== route || queryLength !== 0) {
    return { deny: ['route_not_allowed', 'resource_zones'] };
  }
  if (shape.endsWith(' /notices') || shape.endsWith(' /notices/:id')) {
    return { deny: ['zone_not_allowed', 'class_notices_zone'] };
  }
  if (ownValue(request, 'querySha256') !== EMPTY_QUERY_SHA256) {
    return { deny: ['route_not_allowed', 'resource_zones'] };
  }
  const zone = ZONE_ROUTES[shape];
  return zone ? { zone } : null;
}

export async function decide(request) {
  // 6단계: 등록된 기기가 아니면 다른 판단보다 먼저 거부합니다.
  // 요청 객체 자신이 가진 deviceRegistered만 믿습니다(상속·프로토타입으로 끼워 넣은 값은 무시).
  const registered = request !== null && typeof request === 'object'
    && Object.hasOwn(request, 'deviceRegistered') && request.deviceRegistered === true;
  if (!registered) {
    return respond(request, 'deny', 'device_not_registered', ['device_registered']);
  }

  // 8단계: 엔진이 확인한 기기 ID와 주체 ID가 있어야 합니다.
  const deviceId = ownValue(request, 'deviceId');
  if (typeof deviceId !== 'string' || !DEVICE_ID.test(deviceId)) {
    return respond(request, 'deny', 'device_not_registered', ['device_registered']);
  }
  const subjectId = ownValue(request, 'subjectId');
  if (typeof subjectId !== 'string' || !SUBJECT_ID.test(subjectId)) {
    return respond(request, 'deny', 'route_not_allowed', ['resource_zones']);
  }

  // 8단계: 엔진이 확인한 경로로 구역을 정합니다. 알 수 없는 경로·쿼리·공지 수정은 여기서 거부합니다.
  const zoned = zoneFor(request);
  if (zoned?.deny) return respond(request, 'deny', zoned.deny[0], [zoned.deny[1]]);

  if (zoned?.zone) {
    // 7단계: 복합 이상 접속이면, 방금 다시 확인한 경우가 아닌 한 추가 확인을 요청합니다.
    if (unusualAccess(readAccessContext(request)) && !freshlyVerified(request)) {
      return respond(request, 'step_up', 'step_up_required', ['step_up_required']);
    }
    const zoneRule = zoned.zone === 'owner_notes' ? 'owner_notes_zone' : 'class_notices_zone';
    return respond(request, 'allow', 'approved', ['device_registered', zoneRule]);
  }

  // 그 밖의 요청은 시작 틀 기본값대로 거부합니다.
  return respond(request, 'deny', 'starter_not_ready', [RULE_IDS[0]]);
}
