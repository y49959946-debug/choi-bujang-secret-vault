// XDR 보너스 known-cve · 경보 한 건을 block / alert / record 로 나눕니다.
// 아래 PATTERNS 는 xdr/known-cve/patterns.json 의 패턴 세 개를 그대로 옮겨 적은 것입니다.
// 이 파일은 import·파일 읽기/쓰기·네트워크 없이 decide(alert) 안에서만 계산합니다. 경보 원본은 고치지 않습니다.
const PATTERNS = Object.freeze([
  Object.freeze({
    id: 'kc.jndi_lookup_in_header',
    name: '요청 머리글 안의 원격 조회 구문(jndi 형태)',
    technique: 'T1190',
    cve: 'CVE-2021-44228',
    condition: '요청 머리글(data.useragent 등)에 jndi 조회 표기와 원격 주소(ldap 등 프로토콜)가 붙은 완전한 원격 조회 구문이 있다.',
    evidence: 'CVE-2021-44228: JNDI 기능이 공격자가 정한 LDAP 등 원격 지점을 막지 못한다 (https://nvd.nist.gov/vuln/detail/CVE-2021-44228), T1190 사례 "CVE-2021-44228 in Log4j" (https://attack.mitre.org/techniques/T1190/)',
  }),
  Object.freeze({
    id: 'kc.jndi_lookup_in_request_param',
    name: '요청 인자 안의 원격 조회 구문(jndi 형태)',
    technique: 'T1190',
    cve: 'CVE-2021-44228',
    condition: '요청 주소의 인자(data.url)에 jndi 조회 표기와 원격 주소가 붙은 완전한 원격 조회 구문이 있고, 같은 data.srcip에서 반복되면 더 강하다.',
    evidence: 'CVE-2021-44228: 로그에 남는 인자의 JNDI 조회 (https://nvd.nist.gov/vuln/detail/CVE-2021-44228), T1190 탐지 "suspicious requests in access logs" (https://attack.mitre.org/techniques/T1190/)',
  }),
  Object.freeze({
    id: 'kc.vuln_scanner_trace_with_lookup',
    name: '알려진 취약점 점검 도구의 흔적',
    technique: 'T1595.002',
    cve: 'CVE-2021-44228',
    condition: '알려진 취약점 점검 도구의 흔적이 위 원격 조회 구문과 같은 요청에 함께 있다. 이름만 비슷하고 조회 구문이 없으면 해당하지 않는다.',
    evidence: 'T1595.002 Vulnerability Scanning (https://attack.mitre.org/techniques/T1595/002/), T1190 탐지 "abnormal request patterns to public endpoint" (https://attack.mitre.org/techniques/T1190/)',
  }),
]);

const [HEADER, PARAM, SCANNER] = PATTERNS;

// 확신도(confidence) = 경보가 위 패턴과 얼마나 뚜렷하게 맞는지(0~1).
//   0.85 이상 → block · 0.5 이상 → alert · 그 아래 → record
const BLOCK_AT = 0.85;
const ALERT_AT = 0.5;

