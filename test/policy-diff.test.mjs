// 10단계 제작 1 · 안전 정책 차이 보기 시험 (가상 작업 폴더에서 실행, 실제 정책·DB는 건드리지 않음)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { diffPolicy, verifyBaseline, POLICY_FILES, TRUSTED_BASELINE } from '../src/policy-diff.mjs';

const repo = resolve(import.meta.dirname, '..');

// 저장소의 정책 파일·설정·사본만 복사한 가상 작업 폴더(Git 기록 없음)
function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'policy-diff-'));
  for (const path of [...POLICY_FILES, 'aleph.config.json']) cpSync(join(repo, path), join(dir, path), { recursive: true });
  cpSync(join(repo, TRUSTED_BASELINE.dir), join(dir, TRUSTED_BASELINE.dir), { recursive: true });
  return dir;
}
// 이 PC가 CRLF로 체크아웃했어도 같은 변조가 만들어지도록, 바꾸기 전에 줄바꿈을 LF로 맞춥니다.
const edit = (dir, path, fn) => writeFileSync(join(dir, path), fn(readFileSync(join(dir, path), 'utf8').replace(/\r\n/gu, '\n')));
function snapshot(dir) {
  const out = {};
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name); if (e.isDirectory()) walk(p); else out[p] = `${statSync(p).mtimeMs}:${readFileSync(p, 'utf8')}`; } };
  walk(dir); return out;
}

test('실제 저장소: 사본이 기준 커밋과 대조되고, 9단계 이후 정책 차이가 없다', () => {
  const report = diffPolicy(repo);
  assert.equal(report.baseline.verified, true);
  assert.equal(report.baseline.provenance, 'git_commit_verified');
  assert.equal(report.status, 'UNCHANGED');
  assert.equal(report.writeCount, 0);
});

test('차이 없음: 정책이 같으면 UNCHANGED, step 변경은 정책 차이가 아니다', () => {
  const dir = workspace();
  try {
    edit(dir, 'aleph.config.json', (s) => s.replace(/"step": \d+/u, '"step": 11'));
    const report = diffPolicy(dir, { useGit: false });
    assert.equal(report.status, 'UNCHANGED');
    assert.equal(report.baseline.provenance, 'pinned_digest_only');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('판정기 변조: 바뀐 구역 경로와 줄, 복원 후보가 실행 전에 보인다', () => {
  const dir = workspace();
  try {
    edit(dir, 'src/decider.mjs', (s) => s.replace("  'GET /notices/:id': 'class_notices',\n", "  'GET /notices/:id': 'class_notices',\n  'PUT /notices/:id': 'class_notices',\n"));
    const report = diffPolicy(dir, { useGit: false });
    assert.equal(report.status, 'CHANGES_DETECTED');
    const change = report.changes.find((c) => c.path === 'src/decider.mjs');
    assert.deepEqual(change.zoneRoutes.added, ['PUT /notices/:id → class_notices']);
    assert.equal(change.linesAdded, 1);
    assert.deepEqual(report.restorePreview.candidateFiles, ['src/decider.mjs']);
    assert.equal(report.restorePreview.applied, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('설정 변조: allowedRoutes 추가와 restoreRoute 변경이 칸별로 보인다', () => {
  const dir = workspace();
  try {
    edit(dir, 'aleph.config.json', (s) => { const c = JSON.parse(s); c.allowedRoutes.push('GET /api/export'); c.restoreRoute = 'POST /api/anything'; return JSON.stringify(c, null, 2); });
    const report = diffPolicy(dir, { useGit: false });
    const routes = report.changes.find((c) => c.field === 'allowedRoutes');
    assert.deepEqual(routes.added, ['GET /api/export']);
    const restore = report.changes.find((c) => c.field === 'restoreRoute');
    assert.equal(restore.baseline, null);
    assert.deepEqual(report.restorePreview.candidateConfigFields, ['allowedRoutes', 'restoreRoute']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CRLF 줄바꿈만 다르면 차이가 아니다', () => {
  const dir = workspace();
  try {
    for (const path of POLICY_FILES) edit(dir, path, (s) => s.replace(/\r?\n/gu, '\r\n'));
    assert.equal(diffPolicy(dir, { useGit: false }).status, 'UNCHANGED');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

for (const [name, breakIt] of [
  ['사본 폴더 없음', (dir) => rmSync(join(dir, TRUSTED_BASELINE.dir), { recursive: true })],
  ['manifest 없음', (dir) => rmSync(join(dir, TRUSTED_BASELINE.dir, 'manifest.json'))],
  ['사본 파일 없음', (dir) => rmSync(join(dir, TRUSTED_BASELINE.dir, 'policy/src/decider.mjs'))],
  ['사본 파일 변조', (dir) => edit(dir, `${TRUSTED_BASELINE.dir}/policy/src/decider.mjs`, (s) => `${s}\n// 변조`)],
  ['사본과 manifest 지문을 함께 변조', (dir) => {
    edit(dir, `${TRUSTED_BASELINE.dir}/policy/src/decider.mjs`, (s) => `${s}\n// 변조`);
    edit(dir, `${TRUSTED_BASELINE.dir}/manifest.json`, (s) => s.replace(/"sha256": "[0-9a-f]{64}"/u, '"sha256": "' + '0'.repeat(64) + '"'));
  }],
  ['manifest 경로를 폴더 밖으로', (dir) => edit(dir, `${TRUSTED_BASELINE.dir}/manifest.json`, (s) => s.replace('"policy/src/decider.mjs"', '"../../../src/decider.mjs"'))],
  ['설정 칸 사본 변조', (dir) => edit(dir, `${TRUSTED_BASELINE.dir}/policy/config/policy-fields.json`, (s) => s.replace('"restoreRoute": null', '"restoreRoute": "POST /x"'))],
]) {
  test(`검증 실패면 중단: ${name}`, () => {
    const dir = workspace();
    try {
      breakIt(dir);
      const report = diffPolicy(dir, { useGit: false });
      assert.equal(report.status, 'INVALID_BASELINE');
      assert.equal(report.baseline.verified, false);
      assert.deepEqual(report.changes, []);
      assert.equal(verifyBaseline(dir, { useGit: false }).ok, false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

test('읽기 전용: 실행 전후로 파일 내용과 수정 시각이 그대로다', () => {
  const dir = workspace();
  try {
    edit(dir, 'src/decider.mjs', (s) => s.replace("'GET /materials': 'instructor_materials',", ''));
    const before = snapshot(dir);
    const report = diffPolicy(dir, { useGit: false });
    assert.equal(report.status, 'CHANGES_DETECTED');
    assert.deepEqual(snapshot(dir), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('비밀값처럼 보이는 줄은 차이에 표시하지 않는다', () => {
  const dir = workspace();
  try {
    const fakeKey = ['sb', 'secret', 'ABCDEFGHIJKLMNOP'].join('_'); // 시험용 가짜 값(저장소에 키 모양 글자를 두지 않음)
    edit(dir, 'api/notes.js', (s) => `${s}\nconst leaked = '${fakeKey}';\n`);
    const text = JSON.stringify(diffPolicy(dir, { useGit: false }));
    assert.equal(text.includes(fakeKey), false);
    assert.match(text, /비밀값처럼 보이는 줄/u);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
