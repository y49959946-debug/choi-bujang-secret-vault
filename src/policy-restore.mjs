// 10단계 제작 2 · 검증한 안전 정책으로 시험 정책 되돌리기
//
// 흐름: 미리보기(기본, 쓰기 0건) → 사람이 바뀔 항목과 계획 지문 확인 → --apply --plan <지문>으로만 실행
//   - 사본 검증(제작 1의 verifyBaseline)에 실패하면 아무것도 쓰지 않고 멈춥니다.
//   - 되돌리는 범위: 정책 파일 6개 중 사본과 다른 파일(파일 전체 교체), aleph.config.json의 RESTORE_FIELDS 칸만.
//   - 보존: judgeIssuer(운영 측 값, 비교만), step·publicAppUrl 등 나머지 설정 칸, 목록 밖 파일(다른 서비스 규칙).
//   - restoreRoute가 사본 값(null)과 다르면 덮어쓰지 않고 NEEDS_REVIEW로 멈춥니다(나중에 만들 복구 경로를 지우지 않게).
//   - 계획 지문: 사본 지문, 정책 파일 6개·설정 파일의 현재 바이트 지문, 바뀔 대상과 복원 후 지문, 보존 규칙을 묶은 SHA-256.
//     실행 직전에 계획을 다시 만들어 지문이 다르면 하나도 쓰지 않습니다.
//   - 감사 이력: recovery/audit/restore-log.jsonl에 덧붙이기만 합니다(앞 줄 지문을 잇는 해시 체인).
//     기록이 손상돼 있거나 시작 기록을 쓸 수 없으면 실행하지 않습니다. 메모 본문·토큰·설정 값 자체는 남기지 않습니다.
//   - 중간 실패 대비: 바꾸기 전 내용을 저널에 남기고 임시 파일로 교체합니다. 실패하면 원래대로 되돌리고 기록합니다.
//     저널이 남아 있으면(이전 실행이 중간에 멈춤) 새 실행을 거부합니다.
//   - 운영 정책(Supabase 실제 RLS, Vercel 배포)에는 접속하지 않습니다. 되돌린 파일은 학생이 검토 후 커밋해야 배포됩니다.

import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { diffPolicy, verifyBaseline, POLICY_FILES, TRUSTED_BASELINE } from './policy-diff.mjs';

export const RESTORE_FIELDS = Object.freeze(['allowedRoutes', 'identityProvider', 'originalApiUrl']);
export const COMPARE_ONLY_FIELDS = Object.freeze(['judgeIssuer']);
export const GUARDED_FIELDS = Object.freeze(['restoreRoute']);
// 다른 서비스 규칙: 이 명령이 쓰지 않으며, 실행 전후 지문이 같아야 합니다.
export const PRESERVED_PATHS = Object.freeze([
  'api/auth.js', 'api/ai.js', 'api/threat-intel.js', 'src/detect.mjs', 'src/attack-check.mjs',
  'src/policy-diff.mjs', 'src/policy-restore.mjs', 'xdr', 'vercel.json', 'package.json',
  'supabase/notes-step3.sql', TRUSTED_BASELINE.dir,
]);
export const AUDIT_LOG = 'recovery/audit/restore-log.jsonl';
const JOURNAL = 'recovery/audit/restore-journal.json';
const PLAN_SCHEMA = 'aleph.policy-restore-plan.v1';

const lf = (text) => text.replace(/^﻿/u, '').replace(/\r\n?/gu, '\n');
const shaRaw = (buffer) => createHash('sha256').update(buffer).digest('hex');
const shaText = (text) => createHash('sha256').update(lf(text), 'utf8').digest('hex');
const shaJson = (value) => createHash('sha256').update(JSON.stringify(value ?? null), 'utf8').digest('hex');
const canonical = (value) => JSON.stringify(value, (key, v) => (v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v));
const readRaw = (root, path) => (existsSync(join(root, path)) ? readFileSync(join(root, path)) : null);
const usesCrlf = (buffer) => buffer !== null && buffer.includes('\r\n');
const withEol = (text, crlf) => (crlf ? lf(text).replace(/\n/gu, '\r\n') : lf(text));

