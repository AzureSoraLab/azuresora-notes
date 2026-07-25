/* Keep the reader's scroll state in step with content that settles after React renders. */
(() => {
  const runtime = window.chengmoRuntime;
  const enqueue = runtime?.schedule || window.chengmoSchedule || ((_, task) => requestAnimationFrame(task));
  const listen = runtime?.on || ((type, _, listener) => { document.addEventListener(type, listener); return () => document.removeEventListener(type, listener); });

  let root = null;
  let observer = null;
  let resizeObserver = null;
  let observedContent = null;
  let lastNoteId = '';
  let settledFrame = 0;
  let progressFrame = 0;
  let progressWidth = '';

  const noteId = () => document.querySelector('.compact-note.selected')?.dataset.noteId || '';
  const updateProgress = () => {
    if (!root) return;
    const track = document.querySelector('.progress-track > i');
    if (!track) return;
    const range = root.scrollHeight - root.clientHeight;
    const percent = range > 0 ? Math.min(100, Math.max(0, root.scrollTop / range * 100)) : 0;
    const width = `${Math.round(percent * 100) / 100}%`;
    if (progressWidth !== width) { track.style.width = width; progressWidth = width; }
  };
  const scheduleProgress = () => {
    if (progressFrame) return;
    progressFrame = requestAnimationFrame(() => { progressFrame = 0; updateProgress(); });
  };
  const settle = () => {
    settledFrame = 0;
    if (!root) return;
    updateProgress();
  };
  const scheduleSettle = () => {
    if (settledFrame) return;
    // Allow markdown, formulas, and annotations to finish their own layout first.
    settledFrame = requestAnimationFrame(() => requestAnimationFrame(settle));
  };
  const sync = () => {
    const nextRoot = document.querySelector('.reader-body');
    if (!nextRoot) return;
    const nextNoteId = noteId();
    const changedNote = nextNoteId && nextNoteId !== lastNoteId;
    if (nextRoot !== root) {
      observer?.disconnect(); resizeObserver?.disconnect();
      if (root) root.removeEventListener('scroll', scheduleProgress);
      root = nextRoot;
      progressWidth = '';
      root.addEventListener('scroll', scheduleProgress, { passive: true });
      observer = new MutationObserver(records => {
        // Ink chunks and annotation cards are overlays. Only content replacement
        // needs a fresh body observer or a post-layout progress calculation.
        if (records.some(record => {
          if (record.target.closest?.('.drawing-layer, .selection-annotation-menu, .annotation-shelf')) return false;
          return record.type === 'characterData' || record.addedNodes.length || record.removedNodes.length;
        })) scheduleSettle();
      });
      observer.observe(root, { childList: true, subtree: true, characterData: true });
      if (window.ResizeObserver) {
        resizeObserver = new ResizeObserver(scheduleSettle);
        resizeObserver.observe(root);
        observedContent = root.firstElementChild;
        if (observedContent) resizeObserver.observe(observedContent);
      }
    }
    const nextContent = root.firstElementChild;
    if (nextContent !== observedContent) {
      if (observedContent) resizeObserver?.unobserve(observedContent);
      observedContent = nextContent;
      if (observedContent) resizeObserver?.observe(observedContent);
      scheduleSettle();
    }
    if (changedNote) {
      root.scrollTop = 0;
      // React's own reset may run just before this listener. Reassert once
      // after its commit so a long note never inherits the prior scroll depth.
      requestAnimationFrame(() => {
        if (root === nextRoot && noteId() === nextNoteId) {
          root.scrollTop = 0;
          progressWidth = '';
          updateProgress();
        }
      });
    }
    lastNoteId = nextNoteId || lastNoteId;
    scheduleSettle();
  };

  const scheduleSync = () => enqueue('reader-display-sync', sync);
  listen('chengmo:ui-mounted', 'reader-display-ui', scheduleSync);
  listen('chengmo:note-selected', 'reader-display-note', scheduleSync);
  window.addEventListener('load', scheduleSync, { once: true });
  scheduleSync();
})();
