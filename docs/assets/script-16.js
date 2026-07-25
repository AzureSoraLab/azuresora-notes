(() => {
  const storageKey = 'chengmo-library-toggle-position-v1';
  const root = document.documentElement;
  let drag = null;
  let suppressClick = false;
  let positionFrame = 0;
  let pendingPosition = null;

  const clamp = (position, width, height) => ({
    left: Math.max(8, Math.min(innerWidth - width - 8, position.left)),
    top: Math.max(8, Math.min(innerHeight - height - 8, position.top))
  });
  const apply = position => {
    if (root.style.getPropertyValue('--library-toggle-left') === `${position.left}px` && root.style.getPropertyValue('--library-toggle-top') === `${position.top}px`) return;
    root.style.setProperty('--library-toggle-left', `${position.left}px`);
    root.style.setProperty('--library-toggle-top', `${position.top}px`);
  };
  const scheduleApply = position => {
    pendingPosition = position;
    if (positionFrame) return;
    positionFrame = window.requestAnimationFrame(() => {
      positionFrame = 0;
      if (pendingPosition) apply(pendingPosition);
      pendingPosition = null;
    });
  };
  const flushPosition = () => {
    if (positionFrame) window.cancelAnimationFrame(positionFrame);
    positionFrame = 0;
    if (pendingPosition) apply(pendingPosition);
    const position = pendingPosition;
    pendingPosition = null;
    return position;
  };
  const read = () => {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (Number.isFinite(value?.left) && Number.isFinite(value?.top)) apply(value);
    } catch {}
  };
  const toggle = target => target.closest('.sidebar-toggle');
  document.addEventListener('pointerdown', event => {
    const button = toggle(event.target);
    if (!button || event.button !== 0) return;
    const rect = button.getBoundingClientRect();
    drag = { button, pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, width: rect.width, height: rect.height, position: { left: rect.left, top: rect.top }, moved: false };
    button.setPointerCapture?.(event.pointerId);
  });
  document.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    drag.position = clamp({ left: drag.left + dx, top: drag.top + dy }, drag.width, drag.height);
    scheduleApply(drag.position);
  }, { passive: true });
  const finishDrag = (event, persist) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const completedDrag = drag;
    drag = null;
    completedDrag.button.releasePointerCapture?.(event.pointerId);
    if (persist && completedDrag.moved) {
      flushPosition();
      try { localStorage.setItem(storageKey, JSON.stringify(completedDrag.position)); } catch {}
      suppressClick = true;
      event.preventDefault();
      event.stopPropagation();
    } else if (!persist) {
      // A cancelled pointer sequence must not apply a queued visual position.
      if (positionFrame) window.cancelAnimationFrame(positionFrame);
      positionFrame = 0;
      pendingPosition = null;
    }
  };
  document.addEventListener('pointerup', event => finishDrag(event, true), true);
  document.addEventListener('pointercancel', event => finishDrag(event, false), true);
  window.addEventListener('resize', () => {
    const button = document.querySelector('.sidebar-toggle');
    const left = Number.parseFloat(root.style.getPropertyValue('--library-toggle-left'));
    const top = Number.parseFloat(root.style.getPropertyValue('--library-toggle-top'));
    if (!button || !Number.isFinite(left) || !Number.isFinite(top)) return;
    const rect = button.getBoundingClientRect();
    const position = clamp({ left, top }, rect.width, rect.height);
    if (position.left !== left || position.top !== top) scheduleApply(position);
  }, { passive: true });
  document.addEventListener('click', event => {
    const button = toggle(event.target);
    if (!button) return;
    if (suppressClick) {
      suppressClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    const shell = document.querySelector('.app-shell');
    if (!shell || shell.classList.contains('library-collapsed') || !shell.classList.contains('note-list-open')) return;
    // Capture before React handles this click: otherwise the library is already
    // collapsed, and the old guard prevents the companion list from closing.
    document.querySelector('.course-button.active')?.click();
  }, true);
  read();
})();
