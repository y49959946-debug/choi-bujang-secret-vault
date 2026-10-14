// 10단계 제작 2 · 안전 정책 되돌리기 시험 (저장소를 복사한 가상 작업 폴더에서만 실행, 실제 정책·DB는 건드리지 않음)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { applyRestorePlan, buildRestorePlan, readAuditLog, AUDIT_LOG } from '../src/policy-restore.mjs';

const repo = resolve(import.meta.dirname, '..');
const SKIP = new Set(['.git', 'node_modules', 'artifacts', 'public', 'bundle-notes.json']);

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'policy-restore-'));
  cpSync(repo, dir, { recursive: true, filter: (src) => !SKIP.has(src.slice(repo.length + 1).split(/[\\/]/u)[0]) });
  rmSync(join(dir, 'recovery/audit'), { recursive: true, force: true });
  symlinkSync(join(repo, 'node_modules'), join(dir, 'node_modules'), 'junction');
  return dir;
}
const read = (dir, path) => readFileSync(join(dir, path), 'utf8');
// 이 PC가 CRLF로 체크아웃했어도 같은 변조가 만들어지도록, 바꾸기 전에 줄바꿈을 LF로 맞춥니다.
const edit = (dir, path, fn) => writeFileSync(join(dir, path), fn(read(dir, path).replace(/\r\n/gu, '\n')));
const opts = { useGit: false };

// 침해 흉내: 판정기에 공지 수정 경로, 메모 API 소유자 검사 제거, 설정에 경로 추가, judgeIssuer 변경, 다른 서비스 파일 수정
function tamper(dir) {
  edit(dir, 'src/decider.mjs', (s) => s.replace("  'GET /notices/:id': 'class_notices',\n", "  'GET /notices/:id': 'class_notices',\n  'PUT /notices/:id': 'class_notices',\n"));
  edit(dir, 'api/notes.js', (s) => s.replace("if (String(stored.data.owner_id).toLowerCase() !== userId) {", 'if (false) {'));
  edit(dir, 'aleph.config.json', (s) => { const c = JSON.parse(s); c.allowedRoutes.push('GET /api/export'); c.judgeIssuer = 'https://changed-by-operator.up.railway.app/defense/judge'; return `${JSON.stringify(c, null, 2)}\n`; });
  edit(dir, 'src/detect.mjs', (s) => `${s}\n// 다른 서비스의 정상 작업\n`);
}

