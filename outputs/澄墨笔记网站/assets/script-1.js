(() => {
  // Shared runtime for the small DOM enhancements layered over the React app.
  // It coalesces work per frame and keeps one faulty enhancement from blocking
  // unrelated navigation, annotation, or backup hooks.
  if (window.chengmoRuntime) return;

  const tasks = new Map();
  let frame = 0;
  const reportError = (key, error) => {
    console.error(`Chengmo enhancement "${key}" failed`, error);
    document.dispatchEvent(new CustomEvent('chengmo:enhancement-error', { detail: { key, error } }));
  };
  const flush = () => {
    frame = 0;
    const pending = [...tasks.entries()];
    tasks.clear();
    pending.forEach(([key, task]) => {
      try { task(); } catch (error) { reportError(key, error); }
    });
  };
  const schedule = (key, task) => {
    if (typeof task !== 'function') return;
    tasks.set(key, task);
    if (!frame) frame = requestAnimationFrame(flush);
  };
  const emit = type => schedule(`event:${type}`, () => document.dispatchEvent(new CustomEvent(type)));
  const whenReady = task => {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', task, { once: true });
    else task();
  };

  window.chengmoRuntime = Object.freeze({ schedule, whenReady, emit });
  window.chengmoSchedule = schedule;
  window.chengmoNotifyUiMounted = () => emit('chengmo:ui-mounted');
  window.chengmoNotifyNoteSelected = () => emit('chengmo:note-selected');

  document.addEventListener('click', event => {
    if (event.target.closest?.('.compact-note') && !event.target.closest('.compact-note__delete')) {
      window.setTimeout(window.chengmoNotifyNoteSelected, 0);
    }
  }, true);
})();
