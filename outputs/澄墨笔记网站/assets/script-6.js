
(() => {
  let timer = 0;
  const show = message => {
    let toast = document.querySelector('.chengmo-toast');
    if (!toast) { toast = document.createElement('div'); toast.className = 'chengmo-toast'; toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite'); document.body.append(toast); }
    toast.textContent = message; toast.classList.add('is-visible'); window.clearTimeout(timer);
    timer = window.setTimeout(() => toast.classList.remove('is-visible'), 2200);
  };
  document.addEventListener('chengmo:notice', event => { if (event.detail?.message) show(event.detail.message); });
  window.chengmoNotice = show;
})();
