/* 덕신교회 통합 포털 서비스워커
 * 포털 화면(/portal/)만 다룹니다. 금전출납부·재정보고·중보기도문 앱과
 * 구글 시트 동기화 요청은 손대지 않습니다(범위가 /portal/ 밖이라 애초에 오지 않습니다).
 */
const VERSION = 'deoksin-portal-v1.0.0';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './offline.html',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => Promise.allSettled(SHELL.map((u) => cache.add(new Request(u, { cache: 'reload' })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;           // 다른 출처는 그대로
  if (!url.pathname.startsWith(new URL('./', self.location.href).pathname)) return; // 포털 밖은 그대로

  // 화면 이동: 네트워크 우선 → 끊겼으면 저장본 → 없으면 오프라인 안내
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('./offline.html')))
    );
    return;
  }

  // 정적 파일: 저장본 우선, 없으면 받아서 저장
  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }))
  );
});
