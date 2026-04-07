/**
 * Service Worker: offline caching for Report UAV PWA.
 */
const CACHE_NAME = 'uav-report-v15';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './config.json',
  './icon.png',
  './js/app.js',
  './js/db.js',
  './js/constants.js',
  './js/utils.js',
  './js/counter.js',
  './js/coords.js',
  './js/clipboard.js',
  './js/config.js',
  './js/report-format.js',
  './js/report-model.js',
  './js/reports-store.js',
  './js/settings-store.js',
  './js/sync-settings.js',
  './js/sync-queue-store.js',
  './js/google-sheets-api.js',
  './js/sync-service.js',
  './js/report-actions.js',
  './js/longPressEdit.js',
  './js/generate.js',
  './js/filters.js',
  './js/navigation.js',
  './js/result-mapping.js',
  './js/streams.js',
  './js/events.js',
  './js/crypto/crypto.js',
  './js/crypto/importExport.js',
  './js/screens/mainForm.js',
  './js/screens/journal.js',
  './js/screens/data.js',
  './js/screens/settings.js',
  './js/screens/map.js',
  './js/crypto/legacy-import.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') {
    event.respondWith(fetch(req));
    return;
  }
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    event.respondWith(fetch(req));
    return;
  }
  const path = url.pathname;
  const isShell =
    req.mode === 'navigate' ||
    path.endsWith('/index.html') ||
    path.endsWith('/js/app.js');

  if (isShell) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then((c) => c || caches.match('./index.html'))
        )
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((response) => response || fetch(req))
  );
});
