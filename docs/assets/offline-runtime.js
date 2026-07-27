/* Register the offline cache only on a web origin; file:// cannot use workers. */
(() => {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').then(() => navigator.serviceWorker.ready).then(registration => {
      const warmOfflineCache = () => registration.active?.postMessage({ type: 'azuresora:cache-deferred' });
      // Start the optional cache only after first paint and main-thread idle.
      if (window.requestIdleCallback) window.requestIdleCallback(warmOfflineCache, { timeout: 5000 });
      else window.setTimeout(warmOfflineCache, 1200);
    }).catch(error => {
      console.warn('Offline cache registration failed.', error);
    });
  }, { once: true });
})();
