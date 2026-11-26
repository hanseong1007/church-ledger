/* 덕신교회 부서업무 서비스워커
 * /edu/ 화면 파일만 캐시합니다. 구글 시트 동기화(script.google.com)는 손대지 않습니다.
 */
const VERSION = 'deoksin-edu-v5.0.1';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './core.js',
  './ui.js',
  './features.js',
  './extra.js',
  './school.js',
  './app.js',
  './jszip.min.js',
  './manifest.json',
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

/* 화면 파일은 '네트워크 먼저, 실패하면 캐시' — 새로 배포하면 바로 최신 화면이 열립니다. */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(new URL('./', self.location.href).pathname)) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
  );
});
