
(() => {
  const notesKey = 'chengmo-notes-v1';
  const annotationsKey = 'chengmo-text-selection-annotations-v1';
  const recentKey = 'chengmo-recent-notes-v1';
  const drawingsKey = 'chengmo-freehand-annotations-v1';
  const drawingPreferencesKey = 'chengmo-freehand-drawing-preferences-v1';
  const pendingNoticeKey = 'chengmo-pending-notice';
  const parse = key => { try { return JSON.parse(localStorage.getItem(key) || (key === notesKey ? '{}' : '[]')); } catch { return key === notesKey ? {} : []; } };
  const makeArray = value => Array.isArray(value) ? value : [];
  const makeRecord = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const createTools = () => {
    const header = document.querySelector('.reader-header');
    const actionBar = header?.querySelector('.reader-actions');
    if (!header || !actionBar || header.querySelector('.data-tools')) return;
    const section = document.createElement('section'); section.className = 'data-tools';
    const title = document.createElement('p'); title.className = 'data-tools__title'; title.textContent = '\u6570\u636e\u7ba1\u7406';
    const toolActions = document.createElement('div'); toolActions.className = 'data-tools__actions';
    const exportButton = document.createElement('button'); exportButton.type = 'button'; exportButton.textContent = '\u5bfc\u51fa\u5907\u4efd'; exportButton.title = '\u5bfc\u51fa\u5907\u4efd'; exportButton.setAttribute('aria-label', '\u5bfc\u51fa\u5907\u4efd');
    const importButton = document.createElement('button'); importButton.type = 'button'; importButton.textContent = '\u5bfc\u5165\u5907\u4efd'; importButton.title = '\u5bfc\u5165\u5907\u4efd'; importButton.setAttribute('aria-label', '\u5bfc\u5165\u5907\u4efd');
    const file = document.createElement('input'); file.type = 'file'; file.accept = 'application/json,.json'; file.hidden = true;
    const notice = document.createElement('p'); notice.className = 'data-tools__notice'; notice.textContent = '\u5907\u4efd\u4ec5\u4fdd\u5b58\u5728\u6b64\u6d4f\u89c8\u5668\u4e2d';
    const show = (message, error = false) => { notice.textContent = message; notice.classList.toggle('is-error', error); window.chengmoNotice?.(message); };
    exportButton.addEventListener('click', async () => {
      // IndexedDB may contain newer ink than the legacy boot cache. Prefer it
      // for backups while retaining the cache as an offline fallback.
      const indexedDrawings = await window.chengmoStorage?.getAllDrawings?.().catch(() => null);
      const payload = { version: 2, exportedAt: new Date().toISOString(), notes: parse(notesKey), annotations: makeArray(parse(annotationsKey)), drawings: indexedDrawings && Object.keys(indexedDrawings).length ? indexedDrawings : makeRecord(parse(drawingsKey)), drawingPreferences: makeRecord(parse(drawingPreferencesKey)), recent: makeArray(parse(recentKey)) };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
      const link = document.createElement('a'); link.href = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().slice(0, 10); link.download = `\u6f84\u58a8\u5907\u4efd-${stamp}.json`; link.click(); URL.revokeObjectURL(link.href);
      show('\u5907\u4efd\u5df2\u5bfc\u51fa\uff0c\u8bf7\u59a5\u5584\u4fdd\u5b58\u6587\u4ef6\u3002');
    });
    importButton.addEventListener('click', () => file.click());
    file.addEventListener('change', () => {
      const source = file.files?.[0]; file.value = '';
      if (!source) return;
      const reader = new FileReader();
      reader.onerror = () => show('\u65e0\u6cd5\u8bfb\u53d6\u8be5\u5907\u4efd\u6587\u4ef6\u3002', true);
      reader.onload = () => {
        let backup;
        try { backup = JSON.parse(String(reader.result)); } catch { show('\u5907\u4efd\u6587\u4ef6\u4e0d\u662f\u6709\u6548\u7684 JSON\u3002', true); return; }
        if (!backup || typeof backup !== 'object' || !backup.notes || !Array.isArray(backup.notes.notes) || !Array.isArray(backup.notes.courses) || !Array.isArray(backup.annotations)) { show('\u5907\u4efd\u6587\u4ef6\u683c\u5f0f\u4e0d\u517c\u5bb9\uff0c\u672a\u5bfc\u5165\u4efb\u4f55\u6570\u636e\u3002', true); return; }
        if (!confirm('\u5bfc\u5165\u4f1a\u5408\u5e76\u5907\u4efd\u4e2d\u4e0d\u91cd\u590d\u7684\u7b14\u8bb0\u3001\u5206\u7c7b\u548c\u6807\u6ce8\uff0c\u4e0d\u4f1a\u8986\u76d6\u5f53\u524d\u6570\u636e\u3002\n\n\u786e\u5b9a\u5bfc\u5165\uff1f')) return;
        const currentNotes = parse(notesKey); const currentAnnotations = makeArray(parse(annotationsKey)); const currentRecent = makeArray(parse(recentKey)); const currentDrawings = makeRecord(parse(drawingsKey)); const currentPreferences = makeRecord(parse(drawingPreferencesKey));
        const merge = (current, incoming) => { const ids = new Set(makeArray(current).map(item => item?.id)); return [...makeArray(current), ...makeArray(incoming).filter(item => item?.id && !ids.has(item.id))]; };
        const mergedNotes = { ...currentNotes, courses: merge(currentNotes.courses, backup.notes.courses), notes: merge(currentNotes.notes, backup.notes.notes) };
        const mergedAnnotations = merge(currentAnnotations, backup.annotations);
        const knownNotes = new Set(mergedNotes.notes.map(item => item.id));
        const mergedRecent = merge(currentRecent, backup.recent).filter(item => knownNotes.has(item.id)).slice(0, 6);
        const incomingDrawings = makeRecord(backup.drawings);
        const mergedDrawings = { ...currentDrawings };
        Object.entries(incomingDrawings).forEach(([id, strokes]) => { if (knownNotes.has(id) && !Object.prototype.hasOwnProperty.call(mergedDrawings, id) && Array.isArray(strokes)) mergedDrawings[id] = strokes; });
        const noteCount = mergedNotes.notes.length - makeArray(currentNotes.notes).length;
        const annotationCount = mergedAnnotations.length - currentAnnotations.length;
        const courseCount = mergedNotes.courses.length - makeArray(currentNotes.courses).length;
        const drawingCount = Object.keys(mergedDrawings).length - Object.keys(currentDrawings).length;
        const mergedPreferences = Object.keys(currentPreferences).length ? currentPreferences : makeRecord(backup.drawingPreferences);
        localStorage.setItem(notesKey, JSON.stringify(mergedNotes)); localStorage.setItem(annotationsKey, JSON.stringify(mergedAnnotations)); localStorage.setItem(recentKey, JSON.stringify(mergedRecent)); localStorage.setItem(drawingsKey, JSON.stringify(mergedDrawings));
        if (Object.keys(mergedPreferences).length) localStorage.setItem(drawingPreferencesKey, JSON.stringify(mergedPreferences));
        const result = `\u5df2\u5bfc\u5165 ${noteCount} \u7bc7\u7b14\u8bb0\u3001${courseCount} \u4e2a\u5206\u7c7b\u3001${annotationCount} \u6761\u6807\u6ce8\u3001${drawingCount} \u7ec4\u7b14\u8ff9\u3002`;
        sessionStorage.setItem(pendingNoticeKey, JSON.stringify({ message: result })); show(result);
        window.setTimeout(() => window.location.reload(), 500);
      };
      reader.readAsText(source, 'utf-8');
    });
    toolActions.append(exportButton, importButton); section.append(title, toolActions, file, notice);
    actionBar.before(section);
  };
  const start = () => {
    let frame = 0;
    let observedRoot = null;
    let rootObserver = null;
    const mount = () => {
      frame = 0;
      createTools();
    };
    const scheduleMount = () => {
      if (frame) return;
      frame = 1;
      const run = () => { frame = 0; mount(); };
      window.chengmoSchedule ? window.chengmoSchedule('data-tools', run) : window.requestAnimationFrame(run);
    };
    scheduleMount();
    // React can replace the reader header after a note operation.  Watching
    // the application root only schedules a lightweight presence check.
    const watchRoot = () => {
      const root = document.getElementById('root');
      if (!root || root === observedRoot || !window.MutationObserver) return;
      rootObserver?.disconnect();
      rootObserver = new MutationObserver(records => {
        const replacedUi = records.some(record => [...record.addedNodes].some(node => node.nodeType === 1 && (node.matches?.('.reader, .reader-header, .note-list, .library-content') || node.querySelector?.('.reader-header, .note-list, .library-content'))));
        if (!replacedUi) return;
        scheduleMount();
        window.chengmoNotifyUiMounted?.();
      });
      // Direct children are the React view boundaries; observing every nested
      // markdown change needlessly wakes all auxiliary UI modules.
      rootObserver.observe(root, { childList: true });
      observedRoot = root;
    };
    watchRoot();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
  window.addEventListener('load', createTools, { once: true });
})();
