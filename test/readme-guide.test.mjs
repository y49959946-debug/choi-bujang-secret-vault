// 12단계 제작 3 · README 설치·실행·중지·복구 안내 점검(로컬, 문서 정적 검사)
// 이 시험은 문서의 명령 이름·파일 경로·출처 구분·비밀값 모양만 봅니다. 명령이 실제로 성공하는지는
// 새 clone에서 따로 실행해 확인합니다(README 「③ 재현 순서」 A).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '..');
const readme = readFileSync(join(repo, 'README.md'), 'utf8');
const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
const start = readme.indexOf('<!-- guide:start -->');
const end = readme.indexOf('<!-- guide:end -->');
const guide = readme.slice(start, end);
// scripts/bundle.mjs의 비밀값 검사와 같은 모양(개인키·Bearer 토큰·Supabase 비밀 키·sk- 키·JWT·이메일)
const SECRET = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/-]{16,}|\bsb_secret_[A-Za-z0-9_-]{12,}|\bsb_publishable_[A-Za-z0-9_-]{12,}|\bsk-[A-Za-z0-9_-]{20,}|\beyJ[A-Za-z0-9_-]{12,}\.eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu;

test('안내 구역이 하나 있고 출처 구분·비밀값·재현 순서·실행 중지 복구·미실행 항목을 모두 담는다', () => {
  assert.ok(start > 0 && end > start, '안내 표시가 있음');
  assert.equal(readme.split('<!-- guide:start -->').length, 2, '안내는 하나');
  for (const head of ['① 출처 구분', '② 비밀값', '③ 재현 순서', '④ 구성 요소별 실행·중지·복구', '⑤ 실행하지 않은 것']) assert.ok(guide.includes(head), head);
  for (const col of ['학생 몫', '시작 틀 제공', 'ALEPH SDP 엔진(과제 제공)', '외부 서비스']) assert.ok(guide.includes(col), col);
  for (const part of ['학생 판정기', '탐지 규칙', '접속 앱', '자료실']) assert.ok(guide.includes(`| ${part}`), part);
  for (const term of ['로그아웃', '접근 차단', '메모 복구', '정책 복구', '코드 롤백', '배포 롤백']) assert.match(guide, new RegExp(`\\| ${term}(?: |\\()`, 'u'), `용어 ${term}`);
});

test('엔진 설치·실행 절차를 지어내지 않는다(저장소에 없다고 밝힘)', () => {
  assert.match(guide, /엔진의 소스·설치 파일·버전·주소·시작·중지 명령이 \*\*없습니다\*\*/u);
  assert.doesNotMatch(guide, /npm (?:i|install) [^\n`]*aleph|npx [^\n`]*aleph|docker [^\n`]*aleph/iu, '엔진 설치 명령 없음');
});

test('안내에 적은 npm 명령은 모두 package.json에 있다', () => {
  const names = [...guide.matchAll(/npm run ([a-z0-9:_-]+)/giu)].map((m) => m[1]);
  assert.ok(names.length >= 10);
  for (const name of new Set(names)) assert.ok(name in pkg.scripts, `npm run ${name}`);
});

test('안내에 적은 저장소 파일 경로는 모두 있다', () => {
  const paths = [...guide.matchAll(/`((?:src|api|scripts|supabase|test|docs|public|recovery\/baselines|package)\/[A-Za-z0-9._/-]+)`/gu)].map((m) => m[1]);
  assert.ok(paths.length >= 20);
  const GENERATED = new Set(['public/aleph.json']); // 빌드가 만드는 파일(Git에서 제외)
  for (const p of new Set(paths)) if (!GENERATED.has(p)) assert.ok(existsSync(join(repo, p)), p);
  for (const f of ['middleware.js', 'vercel.json', 'AGENTS.md', 'aleph.config.json']) assert.ok(guide.includes(`\`${f}\``) && existsSync(join(repo, f)), f);
});

test('환경변수는 이름만 적고, 코드가 읽는 이름과 같다', () => {
  for (const name of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY']) {
    assert.ok(guide.includes(`\`${name}\``), name);
    assert.doesNotMatch(guide, new RegExp(`${name}\\s*=\\s*\\S`, 'u'), `${name} 값 없음`);
  }
  assert.doesNotMatch(guide, /yakpkxozjfwnflpizavj/u, '안내에 실제 Supabase 프로젝트 주소를 넣지 않음');
});

test('README와 증거 파일에 비밀값 모양이 없다', () => {
  assert.doesNotMatch(readme, SECRET, 'README');
  const ev = join(repo, 'evidence');
  for (const f of readdirSync(ev)) {
    const text = readFileSync(join(ev, f), 'utf8');
    assert.doesNotMatch(text, SECRET, f);
    assert.doesNotMatch(text, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu, `${f} 전체 ID 없음`);
  }
});

test('비밀값을 담는 파일은 Git에서 빠진다', () => {
  const ignore = readFileSync(join(repo, '.gitignore'), 'utf8').split(/\r?\n/u);
  for (const rule of ['.env', '.env.*', '*.local.sql', 'artifacts/', 'bundle-notes.json', 'public/aleph.json']) assert.ok(ignore.includes(rule), rule);
});
