// XDR 보너스 brute-force · 확인용 읽기 모듈
// xdr/fixtures/brute-force.json 의 Wazuh 모양 경보에서 다섯 값만 뽑습니다.
//   시각(timestamp) · 출발 주소(data.srcip) · 계정(data.srcuser) · 규칙 수준(rule.level) · 설명(rule.description)
// 원본 경보 파일은 읽기만 하고 고치지 않습니다. 비밀값처럼 보이는 글자는 [가림]으로 바꿔 출력합니다.
// 이 파일은 사람이 경보를 살펴보는 확인용입니다. decide.mjs 는 이 모듈을 불러오지 않습니다.
//
// 실행(저장소 루트에서):  node xdr/brute-force/read-alerts.mjs
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MASK = '[가림]';

// 비밀값처럼 보이는 모양들. 값 자체는 어디에도 출력하지 않습니다.
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/gu,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/giu,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/gu, // JWT
  /\b(?:sb_secret|sb_publishable|sk|pk|rk)_[A-Za-z0-9_-]{8,}/gu,
  /\bsk-[A-Za-z0-9_-]{16,}/gu,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu, // 클라우드 접근 키 모양
  /\bgh[pousr]_[A-Za-z0-9]{20,}/gu,
  /\b[A-Fa-f0-9]{32,}\b/gu, // 긴 16진수(해시·키)
  /\b[A-Za-z0-9+/]{40,}={0,2}/gu, // 긴 base64
];
// "password=…", "token: …" 처럼 이름이 붙은 값은 이름은 두고 값만 가립니다.
const NAMED_SECRET = /\b(pass(?:word|wd)?|pwd|secret|token|api[_-]?key|access[_-]?key|authorization|cookie|session(?:[_-]?id)?|otp)\b(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&]+)/giu;

export function maskSecrets(value) {
  if (typeof value !== 'string') return value;
  // 모양으로 알아볼 수 있는 값(Bearer 토큰 등)을 먼저 가리고, 그다음 이름 붙은 값을 가립니다.
  let text = value;
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, MASK);
  return text.replace(NAMED_SECRET, (_m, name, sep) => `${name}${sep}${MASK}`);
}

function text(value) {
  if (value === undefined || value === null || value === '') return '-';
  return maskSecrets(String(value)).replace(/[\r\n\t]+/gu, ' ').trim() || '-';
}

// 경보 하나 → 다섯 값. 다른 칸(agent, accounts, mitre 등)은 뽑지 않습니다.
export function pickAlert(alert) {
  const level = Number(alert?.rule?.level);
  return {
    at: text(alert?.timestamp),
    srcip: text(alert?.data?.srcip),
    srcuser: text(alert?.data?.srcuser),
    level: Number.isFinite(level) ? level : null,
    description: text(alert?.rule?.description),
  };
}

export async function readAlerts(root) {
  const file = join(root, 'xdr', 'fixtures', 'brute-force.json');
  const fixture = JSON.parse(await readFile(file, 'utf8'));
  if (fixture?.schema !== 'aleph.xdr.fixture.v1' || fixture.moduleKey !== 'brute-force'
      || !Array.isArray(fixture.alerts)) {
    throw new Error('brute-force 경보 묶음 형식이 아닙니다.');
  }
  return { total: fixture.alerts.length, rows: fixture.alerts.map(pickAlert) };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  try {
    const { total, rows } = await readAlerts(root);
    console.log(['시각', '출발 주소', '계정', '수준', '설명'].join('\t'));
    for (const row of rows) {
      console.log([row.at, row.srcip, row.srcuser, row.level ?? '-', row.description].join('\t'));
    }
    const same = total === rows.length;
    console.log(`\n경보 ${total}건 · 뽑은 줄 ${rows.length}줄 · ${same ? '일치' : '불일치'}`);
    if (!same) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : '읽기 오류');
    process.exitCode = 1;
  }
}