test('미리보기: 바뀔 항목·보존 항목·계획 지문을 보여 주고 아무것도 쓰지 않는다', () => {
  const dir = workspace();
  try {
    tamper(dir);
    const before = read(dir, 'src/decider.mjs');
    const plan = buildRestorePlan(dir, opts);
    assert.equal(plan.status, 'READY_TO_APPLY');
    assert.equal(plan.writeCount, 0);
    assert.match(plan.planDigest, /^[0-9a-f]{64}$/u);
    assert.deepEqual(plan.targets.files.map((f) => f.path).sort(), ['api/notes.js', 'src/decider.mjs']);
    assert.ok(plan.targets.files.every((f) => f.wholeFileReplace));
    assert.deepEqual(plan.targets.files.find((f) => f.path === 'src/decider.mjs').zoneRoutes.added, ['PUT /notices/:id → class_notices']);
    assert.deepEqual(plan.targets.configFields.map((c) => c.field), ['allowedRoutes']);
    assert.deepEqual(plan.preserved.compareOnly, [{ field: 'judgeIssuer', differsFromBaseline: true, action: 'preserve' }]);
    assert.equal(read(dir, 'src/decider.mjs'), before);
    assert.equal(existsSync(join(dir, AUDIT_LOG)), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('실행: 검증한 정책으로 되돌리고, B의 A 요청은 다시 403·A 정상 요청은 유지된다', async () => {
  const dir = workspace();
  try {
    tamper(dir);
    const detectBefore = read(dir, 'src/detect.mjs');
    const plan = buildRestorePlan(dir, opts);
    const result = await applyRestorePlan(dir, plan.planDigest, opts);
    assert.equal(result.status, 'RESTORED', JSON.stringify(result.checks));
    assert.equal(result.checks.ownerCheck, true);
    assert.equal(result.checks.deciderPractice, true);
    assert.equal(read(dir, 'src/decider.mjs').includes("'PUT /notices/:id'"), false);
    assert.equal(read(dir, 'api/notes.js').includes('if (false) {'), false);
    const config = JSON.parse(read(dir, 'aleph.config.json'));
    assert.equal(config.allowedRoutes.includes('GET /api/export'), false);
    assert.equal(config.judgeIssuer, 'https://changed-by-operator.up.railway.app/defense/judge', '운영 측 값은 보존');
    assert.equal(config.step, 10, 'step은 되돌리지 않음');
    assert.equal(read(dir, 'src/detect.mjs'), detectBefore, '다른 서비스 규칙 보존');
    const audit = readAuditLog(dir);
    assert.equal(audit.ok, true);
    assert.deepEqual(audit.entries.map((e) => e.event), ['restore_started', 'restore_completed']);
    assert.equal(JSON.stringify(audit.entries).includes('changed-by-operator'), false, '설정 값 자체는 기록하지 않음');
    assert.equal(buildRestorePlan(dir, opts).status, 'NOTHING_TO_RESTORE');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('미리보기 없이·다른 지문으로는 실행하지 않는다', async () => {
  const dir = workspace();
  try {
    tamper(dir);
    const before = read(dir, 'src/decider.mjs');
    for (const digest of [undefined, '0'.repeat(64), 'abc']) {
      const result = await applyRestorePlan(dir, digest, opts);
      assert.equal(result.status, 'REFUSED');
      assert.equal(result.writeCount, 0);
    }
    assert.equal(read(dir, 'src/decider.mjs'), before);
    assert.equal(existsSync(join(dir, AUDIT_LOG)), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('미리보기 뒤 다른 정책 파일이 바뀌면 오래된 계획은 거부된다', async () => {
  const dir = workspace();
  try {
    tamper(dir);
    const plan = buildRestorePlan(dir, opts);
    edit(dir, 'src/resources.mjs', (s) => `${s}\n// 미리보기 뒤 변경\n`);
    const result = await applyRestorePlan(dir, plan.planDigest, opts);
    assert.equal(result.status, 'REFUSED');
    assert.match(read(dir, 'src/decider.mjs'), /'PUT \/notices\/:id'/u);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('restoreRoute가 사본과 다르면 덮어쓰지 않고 검토 필요로 멈춘다', async () => {
  const dir = workspace();
  try {
    tamper(dir);
    edit(dir, 'aleph.config.json', (s) => s.replace('"restoreRoute": null', '"restoreRoute": "POST /api/restore"'));
    const plan = buildRestorePlan(dir, opts);
    assert.equal(plan.status, 'NEEDS_REVIEW');
    assert.equal((await applyRestorePlan(dir, plan.planDigest, opts)).status, 'REFUSED');
    assert.match(read(dir, 'aleph.config.json'), /POST \/api\/restore/u);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('사본 검증에 실패하면 아무것도 쓰지 않는다', async () => {
  const dir = workspace();
  try {
    tamper(dir);
    const plan0 = buildRestorePlan(dir, opts);
    edit(dir, 'recovery/baselines/step9/policy/src/decider.mjs', (s) => `${s}\n// 사본 변조`);
    assert.equal(buildRestorePlan(dir, opts).status, 'INVALID_BASELINE');
    assert.equal((await applyRestorePlan(dir, plan0.planDigest, opts)).status, 'REFUSED');
    assert.match(read(dir, 'src/decider.mjs'), /'PUT \/notices\/:id'/u);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('감사 기록이 손상돼 있으면 고치지 않고 실행하지 않는다', async () => {
  const dir = workspace();
  try {
    tamper(dir);
    const first = await applyRestorePlan(dir, buildRestorePlan(dir, opts).planDigest, { ...opts, runRegression: false });
    assert.equal(first.status, 'RESTORED');
    tamper(dir);
    const logBefore = read(dir, AUDIT_LOG);
    writeFileSync(join(dir, AUDIT_LOG), logBefore.replace('restore_started', 'restore_startex'));
    const corrupted = read(dir, AUDIT_LOG);
    const result = await applyRestorePlan(dir, buildRestorePlan(dir, opts).planDigest, { ...opts, runRegression: false });
    assert.equal(result.status, 'REFUSED');
    assert.equal(read(dir, AUDIT_LOG), corrupted, '손상된 기록을 지우거나 새로 쓰지 않음');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('두 번째 복원도 앞선 감사 기록을 보존하고 체인으로 잇는다', async () => {
  const dir = workspace();
  try {
    tamper(dir);
    await applyRestorePlan(dir, buildRestorePlan(dir, opts).planDigest, { ...opts, runRegression: false });
    const firstLog = read(dir, AUDIT_LOG);
    tamper(dir);
    const second = await applyRestorePlan(dir, buildRestorePlan(dir, opts).planDigest, { ...opts, runRegression: false });
    assert.equal(second.status, 'RESTORED');
    assert.ok(read(dir, AUDIT_LOG).startsWith(firstLog));
    const audit = readAuditLog(dir);
    assert.equal(audit.ok, true);
    assert.equal(audit.entries.length, 4);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('쓰는 중 실패하면 바꾼 파일을 원래대로 되돌리고 기록한다', async () => {
  const dir = workspace();
  try {
    tamper(dir);
    const before = { d: read(dir, 'src/decider.mjs'), n: read(dir, 'api/notes.js'), c: read(dir, 'aleph.config.json') };
    const result = await applyRestorePlan(dir, buildRestorePlan(dir, opts).planDigest, { ...opts, failAfterWrites: 1 });
    assert.equal(result.status, 'ROLLED_BACK');
    assert.deepEqual({ d: read(dir, 'src/decider.mjs'), n: read(dir, 'api/notes.js'), c: read(dir, 'aleph.config.json') }, before);
    assert.deepEqual(readAuditLog(dir).entries.map((e) => e.event), ['restore_started', 'restore_rolled_back']);
    assert.equal(existsSync(join(dir, 'recovery/audit/restore-journal.json')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('저널이 남아 있으면(이전 실행 중단) 새 실행을 거부한다', async () => {
  const dir = workspace();
  try {
    tamper(dir);
    const digest = buildRestorePlan(dir, opts).planDigest;
    cpSync(join(dir, 'aleph.config.json'), join(dir, 'recovery/audit/restore-journal.json'), { recursive: true });
    assert.equal(buildRestorePlan(dir, opts).status, 'NEEDS_REVIEW');
    assert.equal((await applyRestorePlan(dir, digest, opts)).status, 'REFUSED');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CRLF 파일은 CRLF 그대로 되돌린다(줄바꿈 때문에 계속 차이가 나지 않음)', async () => {
  const dir = workspace();
  try {
    tamper(dir);
    edit(dir, 'src/decider.mjs', (s) => s.replace(/\r?\n/gu, '\r\n'));
    const result = await applyRestorePlan(dir, buildRestorePlan(dir, opts).planDigest, { ...opts, runRegression: false });
    assert.equal(result.status, 'RESTORED');
    assert.ok(read(dir, 'src/decider.mjs').includes('\r\n'));
    assert.equal(buildRestorePlan(dir, opts).status, 'NOTHING_TO_RESTORE');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('되돌릴 것이 없으면 실행하지 않는다', async () => {
  const dir = workspace();
  try {
    assert.equal(buildRestorePlan(dir, opts).status, 'NOTHING_TO_RESTORE');
    assert.equal((await applyRestorePlan(dir, 'x', opts)).status, 'REFUSED');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