// 보존 대상의 현재 지문(폴더는 안의 파일 전체)
function preservedFingerprint(root) {
  const out = {};
  const walk = (path) => {
    const full = join(root, path);
    if (!existsSync(full)) { out[path] = null; return; }
    if (statSync(full).isDirectory()) {
      for (const name of readdirSync(full).sort()) walk(`${path}/${name}`);
    } else out[path] = shaRaw(readFileSync(full));
  };
  for (const path of PRESERVED_PATHS) walk(path);
  return out;
}

function readConfig(root) {
  const raw = readRaw(root, 'aleph.config.json');
  if (raw === null) return { raw: null, config: null };
  try { return { raw, config: JSON.parse(raw.toString('utf8')) }; } catch { return { raw, config: null }; }
}

// ---------- 계획 만들기(미리보기, 쓰기 0건) ----------
export function buildRestorePlan(root, { useGit = true } = {}) {
  root = resolve(root);
  const base = { mode: 'PREVIEW', baselineId: TRUSTED_BASELINE.id, baselineCommit: TRUSTED_BASELINE.commit, writeCount: 0, networkCallCount: 0 };
  if (existsSync(join(root, JOURNAL))) {
    return { status: 'NEEDS_REVIEW', ...base, reason: '이전 복원이 중간에 멈춘 저널이 남아 있습니다. 먼저 상태를 검토하세요' };
  }
  const verified = verifyBaseline(root, { useGit });
  if (!verified.ok) return { status: 'INVALID_BASELINE', ...base, reason: verified.reason };
  const { raw: configRaw, config } = readConfig(root);
  if (!config) return { status: 'NEEDS_REVIEW', ...base, reason: 'aleph.config.json을 읽을 수 없습니다' };

  const report = diffPolicy(root, { useGit });
  const files = [];
  const current = {};
  for (const path of POLICY_FILES) {
    const raw = readRaw(root, path);
    current[path] = raw === null ? null : shaRaw(raw);
    const baselineText = verified.baseline.files[path];
    if (raw !== null && lf(raw.toString('utf8')) === baselineText) continue;
    const change = report.changes.find((c) => c.kind === 'file' && c.path === path);
    files.push({
      path, wholeFileReplace: true, currentSha256: current[path],
      restoredSha256: shaRaw(Buffer.from(withEol(baselineText, usesCrlf(raw)), 'utf8')),
      status: raw === null ? 'MISSING' : 'MODIFIED',
      linesRemoved: change?.linesRemoved ?? null, linesAdded: change?.linesAdded ?? null,
      rules: change?.rules ?? null, zoneRoutes: change?.zoneRoutes ?? null,
    });
  }

  const configFields = [];
  for (const field of RESTORE_FIELDS) {
    const was = verified.baseline.config[field] ?? null;
    if (canonical(was) === canonical(config[field] ?? null)) continue;
    const entry = { field, currentSha256: shaJson(config[field] ?? null), restoredSha256: shaJson(was) };
    if (Array.isArray(was) && Array.isArray(config[field])) {
      entry.added = config[field].filter((x) => !was.includes(x));
      entry.removed = was.filter((x) => !config[field].includes(x));
    }
    configFields.push(entry);
  }
  const compareOnly = COMPARE_ONLY_FIELDS.map((field) => ({
    field, differsFromBaseline: canonical(verified.baseline.config[field] ?? null) !== canonical(config[field] ?? null), action: 'preserve',
  }));
  const guarded = GUARDED_FIELDS.filter((field) => canonical(verified.baseline.config[field] ?? null) !== canonical(config[field] ?? null));
  if (guarded.length) {
    return { status: 'NEEDS_REVIEW', ...base, reason: `${guarded.join(', ')} 값이 사본과 다릅니다. 덮어쓰지 않고 멈춥니다(복구 경로 보호)`, compareOnly };
  }

  const plan = {
    schema: PLAN_SCHEMA,
    baseline: { id: TRUSTED_BASELINE.id, commit: TRUSTED_BASELINE.commit, manifestSha256: TRUSTED_BASELINE.manifestSha256, provenance: verified.provenance },
    current: { policyFiles: current, configSha256: shaRaw(configRaw) },
    targets: { files: files.map(({ path, currentSha256, restoredSha256, status }) => ({ path, currentSha256, restoredSha256, status })),
      configFields: configFields.map(({ field, currentSha256, restoredSha256 }) => ({ field, currentSha256, restoredSha256 })) },
    rules: { restoreFields: RESTORE_FIELDS, compareOnlyFields: COMPARE_ONLY_FIELDS, guardedFields: GUARDED_FIELDS, preservedPaths: PRESERVED_PATHS },
    auditLog: AUDIT_LOG,
  };
  const planDigest = createHash('sha256').update(canonical(plan), 'utf8').digest('hex');
  return {
    status: files.length || configFields.length ? 'READY_TO_APPLY' : 'NOTHING_TO_RESTORE',
    ...base, provenance: verified.provenance, planDigest,
    targets: { files, configFields },
    preserved: { compareOnly, otherConfigFields: Object.keys(config).filter((k) => !RESTORE_FIELDS.includes(k)), paths: PRESERVED_PATHS },
    postChecks: ['되돌린 대상이 사본과 같음', '보존 칸·보존 파일 지문 그대로', '감사 기록 앞 줄 보존', '판정기·탐지기 연습 시험', '소유자 확인(B→A 403, A 허용)'],
  };
}

