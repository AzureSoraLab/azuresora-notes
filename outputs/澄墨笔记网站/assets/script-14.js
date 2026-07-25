/* Keep the reader's scroll state in step with content that settles after React renders. */
(() => {
  const runtime = window.chengmoRuntime;
  const enqueue = runtime?.schedule || window.chengmoSchedule || ((_, task) => requestAnimationFrame(task));
  const listen = runtime?.on || ((type, _, listener) => { document.addEventListener(type, listener); return () => document.removeEventListener(type, listener); });

  let root = null;
  let observer = null;
  let resizeObserver = null;
  let lastNoteId = '';
  let lastMetrics = '';
  let settledFrame = 0;

  const noteId = () => document.querySelector('.compact-note.selected')?.dataset.noteId || '';
  const updateProgress = () => {
    if (!root) return;
    const track = document.querySelector('.progress-track > i');
    if (!track) return;
    const range = root.scrollHeight - root.clientHeight;
    const percent = range > 0 ? Math.min(100, Math.max(0, root.scrollTop / range * 100)) : 0;
    track.style.width = `${percent}%`;
  };
  const settle = () => {
    settledFrame = 0;
    if (!root) return;
    const metrics = `${root.clientWidth}:${root.clientHeight}:${root.scrollHeight}`;
    if (metrics !== lastMetrics) lastMetrics = metrics;
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
      root = nextRoot;
      root.addEventListener('scroll', updateProgress, { passive: true });
      observer = new MutationObserver(records => {
        // Chunk canvases are redraw implementation detail, not reader layout.
        if (records.some(record => !record.target.closest?.('.drawing-layer'))) scheduleSettle();
      });
      observer.observe(root, { childList: true, subtree: true, characterData: true });
      if (window.ResizeObserver) {
        resizeObserver = new ResizeObserver(scheduleSettle);
        resizeObserver.observe(root);
        root.firstElementChild && resizeObserver.observe(root.firstElementChild);
      }
      lastMetrics = '';
    }
    if (changedNote) {
      root.scrollTop = 0;
      // React's own reset may run just before this listener. Reassert once
      // after its commit so a long note never inherits the prior scroll depth.
      requestAnimationFrame(() => {
        if (root === nextRoot && noteId() === nextNoteId) {
          root.scrollTop = 0;
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
