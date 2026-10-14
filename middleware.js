// 11단계 · Vercel 라우팅 미들웨어: 메모·복구 API 앞에서 승인된 기기의 요청 서명을 확인합니다.
// 규칙은 src/device-gate.mjs, 서명 문자열은 src/device-proof.mjs에 있습니다.
import { next } from '@vercel/functions';
import { createDeviceGate } from './src/device-gate.mjs';

export const config = {
  runtime: 'nodejs',
  matcher: ['/api/notes', '/api/notes/:path*', '/api/notes.js', '/api/restore', '/api/restore/:path*', '/api/restore.js'],
};

const gate = createDeviceGate();

export default async function middleware(request) {
  try {
    const denied = await gate(request);
    return denied ?? next();
  } catch {
    // 검사 중 오류가 나면 열지 않고 닫습니다.
    return Response.json({ error: 'DEVICE_CHECK_FAILED' }, { status: 403, headers: { 'cache-control': 'no-store' } });
  }
}
