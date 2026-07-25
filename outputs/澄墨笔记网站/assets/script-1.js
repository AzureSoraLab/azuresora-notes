(() => {
  // Shared runtime for the small DOM enhancements layered over the React app.
  // It coalesces work per frame and keeps one faulty enhancement from blocking
  // unrelated navigation, annotation, or backup hooks.
  if (window.chengmoRuntime) return;

  const tasks = new Map();
  const subscriptions = new Map();
  const dispatchers = new Map();
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
  const on = (type, key, listener) => {
    if (!type || !key || typeof listener !== 'function') return () => {};
    let listeners = subscriptions.get(type);
    if (!listeners) {
      listeners = new Map(); subscriptions.set(type, listeners);
      const dispatcher = event => [...listeners.entries()].forEach(([name, callback]) => {
        try { callback(event); } catch (error) { reportError(`${type}:${name}`, error); }
      });
      dispatchers.set(type, dispatcher);
      document.addEventListener(type, dispatcher);
    }
    listeners.set(key, listener);
    return () => {
      const current = subscriptions.get(type);
      if (!current) return;
      current.delete(key);
      if (current.size) return;
      document.removeEventListener(type, dispatchers.get(type));
      subscriptions.delete(type); dispatchers.delete(type);
    };
  };
  const whenReady = task => {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', task, { once: true });
    else task();
  };

  window.chengmoRuntime = Object.freeze({ schedule, whenReady, emit, on });
  window.chengmoSchedule = schedule;
  window.chengmoNotifyUiMounted = () => emit('chengmo:ui-mounted');
  window.chengmoNotifyNoteSelected = () => emit('chengmo:note-selected');

  document.addEventListener('click', event => {
    if (event.target.closest?.('.compact-note') && !event.target.closest('.compact-note__delete')) {
      window.setTimeout(window.chengmoNotifyNoteSelected, 0);
    }
  }, true);
})();
