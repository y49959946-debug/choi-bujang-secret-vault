// 10단계 제작 1 · 안전 정책 차이 보기 (읽기 전용)
//
// 침해 전에 검증한 안전 정책 사본(recovery/baselines/step9)과 현재 작업 폴더의 시험 정책을 비교해
// 차이만 보여 줍니다. 아무것도 복원하거나 고치지 않습니다.
//   - 쓰기 0건: 파일·Git·DB에 쓰지 않습니다. 운영 정책(Supabase RLS, Vercel 배포)에는 접속하지 않습니다.
//   - 네트워크 0건: 외부로 요청을 보내지 않습니다.
//   - 현재 정책 파일은 import로 실행하지 않고 글자로만 읽습니다(변조된 코드가 실행되지 않게).
//   - 사본이 없거나 검증에 실패하면 비교하지 않고 INVALID_BASELINE으로 멈춥니다.
//     현재 파일로 사본을 새로 만들어 대신 쓰는 일은 하지 않습니다.
//
// 검증 세 겹
//   1) 형식·범위: manifest의 스키마, 기준 ID·커밋, 파일 목록이 아래 고정값과 정확히 같아야 합니다.
//   2) 무결성: 사본 파일마다 SHA-256(줄바꿈을 LF로 맞춘 내용)이 manifest 값과 같아야 하고,
//      manifest 자체의 SHA-256도 아래 고정 지문과 같아야 합니다.
//   3) 출처: Git 기록을 읽을 수 있으면, 사본이 기준 커밋의 실제 파일 내용과 같은지 대조합니다.
//      사본과 지문을 함께 바꿔도 여기서 걸립니다. Git 기록이 없으면 고정 지문까지만 확인했다고 표시합니다.
//
// 메모 본문·토큰·서버 키는 정책 파일에 없으며, 차이 줄에 비밀값처럼 보이는 내용이 있으면 표시하지 않습니다.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, normalize, resolve, sep } from 'node:path';

export const TRUSTED_BASELINE = Object.freeze({
  id: 'step9-195d38a',
  commit: '195d38a4fde5872fe84766328612896dbae14dcb',
  dir: 'recovery/baselines/step9',
  // manifest.json(LF로 맞춘 내용)의 SHA-256. manifest를 고치면 여기와 달라져 검증에 실패합니다.
  manifestSha256: 'df2fd9b1c2c3cadf90d67e182863a616209c7bb5e166abf86e9aed3b057d1c60',
});

// 안전 정책으로 보는 파일(이 목록 밖의 경로는 읽지 않습니다)
export const POLICY_FILES = Object.freeze([
  'src/decider.mjs',
  'src/resources.mjs',
  'src/verify-login.mjs',
  'api/notes.js',
  'supabase/notes-step4-rls.sql',
  'supabase/notes-step5-revoke.sql',
]);
// aleph.config.json에서 안전 정책으로 보는 칸(step·repoUrl·publicAppUrl·sampleMarker는 정책이 아니라 비교하지 않음)
export const POLICY_CONFIG_FIELDS = Object.freeze([
  'allowedRoutes', 'identityProvider', 'judgeIssuer', 'originalApiUrl', 'restoreRoute',
]);
const CONFIG_BASELINE_PATH = 'policy/config/policy-fields.json';
const MANIFEST_SCHEMA = 'aleph.policy-baseline.v1';
const SECRET = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/-]{16,}|\bsb_secret_[A-Za-z0-9_-]{12,}|\bsk-[A-Za-z0-9_-]{20,}|\beyJ[A-Za-z0-9_-]{12,}\.eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}/u;
const MAX_LINES_PER_FILE = 40;

const lf = (text) => text.replace(/^﻿/u, '').replace(/\r\n?/gu, '\n');
const sha256 = (text) => createHash('sha256').update(lf(text), 'utf8').digest('hex');

// root 밖으로 나가는 경로는 거부합니다.
function inside(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\0')) return null;
  const full = resolve(root, normalize(relative));
  return full === root || full.startsWith(root + sep) ? full : null;
}
function readText(root, relative) {
  const full = inside(root, relative);
  if (!full || !existsSync(full)) return null;
  return lf(readFileSync(full, 'utf8'));
}
const pickFields = (config) => Object.fromEntries(POLICY_CONFIG_FIELDS.map((key) => [key, config?.[key] ?? null]));
const canonical = (value) => `${JSON.stringify(value, null, 2)}\n`;

function git(root, args) {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8', timeout: 5000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
    });
  } catch {
    return null;
  }
}

