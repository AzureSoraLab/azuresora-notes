/* Keep the reader's scroll state in step with content that settles after React renders. */
(() => {
  const runtime = window.chengmoRuntime;
  const enqueue = runtime?.schedule || window.chengmoSchedule || ((_, task) => requestAnimationFrame(task));
  const listen = runtime?.on || ((type, _, listener) => { document.addEventListener(type, listener); return () => document.removeEventListener(type, listener); });

  let root = null;
  let resizeObserver = null;
  let observedContent = null;
  let lastNoteId = '';
  let settledFrame = 0;
  let progressFrame = 0;
  let progressWidth = '';
  let scrollRange = 0;

  const noteId = () => document.querySelector('.compact-note.selected')?.dataset.noteId || '';
  const syncContentState = content => {
    if (!content) return;
    // Avoid a reader-wide `:has()` match whenever annotation spans or formula
    // nodes change. The rendered Markdown wrapper is the only state we need.
    content.classList.toggle('is-empty-note', content.children.length === 1 && content.firstElementChild?.matches('h1'));
  };
  const refreshScrollRange = () => {
    scrollRange = root ? Math.max(0, root.scrollHeight - root.clientHeight) : 0;
  };
  const updateProgress = () => {
    if (!root) return;
    const track = document.querySelector('.progress-track > i');
    if (!track) return;
    const percent = scrollRange > 0 ? Math.min(100, Math.max(0, root.scrollTop / scrollRange * 100)) : 0;
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
    // Content height only changes after a layout mutation or resize, not while
    // a reader is simply scrolling. Keep those expensive geometry reads here.
    refreshScrollRange();
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
      resizeObserver?.disconnect();
      if (root) root.removeEventListener('scroll', scheduleProgress);
      root = nextRoot;
      progressWidth = '';
      scrollRange = 0;
      root.addEventListener('scroll', scheduleProgress, { passive: true });
      // ResizeObserver catches real geometry changes. Watching every child
      // mutation here made marking and drawing needlessly rescan the reader.
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
    syncContentState(nextContent);
    if (changedNote) {
      root.scrollTop = 0;
      // React's own reset may run just before this listener. Reassert once
      // after its commit so a long note never inherits the prior scroll depth.
      requestAnimationFrame(() => {
        if (root === nextRoot && noteId() === nextNoteId) {
          root.scrollTop = 0;
          progressWidth = '';
          refreshScrollRange();
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
  document.addEventListener('click', event => {
    if (event.target.closest?.('.edit-switch')) window.setTimeout(scheduleSync, 0);
  }, true);
  window.addEventListener('load', scheduleSync, { once: true });
  scheduleSync();
})();