// ---------- 감사 기록(덧붙이기만, 해시 체인) ----------
export function readAuditLog(root) {
  const full = join(root, AUDIT_LOG);
  if (!existsSync(full)) return { ok: true, entries: [], lastHash: null };
  const text = readFileSync(full, 'utf8');
  if (text && !text.endsWith('\n')) return { ok: false, reason: '감사 기록 끝이 잘려 있습니다' };
  const entries = [];
  let prev = null;
  for (const line of text.split('\n').filter(Boolean)) {
    let entry;
    try { entry = JSON.parse(line); } catch { return { ok: false, reason: '감사 기록에 읽을 수 없는 줄이 있습니다' }; }
    const { hash, ...body } = entry;
    if (body.prevHash !== prev || hash !== shaJson(body)) return { ok: false, reason: '감사 기록의 해시 체인이 끊겼습니다' };
    entries.push(entry); prev = hash;
  }
  return { ok: true, entries, lastHash: prev };
}
function appendAudit(root, state, body) {
  const entry = { seq: state.entries.length + 1, at: new Date().toISOString(), ...body, prevHash: state.lastHash };
  const full = { ...entry, hash: shaJson(entry) };
  mkdirSync(dirname(join(root, AUDIT_LOG)), { recursive: true });
  appendFileSync(join(root, AUDIT_LOG), `${JSON.stringify(full)}\n`, 'utf8');
  state.entries.push(full); state.lastHash = full.hash;
}

function writeAtomic(root, path, data) {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  const temp = `${full}.restore-tmp`;
  writeFileSync(temp, data);
  renameSync(temp, full);
}

function runNodeCheck(root, script) {
  try {
    execFileSync(process.execPath, [join(root, script)], { cwd: root, timeout: 60000, stdio: 'ignore', windowsHide: true });
    return true;
  } catch { return false; }
}

