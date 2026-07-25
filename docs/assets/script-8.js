
(() => {
  const stateKey = 'chengmo-notes-v1';
  const runtime = window.chengmoRuntime;
  const enqueue = runtime?.schedule || window.chengmoSchedule || ((_, task) => window.requestAnimationFrame(task));
  const listen = runtime?.on || ((type, _, listener) => { document.addEventListener(type, listener); return () => document.removeEventListener(type, listener); });
  const state = () => { try { return JSON.parse(localStorage.getItem(stateKey) || '{}'); } catch { return {}; } };
  function selectedTitle() { return document.querySelector('.compact-note.selected strong')?.textContent?.trim() || ''; }
  function syncHeaderAndOrder() {
    const title = selectedTitle();
    const crumb = document.querySelector('.reader-header .crumb');
    if (crumb) {
      let suffix = crumb.querySelector('.reader-current-note');
      if (!suffix) { suffix = document.createElement('span'); suffix.className = 'reader-current-note'; crumb.append(suffix); }
      suffix.textContent = title ? ` / ${title}` : '';
    }
  }
  const start = () => {
    let frame = 0;
    let observedHeader = null;
    let headerObserver = null;
    const schedule = () => {
      if (frame) return;
      frame = 1;
      const run = () => { frame = 0; syncHeaderAndOrder(); };
      enqueue('reader-title', run);
    };
    const watchHeader = () => {
      const header = document.querySelector('.reader-header');
      if (!header || header === observedHeader) return;
      headerObserver?.disconnect();
      headerObserver = new MutationObserver(schedule);
      headerObserver.observe(header, { childList: true });
      observedHeader = header;
    };
    const syncAndWatch = () => { watchHeader(); schedule(); };
    listen('chengmo:ui-mounted', 'reader-title-ui', syncAndWatch);
    listen('chengmo:note-selected', 'reader-title-selection', schedule);
    syncAndWatch();
  };
  (runtime?.whenReady || (task => document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', task, { once: true }) : task()))(start);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || !event.target.matches('.title-input')) return;
    event.preventDefault();
    event.target.blur();
  }, true);
})();
