
(() => {
  let observedSearch = null;
  let observer = null;
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    const run = () => { queued = false; mount(); };
    window.chengmoSchedule ? window.chengmoSchedule('note-search', run) : requestAnimationFrame(run);
  };
  const reset = input => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true })); input.focus();
  };
  const mount = () => {
    const search = document.querySelector('.search'); const input = search?.querySelector('input');
    if (!search || !input) return;
    if (search !== observedSearch) {
      observer?.disconnect(); observer = new MutationObserver(schedule); observer.observe(search.parentElement || search, { childList: true }); observedSearch = search;
    }
    let clear = search.querySelector('.search__clear');
    if (!clear) { clear = document.createElement('button'); clear.type = 'button'; clear.className = 'search__clear'; clear.textContent = '\u00d7'; clear.title = '\u6e05\u7a7a\u641c\u7d22'; clear.setAttribute('aria-label', '\u6e05\u7a7a\u641c\u7d22'); clear.addEventListener('click', () => reset(input)); search.append(clear); }
    const sync = () => {
      const hasQuery = Boolean(input.value.trim()); search.classList.toggle('has-query', hasQuery);
      const list = document.querySelector('.note-index-scroll'); const empty = list?.querySelector('.empty-index');
      let tip = search.parentElement?.querySelector('.search-results-tip');
      if (!hasQuery || !empty) { tip?.remove(); return; }
      if (!tip) { tip = document.createElement('p'); tip.className = 'search-results-tip'; const resetButton = document.createElement('button'); resetButton.type = 'button'; resetButton.textContent = '\u6e05\u7a7a\u641c\u7d22'; resetButton.addEventListener('click', () => reset(input)); tip.append('\u672a\u627e\u5230\u5339\u914d\u7684\u7b14\u8bb0\u3002', resetButton); search.insertAdjacentElement('afterend', tip); }
    };
    input.title = '\u641c\u7d22\u7b14\u8bb0\uff08Ctrl+K\uff09'; input.setAttribute('aria-keyshortcuts', 'Control+K Meta+K');
    if (!input.dataset.chengmoSearchReady) { input.dataset.chengmoSearchReady = 'true'; input.addEventListener('input', () => window.setTimeout(sync, 0)); input.addEventListener('keydown', event => { if (event.key === 'Escape' && input.value) { event.preventDefault(); reset(input); } }); }
    sync();
  };
  document.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'k') return;
    if (event.target.matches('input, textarea, [contenteditable="true"]')) return;
    const input = document.querySelector('.search input'); if (!input) return;
    event.preventDefault(); input.focus(); input.select();
  }, true);
  document.addEventListener('chengmo:ui-mounted', schedule); window.addEventListener('load', schedule); schedule();
})();