// ---------- 1) 사본 검증 ----------
export function verifyBaseline(root, { useGit = true } = {}) {
  root = resolve(root);
  const fail = (reason) => ({ ok: false, reason });
  const dir = inside(root, TRUSTED_BASELINE.dir);
  if (!dir || !existsSync(dir)) return fail('사본 폴더가 없습니다');
  const manifestText = readText(root, `${TRUSTED_BASELINE.dir}/manifest.json`);
  if (manifestText === null) return fail('manifest.json이 없습니다');
  if (sha256(manifestText) !== TRUSTED_BASELINE.manifestSha256) return fail('manifest 지문이 고정 지문과 다릅니다');

  let manifest;
  try { manifest = JSON.parse(manifestText); } catch { return fail('manifest 형식이 틀렸습니다'); }
  if (manifest?.schema !== MANIFEST_SCHEMA || manifest.baselineId !== TRUSTED_BASELINE.id
      || manifest.sourceCommit !== TRUSTED_BASELINE.commit) return fail('manifest의 스키마·기준 ID·커밋이 다릅니다');
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const paths = files.map((item) => item?.path);
  if (paths.length !== POLICY_FILES.length || POLICY_FILES.some((path, i) => paths[i] !== path)) {
    return fail('manifest 파일 목록이 허용된 정책 파일과 다릅니다');
  }
  if (JSON.stringify(manifest.configFields?.fields) !== JSON.stringify(POLICY_CONFIG_FIELDS)
      || manifest.configFields?.baselinePath !== CONFIG_BASELINE_PATH) return fail('manifest 설정 칸 목록이 다릅니다');

  const baseline = { files: {}, config: null };
  for (const item of files) {
    if (item.baselinePath !== `policy/${item.path}`) return fail(`사본 경로가 틀렸습니다: ${item.path}`);
    const text = readText(dir, item.baselinePath);
    if (text === null) return fail(`사본 파일이 없습니다: ${item.path}`);
    if (sha256(text) !== item.sha256) return fail(`사본 파일 지문이 다릅니다: ${item.path}`);
    baseline.files[item.path] = text;
  }
  const configText = readText(dir, CONFIG_BASELINE_PATH);
  if (configText === null) return fail('설정 칸 사본이 없습니다');
  if (sha256(configText) !== manifest.configFields.sha256) return fail('설정 칸 사본 지문이 다릅니다');
  try { baseline.config = JSON.parse(configText); } catch { return fail('설정 칸 사본 형식이 틀렸습니다'); }

  // 3) 출처: 기준 커밋의 실제 내용과 대조
  let provenance = 'pinned_digest_only';
  if (useGit && git(root, ['rev-parse', '--is-inside-work-tree'])?.trim() === 'true') {
    if (git(root, ['cat-file', '-e', `${TRUSTED_BASELINE.commit}^{commit}`]) === null) {
      return fail('Git 기록에 기준 커밋이 없습니다');
    }
    for (const path of POLICY_FILES) {
      const original = git(root, ['show', `${TRUSTED_BASELINE.commit}:${path}`]);
      if (original === null || lf(original) !== baseline.files[path]) return fail(`사본이 기준 커밋의 내용과 다릅니다: ${path}`);
    }
    const originalConfig = git(root, ['show', `${TRUSTED_BASELINE.commit}:aleph.config.json`]);
    let parsed = null;
    try { parsed = JSON.parse(originalConfig); } catch { /* 아래에서 실패 */ }
    if (!parsed || canonical(pickFields(parsed)) !== canonical(baseline.config)) return fail('설정 칸 사본이 기준 커밋과 다릅니다');
    provenance = 'git_commit_verified';
  }
  return { ok: true, manifest, baseline, provenance };
}

// ---------- 2) 차이 계산 ----------
// 줄 단위 차이(LCS). 바뀐 구간마다 기준 줄 번호·현재 줄 번호와 빠진 줄·더해진 줄을 돌려줍니다.
function lineDiff(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  const n = a.length; const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) for (let j = m - 1; j >= 0; j -= 1) {
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const hunks = []; let hunk = null; let i = 0; let j = 0;
  const open = () => { hunk ??= { baselineLine: i + 1, currentLine: j + 1, removed: [], added: [] }; };
  const close = () => { if (hunk) { hunks.push(hunk); hunk = null; } };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { close(); i += 1; j += 1; }
    else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) { open(); hunk.added.push(b[j]); j += 1; }
    else { open(); hunk.removed.push(a[i]); i += 1; }
  }
  close();
  return hunks;
}
const hide = (line) => (SECRET.test(line) ? '(비밀값처럼 보이는 줄이라 표시하지 않음)' : line);

