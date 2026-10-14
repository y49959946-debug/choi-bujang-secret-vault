// 메모 소유자 키 계산(서버가 검증한 신원으로만 계산합니다).
// api/notes.js와 같은 규칙입니다. api/notes.js는 9단계 안전 정책 사본 대상이라 이번에는 고치지 않고,
// test/restore.test.mjs가 두 계산 결과가 같은지(메모 API로 만든 메모를 이 키로 복원할 수 있는지) 확인합니다.
//   - 학생 토큰: 검증된 sub(소문자)
//   - 심판 토큰: sub·runId·identity(a/b)를 묶은 고정 UUID(같은 sub라도 A와 B를 다른 주인으로 구분)
import { createHash } from 'node:crypto';

export function ownerKeyOf(identity) {
  const sub = String(identity.userId).toLowerCase();
  if (identity.kind !== 'judge') return sub;
  const h = createHash('sha256').update(`judge|${sub}|${identity.runId}|${identity.identity}`).digest('hex');
  const variant = ((parseInt(h[16], 16) & 3) | 8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
