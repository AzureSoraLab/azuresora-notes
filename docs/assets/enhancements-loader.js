/* Load optional reader enhancements only after the React view has painted. */
(() => {
  const coreSources = [
    './assets/script-3.js?v=instant-stroke-delete-20260726',
    './assets/script-4.js?v=mobile-text-annotation-menu-20260726',
    './assets/script-6.js',
    './assets/script-7.js?v=recent-reading-runtime-20260726',
    './assets/script-8.js?v=reader-title-runtime-20260726',
    './assets/script-9.js?v=search-runtime-20260726',
    './assets/script-10.js?v=mobile-note-delete-20260728',
    './assets/script-11.js',
    './assets/script-13.js?v=reader-ux-20260725',
    './assets/script-14.js?v=reader-geometry-runtime-20260727',
    './assets/script-16.js?v=library-toggle-state-runtime-20260726'
  ];
  const optionalSources = [
    './assets/script-5.js?v=zotero-annotation-colors-20260726',
    './assets/local-file-backup.js?v=local-auto-backup-20260728',
    './assets/script-12.js?v=local-auto-backup-20260728',
    './assets/script-15.js?v=runtime-coordination-20260728'
  ];
  let coreStarted = false;
  let optionalStarted = false;
  const loadSources = sources => {
    // `async = false` preserves the established script order while allowing
    // the browser to fetch the small independent files without blocking paint.
    sources.forEach(source => {
      const script = document.createElement('script');
      script.src = source;
      script.async = false;
      document.body.append(script);
    });
  };
  const loadCore = () => {
    if (coreStarted) return;
    coreStarted = true;
    loadSources(coreSources);
  };
  const loadOptional = () => {
    if (optionalStarted) return;
    optionalStarted = true;
    // Sidebar, theme, and backup controls are not needed for the first read.
    // Their parsing is intentionally kept out of the first interaction window.
    loadSources(optionalSources);
  };
  const schedule = () => {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(loadCore, { timeout: 700 });
    } else {
      window.setTimeout(loadCore, 120);
    }
    // Optional controls add several observers and parse sizable scripts. Load
    // them when interaction is idle instead of competing with early editing.
    if ('requestIdleCallback' in window) window.requestIdleCallback(loadOptional, { timeout: 6000 });
    else window.setTimeout(loadOptional, 3500);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule, { once: true });
  else schedule();
})();