// 완전한 원격 조회 구문: "${" + jndi + ":" + 원격 프로토콜 + "://" + 주소 + "}".
// 대소문자·공백 차이는 무시하고, 주소 인코딩(%24%7B 등)은 풀어서 봅니다.
const FULL_LOOKUP = /\$\{\s*jndi\s*:\s*(?:ldaps?|rmi|dns|iiop|corba|nds|nis|https?)\s*:\/\/[^\s}]+\}/iu;
// 완전한 구문은 아니지만 이 취약점을 떠올리게 하는 흔적(애매한 신호).
const PARTIAL_HINT = /jndi|cve-2021-44228|log4j|lookup|\$\{/iu;
// 점검 도구 흔적(설명 문구 또는 점검용 인자 이름).
const SCANNER_TRACE_TEXT = /취약점 점검 흔적|점검 도구 흔적/u;
const SCANNER_PARAM = /[?&](?:probe|scan|scanner|check)=/iu;
// 원문이 스스로 "구문은 없다/아니다"라고 밝힌 경우.
const SAYS_NO_LOOKUP = /구문은 없습니다|구문은 아닙니다|악용 구문은 없습니다|완전한 구문은 아닙니다/u;

// 머리글이 아닌 data 칸(주소·계정·건수·요청 주소).
const NON_HEADER_FIELDS = new Set(['srcip', 'dstip', 'srcuser', 'dstuser', 'count', 'url', 'srcport', 'dstport', 'protocol']);

const round2 = (v) => Math.round(v * 100) / 100;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function decodeAll(value) {
  let text = String(value);
  for (let i = 0; i < 3; i += 1) {
    let next;
    try { next = decodeURIComponent(text.replace(/\+/gu, ' ')); } catch { break; }
    if (next === text) break;
    text = next;
  }
  return text;
}

function toCount(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  if (typeof value === 'string' && /^\d{1,6}$/u.test(value.trim())) return Number(value.trim());
  return 0;
}

function actionFor(confidence) {
  if (confidence >= BLOCK_AT) return 'block';
  if (confidence >= ALERT_AT) return 'alert';
  return 'record';
}

const tag = (p) => `${p.name}(${p.technique}, ${p.cve})`;

export function decide(alert) {
  if (!alert || typeof alert !== 'object' || Array.isArray(alert)) {
    return { action: 'record', confidence: 0, reason: '경보 형식이 아니어서 기록만 합니다' };
  }

  const rule = alert.rule && typeof alert.rule === 'object' ? alert.rule : {};
  const data = alert.data && typeof alert.data === 'object' ? alert.data : {};
  const level = Number.isFinite(Number(rule.level)) ? Number(rule.level) : 0;
  const mitre = Array.isArray(rule.mitre) ? rule.mitre : [];
  const description = typeof rule.description === 'string' ? rule.description : '';
  const t1190 = mitre.includes('T1190');
  const count = toCount(data.count);

  const url = typeof data.url === 'string' ? decodeAll(data.url) : '';
  const headers = Object.entries(data)
    .filter(([key, value]) => !NON_HEADER_FIELDS.has(key) && typeof value === 'string')
    .map(([, value]) => decodeAll(value));

  const inHeader = headers.some((h) => FULL_LOOKUP.test(h));
  const inParam = FULL_LOOKUP.test(url);
  const scanner = (inHeader || inParam) && (SCANNER_TRACE_TEXT.test(description) || SCANNER_PARAM.test(url));

  // 1. 완전한 원격 조회 구문이 있는 경우: 패턴과 뚜렷하게 맞음 → 0.85 이상
  if (inHeader || inParam) {
    const matched = [];
    if (inHeader) matched.push(HEADER);
    if (inParam) matched.push(PARAM);
    if (scanner) matched.push(SCANNER);
    let confidence = 0.86;
    confidence += (matched.length - 1) * 0.03;            // 여러 패턴이 겹치면 더 뚜렷함
    confidence += clamp(count - 1, 0, 10) * 0.005;        // 같은 구문 반복
    confidence += clamp(level - 10, 0, 5) * 0.01;         // 높은 경보 수준
    if (t1190) confidence += 0.01;
    confidence = round2(clamp(confidence, BLOCK_AT, 0.99));
    const extra = [count > 1 ? `${count}건` : '', `수준 ${level}`].filter(Boolean).join(', ');
    return { action: actionFor(confidence), confidence, reason: `${matched.map(tag).join(' + ')}: ${extra}` };
  }

  // 2. 완전한 구문은 없지만 T1190 표시나 취약점을 떠올리게 하는 흔적이 있는 경우: 애매함 → 0.5 이상 0.85 미만
  const hintInHeader = headers.some((h) => PARTIAL_HINT.test(h));
  const hintInUrl = PARTIAL_HINT.test(url);
  if (t1190 || hintInHeader || hintInUrl) {
    let confidence = 0.5;
    if (t1190) confidence += 0.05;
    if (hintInHeader || hintInUrl) confidence += 0.05;
    confidence += clamp(count - 1, 0, 4) * 0.02;
    confidence += clamp(level - 5, 0, 5) * 0.01;
    if (SAYS_NO_LOOKUP.test(description)) confidence -= 0.03;
    confidence = round2(clamp(confidence, ALERT_AT, 0.8));
    const near = /점검|도구/u.test(description) ? SCANNER : (hintInHeader || (!url && headers.length) ? HEADER : PARAM);
    return {
      action: actionFor(confidence),
      confidence,
      reason: `${tag(near)} 의심: 완전한 원격 조회 구문 없음, 수준 ${level}`,
    };
  }

  // 3. 정상 이벤트
  return {
    action: 'record',
    confidence: 0.05,
    reason: `정상 요청: 알려진 패턴(${PATTERNS.map((p) => p.id).join(', ')})과 맞지 않음, 수준 ${level}`,
  };
}
