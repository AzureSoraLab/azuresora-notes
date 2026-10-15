const CACHE_NAME = 'azuresora-notes-offline-20261015-math-blocks';
// Install only what is needed to reopen the shell. The full offline bundle is
// filled after first paint so service-worker installation never competes with it.
const CORE_ASSETS = [
  './',
  './index.html',
  './favicon.png',
  './manifest.webmanifest',
  './assets/offline-runtime.js?v=release-ui-20261013',
  './assets/release-migration.js?v=release-ui-20261013',
  './assets/storage-bridge.js?v=instant-note-delete-20260728',
  './assets/script-1.js?v=runtime-cross-feature-20260726',
  './assets/script-2.js?v=math-blocks-20261015',
  './assets/enhancements-loader.js?v=release-ui-20261013',
  './assets/style-1.css?v=release-ui-20261013',
  './assets/brand-layout.css?v=20260725-final',
  './assets/azure-theme.css?v=release-ui-20261013'
];
const DEFERRED_ASSETS = [
  "./favicon.png?v=20260728-4",
  "./manifest.webmanifest",
  "./assets/script-1.js?v=runtime-cross-feature-20260726",
  "./assets/release-migration.js?v=release-ui-20261013",
  "./assets/storage-bridge.js?v=instant-note-delete-20260728",
  "./assets/script-2.js?v=math-blocks-20261015",
  "./assets/style-1.css?v=release-ui-20261013",
  "./assets/katex-fonts.css?v=20260727",
  "./assets/style-2.css?v=annotation-underline-20260726",
  "./assets/style-3.css?v=annotation-toolbar-toggle-20260726",
  "./assets/style-4.css",
  "./assets/style-5.css",
  "./assets/style-6.css",
  "./assets/style-7.css",
  "./assets/style-8.css?v=katex-native-braces-20260729",
  "./assets/style-9.css?v=quiet-interactions-20260725",
  "./assets/brand-layout.css?v=20260725-final",
  "./assets/azure-theme.css?v=release-ui-20261013",
  "./assets/enhancements-loader.js?v=release-ui-20261013",
  "./assets/offline-runtime.js?v=release-ui-20261013",
  "./assets/script-3.js?v=instant-stroke-delete-20260726",
  "./assets/script-4.js?v=touch-selection-retry-20261013",
  "./assets/script-6.js",
  "./assets/script-7.js?v=recent-reading-runtime-20260726",
  "./assets/script-8.js?v=reader-title-runtime-20260726",
  "./assets/script-9.js?v=search-runtime-20260726",
  "./assets/script-10.js?v=note-delete-dialog-20261012",
  "./assets/script-11.js",
  "./assets/script-13.js?v=reader-ux-20260725",
  "./assets/script-14.js?v=reader-geometry-runtime-20260727",
  "./assets/script-16.js?v=library-toggle-state-runtime-20260726",
  "./assets/script-5.js?v=zotero-annotation-colors-20260726",
  "./assets/local-file-backup.js?v=local-auto-backup-20260728",
  "./assets/script-12.js?v=local-auto-backup-20260728",
  "./assets/script-15.js?v=runtime-coordination-20260728",
  "./assets/fonts/KaTeX_AMS-Regular.woff2",
  "./assets/fonts/KaTeX_Caligraphic-Bold.woff2",
  "./assets/fonts/KaTeX_Caligraphic-Regular.woff2",
  "./assets/fonts/KaTeX_Fraktur-Bold.woff2",
  "./assets/fonts/KaTeX_Fraktur-Regular.woff2",
  "./assets/fonts/KaTeX_Main-Bold.woff2",
  "./assets/fonts/KaTeX_Main-BoldItalic.woff2",
  "./assets/fonts/KaTeX_Main-Italic.woff2",
  "./assets/fonts/KaTeX_Main-Regular.woff2",
  "./assets/fonts/KaTeX_Math-BoldItalic.woff2",
  "./assets/fonts/KaTeX_Math-Italic.woff2",
  "./assets/fonts/KaTeX_SansSerif-Bold.woff2",
  "./assets/fonts/KaTeX_SansSerif-Italic.woff2",
  "./assets/fonts/KaTeX_SansSerif-Regular.woff2",
  "./assets/fonts/KaTeX_Script-Regular.woff2",
  "./assets/fonts/KaTeX_Size1-Regular.woff2",
  "./assets/fonts/KaTeX_Size2-Regular.woff2",
  "./assets/fonts/KaTeX_Size3-Regular.woff2",
  "./assets/fonts/KaTeX_Size4-Regular.woff2",
  "./assets/fonts/KaTeX_Typewriter-Regular.woff2"
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(
    CORE_ASSETS.map(asset => new Request(new URL(asset, self.location.href), { cache: 'reload' }))
  )).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('azuresora-notes-offline-') && key !== CACHE_NAME)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (new URL(event.request.url).origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then(response => {
      const copy = response.clone();
      if (response.ok) event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy)));
      return response;
    }).catch(() => caches.open(CACHE_NAME).then(cache => cache.match('./index.html'))));
    return;
  }
  event.respondWith(caches.open(CACHE_NAME).then(cache => cache.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    if (response.ok) {
      event.waitUntil(cache.put(event.request, response.clone()));
    }
    return response;
  }))));
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

