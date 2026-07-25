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
  const editableSelector = 'input, textarea, select, [contenteditable="true"]';
  const editingTarget = target => target?.closest?.(editableSelector) || null;
  const isEditing = target => Boolean(editingTarget(target));
  const openListAndSearch = () => {
    const activeCourse = document.querySelector('.course-button.active');
    if (!activeCourse) return false;
    const focusSearch = () => document.querySelector('.note-list .search input')?.focus({ preventScroll: true });
    if (listIsOpen()) { focusSearch(); return true; }
    activeCourse.click();
    // The category control is a toggle. React can commit a little after the
    // click, so wait for that commit but never click it a second time.
    window.setTimeout(() => { if (listIsOpen()) focusSearch(); }, 120);
    return true;
  };

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
    document.querySelectorAll('.compact-note__delete, .course-group__delete').forEach(button => {
      if (!button.title) button.title = button.getAttribute('aria-label') || '\u5220\u9664';
    });
    document.querySelectorAll('.category-edit').forEach(button => {
      if (!button.title) button.title = button.getAttribute('aria-label') || '\u7f16\u8f91\u5206\u7c7b';
    });
    const compactNew = document.querySelector('.note-list .new-note.compact');
    if (compactNew) {
      compactNew.title = '\u5728\u5f53\u524d\u5206\u7c7b\u65b0\u5efa\u7b14\u8bb0';
      compactNew.setAttribute('aria-label', '\u5728\u5f53\u524d\u5206\u7c7b\u65b0\u5efa\u7b14\u8bb0');
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
    if (event.defaultPrevented || event.isComposing) return;
    const modifierSearch = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
    const quickSearch = event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey;
    if ((modifierSearch || quickSearch) && !isEditing(event.target) && openListAndSearch()) {
      event.preventDefault();
      return;
    }
    if (event.key !== 'Escape') return;
    // Escape should leave ordinary editing fields alone. An empty list search
    // is navigation rather than content editing, so it can close the panel.
    const emptyListSearch = editingTarget(event.target)?.matches?.('.note-list .search input') && !editingTarget(event.target).value;
    if (isEditing(event.target) && !emptyListSearch) return;
    if (closeList()) { event.preventDefault(); return; }
    const shelfClose = document.querySelector('.annotation-shelf:not(.is-hidden) .annotation-shelf__close');
    if (shelfClose) { event.preventDefault(); shelfClose.click(); }
  }, true);
  document.addEventListener('click', event => {
    // These controls mutate the shelf after their own click handlers run.
    // Mount on the next task so labels and aria-expanded reflect final state.
    if (event.target.closest?.('.annotation-shelf-toggle, .annotation-shelf__close')) window.setTimeout(scheduleMount, 0);
  }, true);
  listen('chengmo:ui-mounted', 'reader-ux-ui', scheduleMount);
  window.addEventListener('load', scheduleMount, { once: true });
  scheduleMount();
})();
