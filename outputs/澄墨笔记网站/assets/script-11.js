
(() => {
  const key = 'chengmo-pending-notice';
  window.addEventListener('load', () => {
    let pending = null; try { pending = JSON.parse(sessionStorage.getItem(key) || 'null'); } catch {}
    sessionStorage.removeItem(key);
    if (pending?.message) window.setTimeout(() => window.chengmoNotice?.(pending.message), 420);
  }, { once: true });
})();