// ---------- 실행 ----------
export async function applyRestorePlan(root, planDigest, { useGit = true, runRegression = true, failAfterWrites = null } = {}) {
  root = resolve(root);
  const plan = buildRestorePlan(root, { useGit });
  const refuse = (reason) => ({ status: 'REFUSED', reason, writeCount: 0, planStatus: plan.status });
  if (plan.status !== 'READY_TO_APPLY') return refuse(plan.reason ?? (plan.status === 'NOTHING_TO_RESTORE' ? '되돌릴 항목이 없습니다' : plan.status));
  if (typeof planDigest !== 'string' || planDigest !== plan.planDigest) return refuse('계획 지문이 다릅니다. 미리보기 뒤에 파일이 바뀌었을 수 있으니 다시 미리보기를 확인하세요');
  const audit = readAuditLog(root);
  if (!audit.ok) return refuse(`${audit.reason}. 감사 기록을 고치지 않고 멈춥니다`);

  const verified = verifyBaseline(root, { useGit });
  if (!verified.ok) return refuse(verified.reason);
  const runId = randomUUID();
  const preservedBefore = preservedFingerprint(root);
  const { raw: configRaw, config } = readConfig(root);
  const auditBefore = existsSync(join(root, AUDIT_LOG)) ? readFileSync(join(root, AUDIT_LOG), 'utf8') : '';

  // 쓸 내용 준비(아직 쓰지 않음)
  const writes = [];
  for (const target of plan.targets.files) {
    const raw = readRaw(root, target.path);
    writes.push({ path: target.path, before: raw, after: Buffer.from(withEol(verified.baseline.files[target.path], usesCrlf(raw)), 'utf8') });
  }
  if (plan.targets.configFields.length) {
    const next = { ...config };
    for (const { field } of plan.targets.configFields) next[field] = verified.baseline.config[field] ?? null;
    writes.push({ path: 'aleph.config.json', before: configRaw, after: Buffer.from(withEol(`${JSON.stringify(next, null, 2)}\n`, usesCrlf(configRaw)), 'utf8') });
  }
  const summary = {
    runId, baselineId: TRUSTED_BASELINE.id, baselineCommit: TRUSTED_BASELINE.commit, planDigest,
    files: plan.targets.files.map((t) => ({ path: t.path, beforeSha256: t.currentSha256, afterSha256: t.restoredSha256 })),
    configFields: plan.targets.configFields.map((t) => t.field),
  };

  try { appendAudit(root, audit, { event: 'restore_started', ...summary }); } catch {
    return refuse('감사 시작 기록을 쓸 수 없어 실행하지 않았습니다');
  }
  writeFileSync(join(root, JOURNAL), JSON.stringify({ runId, planDigest, originals: writes.map((w) => ({ path: w.path, existed: w.before !== null, base64: w.before?.toString('base64') ?? null })) }));

  let written = 0;
  try {
    for (const w of writes) {
      if (failAfterWrites !== null && written >= failAfterWrites) throw new Error('simulated_failure');
      writeAtomic(root, w.path, w.after); written += 1;
    }
  } catch (error) {
    for (const w of writes.slice(0, written).reverse()) {
      if (w.before === null) rmSync(join(root, w.path), { force: true }); else writeAtomic(root, w.path, w.before);
    }
    rmSync(join(root, JOURNAL), { force: true });
    appendAudit(root, audit, { event: 'restore_rolled_back', runId, planDigest, writtenBeforeFailure: written, reason: error.message === 'simulated_failure' ? 'simulated_failure' : 'write_failed' });
    return { status: 'ROLLED_BACK', reason: '쓰는 중 실패해 바꾼 파일을 원래대로 되돌렸습니다', writeCount: 0, runId };
  }
  rmSync(join(root, JOURNAL), { force: true });

  // 사후 확인
  const checks = {};
  const after = verifyBaseline(root, { useGit });
  checks.baselineStillVerified = after.ok;
  checks.restoredTargetsMatch = plan.targets.files.every((t) => lf(readFileSync(join(root, t.path), 'utf8')) === verified.baseline.files[t.path]);
  const { config: configAfter } = readConfig(root);
  checks.restoredFieldsMatch = plan.targets.configFields.every(({ field }) => canonical(configAfter?.[field] ?? null) === canonical(verified.baseline.config[field] ?? null));
  checks.preservedConfigUnchanged = configAfter !== null && Object.keys(config).filter((k) => !RESTORE_FIELDS.includes(k))
    .every((k) => canonical(configAfter[k] ?? null) === canonical(config[k] ?? null))
    && Object.keys(configAfter).length === Object.keys(config).length;
  const preservedAfter = preservedFingerprint(root);
  checks.preservedPathsUnchanged = canonical(preservedAfter) === canonical(preservedBefore);
  const auditNow = readFileSync(join(root, AUDIT_LOG), 'utf8');
  checks.auditHistoryPreserved = auditNow.startsWith(auditBefore) && readAuditLog(root).ok;
  checks.policyFilesMatchBaseline = POLICY_FILES.every((p) => existsSync(join(root, p)) && lf(readFileSync(join(root, p), 'utf8')) === verified.baseline.files[p]);
  if (runRegression) {
    checks.deciderPractice = runNodeCheck(root, 'scripts/decider-test.mjs');
    checks.detectPractice = runNodeCheck(root, 'scripts/detect-test.mjs');
    checks.ownerCheck = runNodeCheck(root, 'scripts/owner-check.mjs');
  }
  const passed = Object.values(checks).every(Boolean);
  appendAudit(root, audit, { event: passed ? 'restore_completed' : 'restore_postcheck_failed', runId, planDigest, checks });
  return { status: passed ? 'RESTORED' : 'POSTCHECK_FAILED', runId, writeCount: written, restored: summary, checks, auditLog: AUDIT_LOG };
}

export const restoreRelativePath = (root, full) => relative(resolve(root), full);
