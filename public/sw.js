// 11단계 · 설치형 웹앱의 오프라인 안내 전용 서비스 워커
// - 오프라인 안내 화면(offline.html)과 아이콘만 미리 저장합니다.
// - /api/* 요청, 메모 자료, 로그인 정보(토큰)는 저장하지도, 가로채 바꾸지도 않습니다. 브라우저가 그대로 서버로 보냅니다.
// - 화면(페이지) 요청은 항상 서버에서 새로 받고, 연결이 끊겼을 때만 오프라인 안내를 보여 줍니다.
// - 이 파일은 기기를 확인하지 않습니다. 기기 승인 여부는 서버와 판정기가 정합니다.
const CACHE = 'byteback-shell-v1';
const SHELL = ['/offline.html', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || request.method !== 'GET') return; // 다른 주소·쓰기 요청은 손대지 않음
  if (url.pathname.startsWith('/api/')) return; // 자료 API는 저장·가로채기 없이 그대로 서버로
  if (request.mode === 'navigate') {
    // 화면은 항상 서버에서 받음(저장하지 않음). 연결이 끊겼을 때만 오프라인 안내.
    event.respondWith(fetch(request).catch(() => caches.match('/offline.html')));
    return;
  }
  if (SHELL.includes(url.pathname)) {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
  }
});
