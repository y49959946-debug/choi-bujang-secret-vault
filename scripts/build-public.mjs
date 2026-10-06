import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deploymentIdentity } from './deployment-identity.mjs';

const root = resolve(import.meta.dirname, '..');
const config = JSON.parse(await readFile(resolve(root, 'aleph.config.json'), 'utf8'));
if (config.step !== 1) {
  throw new Error('1단계 이후에는 공개 data.json 복사를 끝내고 보호된 자료 API로 바꾸세요.');
}
// 2단계: 정적 data.json을 더 이상 배포하지 않습니다. 메모는 /api/notes 서버 함수가 읽습니다.
// 1단계 확인 표시가 정적 응답에 남지 않도록, 남아 있는 public/data.json도 빌드 결과에서 지웁니다.
await mkdir(resolve(root, 'public'), { recursive: true });
await rm(resolve(root, 'public', 'data.json'), { force: true });
console.log('정적 data.json은 배포하지 않습니다. 메모는 /api/notes에서 읽습니다.');
if (!process.argv.includes('--local')) {
  const identity = deploymentIdentity(process.env, config);
  // 5단계: 심판이 배포본에서 허용 경로를 볼 수 있도록 aleph.config.json의 allowedRoutes를 함께 기록합니다.
  // 경로 모양("GET /api/notes/:id")만 적고, 키·토큰 같은 값은 넣지 않습니다.
  const ROUTE = /^(GET|POST|PUT|PATCH|DELETE) \/[A-Za-z0-9_\-/:.]*$/u;
  const allowedRoutes = Array.isArray(config.allowedRoutes) ? config.allowedRoutes : [];
  if (!allowedRoutes.length || allowedRoutes.some((route) => typeof route !== 'string' || !ROUTE.test(route))) {
    throw new Error('aleph.config.json의 allowedRoutes를 "메서드 /경로" 모양으로 하나 이상 적어 주세요.');
  }
  // 5단계: 심판이 직접 요청을 시험할 원본 자료 주소도 함께 기록합니다. 쿼리 없는 HTTPS 경로만 받습니다.
  let originalApiUrl = null;
  if (config.originalApiUrl != null) {
    let url;
    try { url = new URL(config.originalApiUrl); } catch { url = null; }
    if (!url || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
        || url.href !== config.originalApiUrl) {
      throw new Error('aleph.config.json의 originalApiUrl은 쿼리·비밀값 없는 HTTPS 경로여야 합니다.');
    }
    originalApiUrl = url.href;
  }
  await writeFile(resolve(root, 'public', 'aleph.json'),
    `${JSON.stringify({ ...identity, allowedRoutes, originalApiUrl }, null, 2)}\n`, 'utf8');
  console.log(`배포 저장소·커밋·주소, 허용 경로 ${allowedRoutes.length}개, 원본 주소를 public/aleph.json에 기록했습니다.`);
}
