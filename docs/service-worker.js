const CACHE_NAME = 'azuresora-notes-offline-20260728-13';
// Install only what is needed to reopen the shell. The full offline bundle is
// filled after first paint so service-worker installation never competes with it.
const CORE_ASSETS = [
  './',
  './index.html',
  './favicon.png',
  './manifest.webmanifest',
  './assets/offline-runtime.js',
  './assets/storage-bridge.js',
  './assets/script-1.js', './assets/script-2.js',
  './assets/style-1.css', './assets/brand-layout.css', './assets/azure-theme.css'
];
const DEFERRED_ASSETS = [
  './assets/enhancements-loader.js', './assets/katex-fonts.css', './favicon.png',
  './assets/script-3.js', './assets/script-4.js',
  './assets/script-5.js', './assets/script-6.js', './assets/script-7.js', './assets/script-8.js',
  './assets/script-9.js', './assets/script-10.js', './assets/script-11.js', './assets/script-12.js',
  './assets/script-13.js', './assets/script-14.js', './assets/script-15.js', './assets/script-16.js',
  './assets/local-file-backup.js',
  './assets/style-2.css', './assets/style-3.css', './assets/style-4.css',
  './assets/style-5.css', './assets/style-6.css', './assets/style-7.css', './assets/style-8.css',
  './assets/style-9.css', './assets/brand-layout.css', './assets/azure-theme.css',
  './assets/move.svg', './assets/move-cursor.svg',
  './assets/fonts/KaTeX_AMS-Regular.woff2', './assets/fonts/KaTeX_Caligraphic-Bold.woff2',
  './assets/fonts/KaTeX_Caligraphic-Regular.woff2', './assets/fonts/KaTeX_Fraktur-Bold.woff2',
  './assets/fonts/KaTeX_Fraktur-Regular.woff2', './assets/fonts/KaTeX_Main-Bold.woff2',
  './assets/fonts/KaTeX_Main-BoldItalic.woff2', './assets/fonts/KaTeX_Main-Italic.woff2',
  './assets/fonts/KaTeX_Main-Regular.woff2', './assets/fonts/KaTeX_Math-BoldItalic.woff2',
  './assets/fonts/KaTeX_Math-Italic.woff2', './assets/fonts/KaTeX_SansSerif-Bold.woff2',
  './assets/fonts/KaTeX_SansSerif-Italic.woff2', './assets/fonts/KaTeX_SansSerif-Regular.woff2',
  './assets/fonts/KaTeX_Script-Regular.woff2', './assets/fonts/KaTeX_Size1-Regular.woff2',
  './assets/fonts/KaTeX_Size2-Regular.woff2', './assets/fonts/KaTeX_Size3-Regular.woff2',
  './assets/fonts/KaTeX_Size4-Regular.woff2', './assets/fonts/KaTeX_Typewriter-Regular.woff2'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('azuresora-notes-offline-') && key !== CACHE_NAME)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy));
      return response;
    }).catch(() => caches.match('./index.html')));
    return;
  }
  event.respondWith(caches.match(event.request, { ignoreSearch: true }).then(cached => cached || fetch(event.request).then(response => {
    if (new URL(event.request.url).origin === self.location.origin && response.ok) {
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
    }
    return response;
  })));
});

self.addEventListener('message', event => {
  if (event.data?.type !== 'azuresora:cache-deferred') return;
  event.waitUntil(caches.open(CACHE_NAME).then(cache => Promise.allSettled(
    DEFERRED_ASSETS.map(asset => cache.match(asset).then(found => found || fetch(asset).then(response => {
      if (!response.ok) throw new Error(`Unable to cache ${asset}`);
      return cache.put(asset, response);
    })))
  )));
});
