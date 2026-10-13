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
