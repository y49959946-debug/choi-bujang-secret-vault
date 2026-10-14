// npm run policy:diff [-- --json]
// 침해 전에 검증한 안전 정책 사본과 현재 작업 폴더의 시험 정책 차이만 보여 줍니다. 아무것도 복원하거나 고치지 않습니다.
// 사본이 없거나 검증에 실패하면 비교하지 않고 종료 코드 1로 멈춥니다.
import { resolve } from 'node:path';
import { diffPolicy } from '../src/policy-diff.mjs';

const root = resolve(import.meta.dirname, '..');
const report = diffPolicy(root);
if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  const out = [];
  out.push('BYTE BACK · 안전 정책 차이 보기 (READ_ONLY)', '');
  out.push('[복원할 기준 버전]');
  out.push(`  기준: ${report.baseline.id}`, `  기준 커밋: ${report.baseline.commit}`, `  사본 위치: ${report.baseline.dir}`);
  if (report.status === 'INVALID_BASELINE') {
    out.push(`  검증: 실패 — ${report.baseline.reason}`, '', '사본을 믿을 수 없어 비교하지 않고 멈춥니다. 아무것도 바꾸지 않았습니다.');
    process.stdout.write(`${out.join('\n')}\n`);
    process.exit(1);
  }
  out.push(`  검증: 통과 (${report.baseline.provenance === 'git_commit_verified' ? '지문 + 기준 커밋 내용 대조' : '지문만, Git 기록 없음'})`, '');
  out.push('[현재 시험 정책]', '  출처: 작업 폴더(working_tree) — 배포된 운영 정책이나 Supabase 실제 RLS가 아닙니다');
  if (report.current.commit) out.push(`  현재 커밋: ${report.current.commit}`);
  if (report.current.policyFilesUncommitted !== undefined) out.push(`  커밋 안 된 정책 변경: ${report.current.policyFilesUncommitted ? '있음' : '없음'}`);
  out.push('', `[변경 범위] ${report.status === 'UNCHANGED' ? '차이 없음' : `${report.changes.length}곳`}`);
  report.changes.forEach((c, n) => {
    if (c.kind === 'file') {
      out.push(`  ${n + 1}. ${c.path} — ${c.status}${c.status === 'MODIFIED' ? ` (줄 -${c.linesRemoved} +${c.linesAdded})` : ''}`);
      if (c.rules && (c.rules.added.length || c.rules.removed.length)) out.push(`     규칙 이름: +[${c.rules.added.join(', ')}] -[${c.rules.removed.join(', ')}]`);
      if (c.zoneRoutes) for (const [k, label] of [['added', '구역 경로 추가'], ['removed', '구역 경로 삭제'], ['changed', '구역 바뀜']]) {
        for (const item of c.zoneRoutes[k]) out.push(`     ${label}: ${item}`);
      }
      for (const h of c.hunks ?? []) {
        out.push(`     @@ 기준 ${h.baselineLine}줄 / 현재 ${h.currentLine}줄`);
        for (const line of h.removed) out.push(`     - ${line}`);
        for (const line of h.added) out.push(`     + ${line}`);
      }
    } else if (c.field) {
      const detail = 'added' in c ? `추가 [${c.added.join(', ')}] 삭제 [${c.removed.join(', ')}]`
        : `기준 ${JSON.stringify(c.baseline)} → 현재 ${JSON.stringify(c.current)}`;
      out.push(`  ${n + 1}. aleph.config.json · ${c.field} — ${detail}`);
    } else {
      out.push(`  ${n + 1}. ${c.path} — ${c.status}`);
    }
  });
  out.push('', '[복원 미리보기 — 실행하지 않음]');
  out.push(`  기준: ${report.restorePreview.targetBaseline}`);
  out.push(`  되돌릴 후보 파일: ${report.restorePreview.candidateFiles.join(', ') || '없음'}`);
  out.push(`  되돌릴 후보 설정 칸: ${report.restorePreview.candidateConfigFields.join(', ') || '없음'}`);
  out.push('', `쓰기 ${report.writeCount}건 · 외부 요청 ${report.networkCallCount}건 · 복원 ${report.restoreOperations}건. 아무것도 바꾸지 않았습니다.`);
  process.stdout.write(`${out.join('\n')}\n`);
}
if (report.status === 'INVALID_BASELINE') process.exitCode = 1;
