// Service Worker читалки.
// __BUILD_ID__ и __SHELL_FILES__ подставляются при сборке (build.mjs).
const BUILD = '__BUILD_ID__';
const SHELL_CACHE = 'shell-' + BUILD;
const CONTENT_CACHE = 'content-v1';
const SHELL_FILES = __SHELL_FILES__;

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(c => c.addAll(SHELL_FILES.map(f => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(k => k.startsWith('shell-') && k !== SHELL_CACHE)
        .map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data === 'build-id' && event.ports[0]) event.ports[0].postMessage(BUILD);
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Контент (главы, глоссарий, список глав): сначала сеть, офлайн — из кэша.
  if (url.pathname.includes('/content/')) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Навигация — всегда index.html оболочки (роутинг на #хэшах).
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html', { cacheName: SHELL_CACHE }).then(r => r || fetch(req))
    );
    return;
  }

  // Оболочка: из кэша текущей сборки.
  event.respondWith(
    caches.match(req, { cacheName: SHELL_CACHE, ignoreSearch: true }).then(r => r || fetch(req))
  );
});

async function networkFirst(req) {
  const cache = await caches.open(CONTENT_CACHE);
  try {
    const res = await fetch(req, { cache: 'no-cache' });
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    throw err;
  }
}
