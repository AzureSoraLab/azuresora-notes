(() => {
  const runtime = window.chengmoRuntime;
  const enqueue = runtime?.schedule || window.chengmoSchedule || ((_, task) => window.requestAnimationFrame(task));
  const listen = runtime?.on || ((type, _, listener) => { document.addEventListener(type, listener); return () => document.removeEventListener(type, listener); });

  const listIsOpen = () => document.querySelector('.app-shell')?.classList.contains('note-list-open');
  const closeList = () => {
    if (!listIsOpen()) return false;
    document.querySelector('.course-button.active')?.click();
    return true;
  };
  const isEditing = target => target?.matches?.('input, textarea, select, [contenteditable="true"]');

  const mount = () => {
    const header = document.querySelector('.note-list-header');
    if (header && !header.querySelector('.note-list__close')) {
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'note-list__close';
      close.textContent = '\u00d7';
      close.title = '\u6536\u8d77\u7b14\u8bb0\u5217\u8868\uff08Esc\uff09';
      close.setAttribute('aria-label', '\u6536\u8d77\u7b14\u8bb0\u5217\u8868');
      close.addEventListener('click', closeList);
      header.append(close);
    }
    const shelfToggle = document.querySelector('.annotation-shelf-toggle');
    if (shelfToggle) {
      const open = shelfToggle.classList.contains('is-open');
      const label = open ? '\u6536\u8d77\u6807\u6ce8' : '\u663e\u793a\u6807\u6ce8';
      shelfToggle.title = label;
      shelfToggle.setAttribute('aria-label', label);
      shelfToggle.setAttribute('aria-expanded', String(open));
    }
    document.querySelectorAll('.outline-header-toggle, .outline-toggle').forEach(button => {
      if (!button.title) button.title = '\u663e\u793a\u6216\u6536\u8d77\u672c\u6587\u76ee\u5f55';
    });
  };

  let scheduled = false;
  const scheduleMount = () => {
    if (scheduled) return;
    scheduled = true;
    enqueue('reader-ux', () => { scheduled = false; mount(); });
  };

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented || isEditing(event.target)) return;
    if (closeList()) { event.preventDefault(); return; }
    const shelfClose = document.querySelector('.annotation-shelf:not(.is-hidden) .annotation-shelf__close');
    if (shelfClose) { event.preventDefault(); shelfClose.click(); }
  }, true);
  document.addEventListener('click', event => {
    if (event.target.closest?.('.annotation-shelf-toggle')) window.setTimeout(scheduleMount, 0);
  }, true);
  listen('chengmo:ui-mounted', 'reader-ux-ui', scheduleMount);
  window.addEventListener('load', scheduleMount, { once: true });
  scheduleMount();
})();
