// 11단계 제작 1 · 설치형 웹앱 설정(manifest)·오프라인 안내·기기 승인 상태 표시 시험 (로컬, 배포·심판 판정 아님)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import vm from 'node:vm';

const repo = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(join(repo, path), 'utf8');
const pngSize = (path) => { const b = readFileSync(join(repo, 'public', path)); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test('manifest: 앱 이름·시작 주소·설치 화면·아이콘이 있고, 설치가 기기 확인이라고 쓰지 않는다', () => {
  const m = JSON.parse(read('public/manifest.webmanifest'));
  assert.equal(m.name, 'BYTE BACK 내 자료실');
  assert.equal(m.short_name, '내 자료실');
  assert.equal(m.start_url, '/');
  assert.equal(m.scope, '/');
  assert.equal(m.display, 'standalone');
  assert.match(m.description, /설치해도 기기 확인이 끝난 것은 아닙니다/u);
  for (const icon of m.icons) {
    assert.ok(existsSync(join(repo, 'public', icon.src)), `${icon.src} 파일 있음`);
    assert.equal(pngSize(icon.src).join('x'), icon.sizes, `${icon.src} 크기`);
  }
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
});

test('화면: manifest를 연결하고, 기기 승인은 서버 결과 전까지 "확인되지 않음"으로 표시한다', () => {
  const html = read('public/index.html');
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/u);
  assert.match(html, /id="device-approval">확인되지 않음/u);
  assert.match(html, /앱으로 설치했다는 표시만으로는 기기 확인이 끝나지 않습니다/u);
  assert.match(html, /설치한 앱 화면으로 열림\(기기 확인은 아님\)/u);
  assert.doesNotMatch(html, /(설치|install)[^<\n]{0,20}(승인됨|확인 완료|verified)/iu, '설치를 승인·확인으로 쓰지 않음');
  // 기기 키·승인 정보를 브라우저 저장소에 넣지 않음(기존 로그인 보관 키 외에 새 저장 없음)
  const sets = [...html.matchAll(/localStorage\.setItem\(([^,]+),/gu)].map((m) => m[1].trim());
  assert.deepEqual(sets, ['SESSION_KEY']);
  assert.doesNotMatch(html, /indexedDB|sessionStorage/u);
});

test('오프라인 안내: 화면이 있고 자료를 기기에 저장하지 않는다고 알린다', () => {
  const html = read('public/offline.html');
  assert.match(html, /메모를 기기에 저장해 두지 않고/u);
  assert.match(html, /설치했다는 표시만으로는 기기 확인이 끝나지 않습니다/u);
});

// 서비스 워커를 가짜 브라우저 환경에서 실제로 실행합니다.
function loadWorker({ online = true } = {}) {
  const listeners = {}; const stored = new Map(); const puts = [];
  const cache = {
    addAll: async (list) => { list.forEach((u) => stored.set(u, `cached:${u}`)); },
    put: async (k) => { puts.push(k); },
  };
  const context = {
    self: { location: { origin: 'https://app.example' }, addEventListener: (t, f) => { listeners[t] = f; }, skipWaiting: async () => {}, clients: { claim: async () => {} } },
    caches: {
      open: async () => cache, keys: async () => [], delete: async () => true,
      match: async (req) => stored.get(typeof req === 'string' ? req : new URL(req.url).pathname) ?? undefined,
    },
    fetch: async (req) => { if (!online) throw new TypeError('offline'); return `network:${typeof req === 'string' ? req : req.url}`; },
    URL, Promise,
  };
  vm.runInNewContext(read('public/sw.js'), context);
  const fire = async (url, { method = 'GET', mode = 'cors' } = {}) => {
    let responded = null;
    await listeners.fetch({ request: { url, method, mode }, respondWith: (p) => { responded = p; } });
    return responded ? await responded : 'not-intercepted';
  };
  return { listeners, stored, puts, fire, install: () => new Promise((done) => listeners.install({ waitUntil: (p) => p.then(done) })) };
}

test('서비스 워커: /api 요청·쓰기 요청은 가로채지 않고, 저장한 것은 안내 화면과 아이콘뿐이다', async () => {
  const w = loadWorker();
  await w.install();
  assert.deepEqual([...w.stored.keys()].sort(), ['/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png', '/manifest.webmanifest', '/offline.html']);
  assert.equal(await w.fire('https://app.example/api/notes'), 'not-intercepted');
  assert.equal(await w.fire('https://app.example/api/notes/abc', { mode: 'navigate' }), 'not-intercepted');
  assert.equal(await w.fire('https://app.example/api/restore', { method: 'POST' }), 'not-intercepted');
  assert.equal(await w.fire('https://other.example/x'), 'not-intercepted');
  assert.equal(w.puts.length, 0, '실행 중에 아무것도 새로 저장하지 않음');
});

test('서비스 워커: 화면은 항상 서버에서 받고, 연결이 끊겼을 때만 오프라인 안내를 보여 준다', async () => {
  const on = loadWorker({ online: true }); await on.install();
  assert.equal(await on.fire('https://app.example/', { mode: 'navigate' }), 'network:https://app.example/');
  const off = loadWorker({ online: false }); await off.install();
  assert.equal(await off.fire('https://app.example/', { mode: 'navigate' }), 'cached:/offline.html');
  assert.equal(await off.fire('https://app.example/api/notes'), 'not-intercepted', '오프라인이어도 자료 요청을 꾸며 내지 않음');
});
