// npm run policy:restore                         → 미리보기만(쓰기 0건): 바뀔 항목과 계획 지문을 보여 줍니다.
// npm run policy:restore -- --apply --plan <지문> → 미리보기와 같은 계획일 때만 시험 정책을 사본으로 되돌립니다.
// 운영 정책(Supabase 실제 RLS, Vercel 배포)은 건드리지 않습니다. 되돌린 파일은 검토 후 커밋해야 배포됩니다.
import { resolve } from 'node:path';
import { applyRestorePlan, buildRestorePlan, AUDIT_LOG } from '../src/policy-restore.mjs';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const json = args.includes('--json');
const say = (lines) => process.stdout.write(`${lines.join('\n')}\n`);

if (args.includes('--apply')) {
  const digest = args[args.indexOf('--plan') + 1];
  const result = await applyRestorePlan(root, args.includes('--plan') ? digest : undefined);
  if (json) say([JSON.stringify(result, null, 2)]);
  else {
    const out = ['BYTE BACK · 안전 정책 되돌리기 (실행)', ''];
    out.push(`결과: ${result.status}`);
    if (result.reason) out.push(`이유: ${result.reason}`);
    if (result.restored) {
      out.push(`실행 ID: ${result.runId}`, `되돌린 파일: ${result.restored.files.map((f) => f.path).join(', ') || '없음'}`,
        `되돌린 설정 칸: ${result.restored.configFields.join(', ') || '없음'}`, '', '[사후 확인]');
      for (const [name, ok] of Object.entries(result.checks)) out.push(`  ${ok ? '통과' : '실패'} · ${name}`);
      out.push('', `감사 기록: ${AUDIT_LOG}에 덧붙였습니다. 되돌린 파일은 검토 후 커밋·푸시해야 배포됩니다.`);
    }
    say(out);
  }
  if (result.status !== 'RESTORED') process.exitCode = 1;
} else {
  const plan = buildRestorePlan(root);
  if (json) say([JSON.stringify(plan, null, 2)]);
  else {
    const out = ['BYTE BACK · 안전 정책 되돌리기 (미리보기 — 아무것도 바꾸지 않음)', ''];
    out.push('[복원할 버전]', `  ${plan.baselineId} (${plan.baselineCommit})`);
    out.push(`  상태: ${plan.status}${plan.provenance ? ` · 사본 검증 ${plan.provenance === 'git_commit_verified' ? '지문 + 기준 커밋 대조' : '지문만'}` : ''}`);
    if (plan.reason) out.push(`  이유: ${plan.reason}`);
    if (plan.targets) {
      out.push('', '[바뀔 항목]');
      if (!plan.targets.files.length && !plan.targets.configFields.length) out.push('  없음 — 시험 정책이 이미 사본과 같습니다');
      for (const f of plan.targets.files) {
        out.push(`  파일 전체 교체: ${f.path} (${f.status}${f.linesRemoved !== null ? `, 줄 -${f.linesRemoved} +${f.linesAdded}` : ''})`);
        if (f.rules && (f.rules.added.length || f.rules.removed.length)) out.push(`    규칙 이름 되돌림: 지울 것 [${f.rules.added.join(', ')}] 되살릴 것 [${f.rules.removed.join(', ')}]`);
        if (f.zoneRoutes) {
          for (const r of f.zoneRoutes.added) out.push(`    구역 경로 지움: ${r}`);
          for (const r of f.zoneRoutes.removed) out.push(`    구역 경로 되살림: ${r}`);
          for (const r of f.zoneRoutes.changed) out.push(`    구역 되돌림: ${r}`);
        }
      }
      for (const c of plan.targets.configFields) {
        out.push(`  설정 칸 되돌림: aleph.config.json · ${c.field}${c.added ? ` (지울 것 [${c.added.join(', ')}] 되살릴 것 [${c.removed.join(', ')}])` : ''}`);
      }
      out.push('', '[보존 — 바꾸지 않음]');
      for (const c of plan.preserved.compareOnly) out.push(`  ${c.field}: 운영 측 값이라 보존${c.differsFromBaseline ? ' (사본과 다름 — 운영 측에 확인하세요)' : ''}`);
      out.push(`  설정의 다른 칸: ${plan.preserved.otherConfigFields.filter((k) => k !== 'judgeIssuer').join(', ')}`);
      out.push(`  다른 서비스 규칙: ${plan.preserved.paths.join(', ')}`);
      out.push(`  감사 기록: ${AUDIT_LOG} (덧붙이기만)`);
      out.push('', '[실행 뒤 확인]', ...plan.postChecks.map((c) => `  - ${c}`));
      if (plan.status === 'READY_TO_APPLY') {
        out.push('', `계획 지문: ${plan.planDigest}`, '위 항목이 맞으면 다음으로 실행하세요:', `  npm run policy:restore -- --apply --plan ${plan.planDigest}`);
      }
    }
    out.push('', '쓰기 0건 · 외부 요청 0건.');
    say(out);
  }
  if (['INVALID_BASELINE', 'NEEDS_REVIEW'].includes(plan.status)) process.exitCode = 1;
}
