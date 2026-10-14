// 9단계에서 학생이 채우는 탐지 함수입니다. 이 기본값은 어떤 접속도 회수하지 않습니다.
// 반 엔진이 검증한 사건만 전달해야 하며, 브라우저가 보낸 사용자 번호는 받지 않습니다.
//
// 9단계 제작 1 · 입력 정리: 가상 사건에서 아래 다섯 값만 읽습니다.
//   시각(at) · 가명 사용자(subjectId, 연습 형식은 identity.sub) · 기기(deviceId) · 요청 종류(method) · 판정(decision)
// 메모 내용·토큰·실명 등 그 밖의 칸은 읽지도, 저장하지도, 출력하지도 않습니다.
// 사건 객체 자신이 가진 값만 읽습니다(상속·프로토타입으로 끼워 넣은 값은 무시).
//
// 9단계 제작 2 · 탐지 규칙 하나: 평소와 다른 네트워크 + 갑작스러운 다량 조회가 함께 나타날 때만 의심으로 표시합니다.
//   - 네트워크는 엔진이 검증해 넘긴 출처(signals.source === 'judge_fixture')의 signals.network만 믿습니다.
//     그 밖의 출처나 빈 값은 '모름'으로 두고, '평소 네트워크'로 채우지 않습니다.
//   - 지역(region)은 근거로 쓰지 않습니다. 지역 하나만으로 의심을 확정하지 않습니다.
//   - 다량 조회: 같은 가명 사용자의 GET이 어느 10분 구간에서든 120건을 넘을 때(정확히 120건은 제외).
//   - 사용자의 사건에 검증된 네트워크 정보가 있으면 평소와 다른 네트워크(unusual·new·first_seen)의 GET만 셉니다.
//     평소 네트워크에서의 조회는 아무리 많아도 의심으로 표시하지 않습니다.
//   - 네트워크 정보가 전혀 없는 사건(공식 연습 형식, docs/DETECT_EVENTS.md)은 그 계약대로 다량 조회만으로 판단합니다.
//   - 의심이면 { action: 'propose_revocation', reasonCode: 'burst_read', subject, deviceId }, 아니면 { action: 'observe' }입니다.
//
// 9단계 제작 3 · 회수 제안: 판정기의 허용·거부 응답과는 별도인 탐지 결과입니다.
//   - 대상은 엔진이 확인한 가상 기기 한 개입니다. 다량 조회가 일어난 그 10분 구간에서 센 조회를 가장 많이 보낸 기기를
//     deviceId로 지목합니다(같으면 가장 최근에 보낸 기기). 같은 사용자의 다른 정상 기기는 대상에 넣지 않습니다.
//   - 사유는 reasonCode('burst_read')로 남깁니다.
//   - 기기 칸이 없는 공식 연습 사건(docs/DETECT_EVENTS.md)에서는 확인된 기기가 없으므로 계약 모양 그대로
//     { action, reasonCode, subject }만 돌려줍니다.
//   - 이 파일은 회수 API를 부르거나 기기 권한을 바꾸지 않습니다. 실제 회수와 걸린 시간은 엔진·심판이 확인합니다.

const SUBJECT = /^[\x21-\x7e]{1,256}$/u;      // 공백 없는 가명 ID
const DEVICE = /^[0-9a-f]{16}$/u;              // 엔진이 확인한 16자리 소문자 16진수 기기 ID
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const DECISIONS = new Set(['allow', 'deny', 'step_up']);
const TRUSTED_SIGNAL_SOURCES = new Set(['judge_fixture']);
const SIGNAL_WORD = /^[a-z][a-z0-9_]{0,31}$/u;
const UNUSUAL_NETWORKS = new Set(['unusual', 'new', 'first_seen']);
const BURST_WINDOW_MS = 10 * 60 * 1000;
const BURST_LIMIT = 120; // 이 건수를 '넘을 때만' 다량 조회입니다.

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
  const signals = ownValue(event, 'signals');
  const rawNetwork = ownValue(signals, 'network');
  const network = TRUSTED_SIGNAL_SOURCES.has(ownValue(signals, 'source'))
    && typeof rawNetwork === 'string' && SIGNAL_WORD.test(rawNetwork) && rawNetwork !== 'unknown' ? rawNetwork : null;
  return Object.freeze({
    atMs,
    subject: rawSubject,
    device: typeof rawDevice === 'string' && DEVICE.test(rawDevice) ? rawDevice : null,
    method,
    decision: typeof rawDecision === 'string' && DECISIONS.has(rawDecision) ? rawDecision : null,
    network, // 검증된 출처의 네트워크 값, 모르면 null
  });
}

// 사건 배열 → 읽을 수 있는 사건만 시각 순으로 정리한 배열
export function readDetectionEvents(events) {
  if (!Array.isArray(events)) throw new TypeError('invalid_detection_events');
  return Object.freeze(events.map(readDetectionEvent).filter(Boolean).sort((a, b) => a.atMs - b.atMs));
}

// 사건 배열(시각 순)에서 어느 10분 구간이든 BURST_LIMIT을 처음 넘는 구간의 사건들, 없으면 null
function firstBurst(list) {
  for (let start = 0, end = 0; end < list.length; end += 1) {
    while (list[end].atMs - list[start].atMs >= BURST_WINDOW_MS) start += 1;
    if (end - start + 1 > BURST_LIMIT) return list.slice(start, end + 1);
  }
  return null;
}

// 다량 조회 구간에서 조회를 가장 많이 보낸 확인된 기기 하나(같으면 가장 최근 기기), 없으면 null
function targetDevice(windowEvents) {
  const counts = new Map();
  for (const event of windowEvents) {
    if (event.device === null) continue;
    const entry = counts.get(event.device) ?? { count: 0, lastMs: 0 };
    entry.count += 1;
    entry.lastMs = Math.max(entry.lastMs, event.atMs);
    counts.set(event.device, entry);
  }
  let best = null;
  for (const [device, entry] of counts) {
    if (!best || entry.count > best.count || (entry.count === best.count && entry.lastMs > best.lastMs)) {
      best = { device, ...entry };
    }
  }
  return best ? best.device : null;
}

export function detect(events) {
  const readable = readDetectionEvents(events);
  const bySubject = new Map();
  for (const event of readable) {
    if (!bySubject.has(event.subject)) bySubject.set(event.subject, []);
    bySubject.get(event.subject).push(event);
  }
  for (const [subject, list] of bySubject) {
    const knowsNetwork = list.some((event) => event.network !== null);
    const counted = list.filter((event) => event.method === 'GET'
      && (!knowsNetwork || UNUSUAL_NETWORKS.has(event.network)));
    const burst = firstBurst(counted);
    if (burst) {
      const deviceId = targetDevice(burst);
      return deviceId === null
        ? { action: 'propose_revocation', reasonCode: 'burst_read', subject }
        : { action: 'propose_revocation', reasonCode: 'burst_read', subject, deviceId };
    }
  }
  return { action: 'observe' };
}