// 판정기의 규칙 이름과 구역 표를 글자에서 뽑아 규칙 단위 차이를 보여 줍니다(코드 실행 없음).
function deciderShape(text) {
  const ruleBlock = /export const RULE_IDS = Object\.freeze\(\[([\s\S]*?)\]\)/u.exec(text)?.[1] ?? '';
  const rules = [...ruleBlock.matchAll(/'([^']+)'/gu)].map((m) => m[1]);
  const routes = Object.fromEntries([...text.matchAll(/'((?:GET|POST|PUT|PATCH|DELETE) \/[^']*)':\s*'([a-z_]+)'/gu)]
    .map((m) => [m[1], m[2]]));
  return { rules, routes };
}
function setDiff(before, after) {
  return { added: after.filter((x) => !before.includes(x)), removed: before.filter((x) => !after.includes(x)) };
}

export function diffPolicy(root, { useGit = true } = {}) {
  root = resolve(root);
  const verified = verifyBaseline(root, { useGit });
  const base = {
    mode: 'READ_ONLY',
    baseline: { id: TRUSTED_BASELINE.id, commit: TRUSTED_BASELINE.commit, dir: TRUSTED_BASELINE.dir },
    current: { source: 'working_tree' },
    writeCount: 0, networkCallCount: 0, restoreOperations: 0,
  };
  if (!verified.ok) {
    return { status: 'INVALID_BASELINE', ...base, baseline: { ...base.baseline, verified: false, reason: verified.reason }, changes: [] };
  }
  base.baseline.verified = true;
  base.baseline.provenance = verified.provenance;
  if (useGit) {
    const head = git(root, ['rev-parse', 'HEAD'])?.trim();
    if (head) base.current.commit = head;
    const dirty = git(root, ['status', '--porcelain', '--', ...POLICY_FILES]); // 설정 파일은 칸별로 따로 비교(step 변경은 정책 아님)
    if (dirty !== null) base.current.policyFilesUncommitted = dirty.trim().length > 0;
  }

  const changes = [];
  for (const path of POLICY_FILES) {
    const before = verified.baseline.files[path];
    const after = readText(root, path);
    if (after === null) { changes.push({ kind: 'file', path, status: 'MISSING' }); continue; }
    if (after === before) continue;
    const hunks = lineDiff(before, after);
    let shown = 0;
    const change = {
      kind: 'file', path, status: 'MODIFIED',
      baselineSha256: sha256(before), currentSha256: sha256(after),
      linesRemoved: hunks.reduce((s, h) => s + h.removed.length, 0),
      linesAdded: hunks.reduce((s, h) => s + h.added.length, 0),
      hunks: hunks.map((h) => {
        const take = (lines) => { const out = lines.slice(0, Math.max(0, MAX_LINES_PER_FILE - shown)).map(hide); shown += out.length; return out; };
        return { baselineLine: h.baselineLine, currentLine: h.currentLine, removed: take(h.removed), added: take(h.added) };
      }),
    };
    if (path === 'src/decider.mjs') {
      const was = deciderShape(before); const now = deciderShape(after);
      const routeKeys = [...new Set([...Object.keys(was.routes), ...Object.keys(now.routes)])];
      change.rules = setDiff(was.rules, now.rules);
      change.zoneRoutes = {
        added: routeKeys.filter((k) => !(k in was.routes)).map((k) => `${k} → ${now.routes[k]}`),
        removed: routeKeys.filter((k) => !(k in now.routes)).map((k) => `${k} → ${was.routes[k]}`),
        changed: routeKeys.filter((k) => k in was.routes && k in now.routes && was.routes[k] !== now.routes[k])
          .map((k) => `${k}: ${was.routes[k]} → ${now.routes[k]}`),
      };
    }
    changes.push(change);
  }

  const configText = readText(root, 'aleph.config.json');
  let currentConfig = null;
  try { currentConfig = configText === null ? null : JSON.parse(configText); } catch { currentConfig = null; }
  if (currentConfig === null) {
    changes.push({ kind: 'config', path: 'aleph.config.json', status: configText === null ? 'MISSING' : 'UNREADABLE' });
  } else {
    const now = pickFields(currentConfig);
    for (const field of POLICY_CONFIG_FIELDS) {
      const was = verified.baseline.config[field] ?? null;
      if (canonical(was) === canonical(now[field])) continue;
      const entry = { kind: 'config', path: 'aleph.config.json', field, status: 'MODIFIED' };
      if (Array.isArray(was) && Array.isArray(now[field])) Object.assign(entry, setDiff(was, now[field]));
      else Object.assign(entry, { baseline: was, current: now[field] });
      changes.push(entry);
    }
  }

  return {
    status: changes.length ? 'CHANGES_DETECTED' : 'UNCHANGED',
    ...base,
    changes,
    restorePreview: {
      targetBaseline: TRUSTED_BASELINE.id,
      candidateFiles: [...new Set(changes.filter((c) => c.kind === 'file').map((c) => c.path))],
      candidateConfigFields: changes.filter((c) => c.kind === 'config' && c.field).map((c) => c.field),
      applied: false,
    },
  };
}

export const policyDigest = sha256;
