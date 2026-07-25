(() => {
  const runtime = window.chengmoRuntime;
  const enqueue = runtime?.schedule || window.chengmoSchedule || ((_, task) => window.requestAnimationFrame(task));
  const listen = runtime?.on || ((type, _, listener) => { document.addEventListener(type, listener); return () => document.removeEventListener(type, listener); });
  const stateKey = 'chengmo-notes-v1';
  const recentKey = 'chengmo-recent-notes-v1';
  const annotationKey = 'chengmo-text-selection-annotations-v1';
  const drawingKey = 'chengmo-freehand-annotations-v1';
  const keepListOpenKey = 'chengmo-keep-note-list-open';
  const readingSessionKey = 'chengmo-reading-session-v1';
  // Kept outside start() because list hydration also runs before its observers
  // are established (for example during React's initial render).
  let pendingCreatedNoteId = '';
  let stateCache = { raw: undefined, value: null };
  const valueCache = new Map();
  const readState = () => {
    const pending = window.chengmoStorage?.peekNotes?.();
    if (pending && typeof pending === 'object') return pending;
    try {
      const raw = localStorage.getItem(stateKey);
      if (stateCache.raw === raw && stateCache.value) return stateCache.value;
      const value = JSON.parse(raw || '{}');
      stateCache = { raw, value: value && typeof value === 'object' ? value : {} };
      return stateCache.value;
    } catch { return {}; }
  };
  const readCached = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      const cached = valueCache.get(key);
      if (cached?.raw === raw) return cached.value;
      const value = JSON.parse(raw || 'null');
      const normalized = value && typeof value === 'object' ? value : fallback;
      valueCache.set(key, { raw, value: normalized });
      return normalized;
    } catch { return fallback; }
  };
  const readArray = key => {
    const value = readCached(key, null);
    return Array.isArray(value) ? value : null;
  };
  const readRecord = key => {
    const value = readCached(key, null);
    return value && !Array.isArray(value) ? value : null;
  };
  const noteTitle = note => note?.title?.trim() || '\u672a\u547d\u540d\u7b14\u8bb0';
  const noteSubtitle = note => (Array.isArray(note?.tags) ? note.tags.slice(0, 2).map(tag => `#${tag}`).join('  ') : '') || '\u672a\u6dfb\u52a0\u6807\u7b7e';
  const reactKey = (node, ids) => {
    const fiberKey = Object.keys(node).find(key => key.startsWith('__reactFiber$'));
    const fiber = fiberKey && node[fiberKey];
    const id = fiber?.key ?? fiber?.alternate?.key;
    return typeof id === 'string' && ids.has(id) ? id : '';
  };
  const noteCards = () => [...document.querySelectorAll('.compact-note')];
  const courseButtons = () => [...document.querySelectorAll('.course-button')];
  const cardForId = (id, cards = noteCards()) => cards.find(card => card.dataset.noteId === id) || null;
  const courseButtonForId = (courseId, state = readState(), buttons = courseButtons()) => {
    const ids = new Set((state.courses || []).map(course => course.id));
    const keyed = buttons.find(button => reactKey(button, ids) === courseId);
    if (keyed) return keyed;
    const index = (state.courses || []).findIndex(course => course.id === courseId);
    return index < 0 ? null : buttons[index] || null;
  };
  const activeCourseId = (state = readState(), buttons = courseButtons()) => {
    const active = document.querySelector('.course-button.active');
    const keyedId = active && reactKey(active, new Set((state.courses || []).map(course => course.id)));
    if (keyedId) return keyedId;
    const index = buttons.indexOf(active);
    return index < 0 ? '' : state.courses?.[index]?.id || '';
  };
  const courseIdForButton = (button, state = readState(), buttons = courseButtons()) => {
    const ids = new Set((state.courses || []).map(course => course.id));
    const keyed = reactKey(button, ids);
    if (keyed) return keyed;
    const index = buttons.indexOf(button);
    return index < 0 ? '' : state.courses?.[index]?.id || '';
  };
  const readSession = () => { try { return JSON.parse(localStorage.getItem(readingSessionKey) || 'null'); } catch { return null; } };
  const saveSession = () => {
    const state = readState();
    const selected = document.querySelector('.compact-note.selected');
    const noteId = selected?.dataset.noteId;
    if (!noteId || !(state.notes || []).some(note => note.id === noteId)) return;
    localStorage.setItem(readingSessionKey, JSON.stringify({ noteId, courseId: activeCourseId(state), listOpen: document.querySelector('.app-shell')?.classList.contains('note-list-open') === true }));
  };
  const visibleNotes = (state, courseId, query) => (state.notes || []).filter(note => {
    const tags = Array.isArray(note.tags) ? note.tags : [];
    const haystack = `${note.title || ''} ${note.content || ''} ${tags.join(' ')}`.toLowerCase();
    return (query ? true : note.courseId === courseId) && haystack.includes(query);
  });
  const fallbackCardIds = (cards, notes) => {
    // Each card comes from a keyed React item. Matching its visible metadata is
    // only a fallback for the bundled build, and never relies on list order.
    const resolved = new Map();
    const remaining = [...notes];
    cards.forEach(card => {
      const title = card.querySelector('strong')?.textContent?.trim() || '';
      const subtitle = card.querySelector('small')?.textContent?.trim() || '';
      const index = remaining.findIndex(note => noteTitle(note) === title && noteSubtitle(note) === subtitle);
      if (index >= 0) resolved.set(card, remaining.splice(index, 1)[0].id);
    });
    return resolved;
  };
  const applyDeleteControls = (state = readState(), cards = noteCards(), buttons = courseButtons()) => {
    // Most observer callbacks are caused by a small React text update. When
    // every rendered card is already bound, avoid rebuilding note metadata and
    // notifying the other reader enhancements again.
    if (!cards.some(card => !card.dataset.noteId || !card.querySelector(':scope > .compact-note__delete'))) return false;
    const courseId = activeCourseId(state, buttons);
    const query = document.querySelector('.search input')?.value?.toLowerCase() || '';
    const matchingNotes = visibleNotes(state, courseId, query);
    const knownIds = new Set((state.notes || []).map(note => note.id));
    const fallbackIds = fallbackCardIds(cards, matchingNotes);
    cards.forEach(noteButton => {
      // Current builds put the canonical ID on the card. Keep it through the
      // brief gap before React's debounced localStorage save is visible.
      const renderedId = noteButton.dataset.noteId || '';
      const noteId = reactKey(noteButton, knownIds) || fallbackIds.get(noteButton) || renderedId || (noteButton.classList.contains('selected') ? pendingCreatedNoteId : '');
      if (noteId) noteButton.dataset.noteId = noteId;
      else delete noteButton.dataset.noteId;
      const existing = noteButton.querySelector('.compact-note__delete');
      if (!noteId) { existing?.remove(); return; }
      if (existing) return;
      const close = document.createElement('span'); close.className = 'compact-note__delete'; close.textContent = '\u00d7'; close.title = '\u5220\u9664\u7b14\u8bb0'; close.setAttribute('role', 'button'); close.setAttribute('aria-label', '\u5220\u9664\u7b14\u8bb0'); close.tabIndex = 0;
      close.addEventListener('pointerdown', event => event.stopPropagation()); close.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.currentTarget.click(); } }); noteButton.append(close);
    });
    return true;
  };
  const applyCourseDeleteControls = (state = readState(), buttons = courseButtons()) => {
    const groups = [...document.querySelectorAll('.course-group')];
    if (!groups.some(group => !group.dataset.courseId || !group.querySelector(':scope > .course-group__delete'))) return false;
    groups.forEach(group => {
      const button = group.querySelector('.course-button');
      const courseId = button && courseIdForButton(button, state, buttons);
      const existing = group.querySelector('.course-group__delete');
      if (!courseId) { existing?.remove(); return; }
      group.dataset.courseId = courseId;
      if (existing) return;
      const remove = document.createElement('span');
      remove.className = 'course-group__delete'; remove.textContent = '\u00d7';
      remove.title = '\u5220\u9664\u5206\u7c7b'; remove.setAttribute('role', 'button');
      remove.setAttribute('aria-label', '\u5220\u9664\u5206\u7c7b'); remove.tabIndex = 0;
      remove.addEventListener('pointerdown', event => event.stopPropagation());
      remove.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.currentTarget.click(); }
      });
      group.append(remove);
    });
    return true;
  };
  const writeDeletion = ({ state, targetId, nextId, courseId }) => {
    const notes = Array.isArray(state.notes) ? state.notes : [];
    const annotations = readArray(annotationKey);
    const recent = readArray(recentKey);
    const drawings = readRecord(drawingKey);
    const snapshot = new Map([stateKey, annotationKey, recentKey, drawingKey, readingSessionKey].map(key => [key, localStorage.getItem(key)]));
    const restoreSnapshot = () => snapshot.forEach((value, key) => value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value));
    try {
      if (annotations) localStorage.setItem(annotationKey, JSON.stringify(annotations.filter(item => item?.noteId !== targetId)));
      if (recent) localStorage.setItem(recentKey, JSON.stringify(recent.filter(item => item?.id !== targetId)));
      if (drawings && Object.prototype.hasOwnProperty.call(drawings, targetId)) { delete drawings[targetId]; localStorage.setItem(drawingKey, JSON.stringify(drawings)); }
      window.chengmoStorage?.removeDrawing(targetId);
      localStorage.setItem(stateKey, JSON.stringify({ ...state, notes: notes.filter(note => note.id !== targetId) }));
      if (nextId) localStorage.setItem(readingSessionKey, JSON.stringify({ noteId: nextId, courseId, listOpen: true }));
      else localStorage.removeItem(readingSessionKey);
      return true;
    } catch {
      try { restoreSnapshot(); } catch {}
      return false;
    }
  };
  const start = () => {
    // Never leave the reader hidden if a saved session becomes unavailable mid-load.
    window.setTimeout(() => document.documentElement.classList.remove('chengmo-restoring-session'), 1800);
    let queued = false;
    let listObserver = null;
    let hostObserver = null;
    let observedList = null;
    let restoreScheduled = false;
    let sessionRestoreScheduled = false;
    const watchList = () => {
      const list = document.querySelector('.note-index-scroll');
      if (!list) return false;
      if (list === observedList) return true;
      listObserver?.disconnect();
      listObserver = new MutationObserver(records => {
        // Inserting the local delete affordance should not cause the full list
        // binding pass to run a second time.
        const changedByReact = records.some(record => [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType !== 1 || !node.matches?.('.compact-note__delete')));
        if (changedByReact) sync();
      });
      listObserver.observe(list, { childList: true, subtree: true });
      observedList = list;
      return true;
    };
    const sync = () => {
      if (queued) return;
      queued = true;
      const run = () => {
        queued = false;
        const state = readState();
        const buttons = courseButtons();
        const cards = noteCards();
        const notesChanged = applyDeleteControls(state, cards, buttons);
        const coursesChanged = applyCourseDeleteControls(state, buttons);
        watchList();
        // Other modules use this event to resolve freshly rendered list nodes.
        // Do not wake them for observer noise when nothing in the list changed.
        if (notesChanged || coursesChanged) document.dispatchEvent(new CustomEvent('chengmo:note-list-ready'));
        if (!sessionRestoreScheduled && !sessionStorage.getItem(keepListOpenKey)) {
          const session = readSession(); const state = readState();
          const savedNote = session?.noteId && (state.notes || []).find(note => note.id === session.noteId);
          if (savedNote) {
            sessionRestoreScheduled = true;
            window.setTimeout(() => {
              const latest = readSession(); const saved = readState(); const note = latest?.noteId && (saved.notes || []).find(item => item.id === latest.noteId);
              const courseButton = note && courseButtonForId(note.courseId, saved);
              if (!note || !courseButton) return;
              const needsCourse = activeCourseId(saved) !== note.courseId;
              const listOpen = document.querySelector('.app-shell')?.classList.contains('note-list-open') === true;
              if (needsCourse || Boolean(latest.listOpen) !== listOpen) courseButton.click();
              window.setTimeout(() => {
                applyDeleteControls(); cardForId(note.id)?.click();
                window.setTimeout(() => {
                  if (!latest.listOpen && document.querySelector('.app-shell')?.classList.contains('note-list-open')) courseButton.click();
                  document.documentElement.classList.remove('chengmo-restoring-session');
                }, 80);
              }, 140);
            }, 360);
          }
        }
        const pending = (() => { try { return JSON.parse(sessionStorage.getItem(keepListOpenKey) || 'null'); } catch { return null; } })();
        if (!pending || restoreScheduled) return;
        restoreScheduled = true; sessionRestoreScheduled = true;
        // The bundled React app attaches handlers after initial parsing. Wait
        // until it has rendered once, then restore the list exactly once.
        window.setTimeout(() => {
          const restore = (() => { try { return JSON.parse(sessionStorage.getItem(keepListOpenKey) || 'null'); } catch { return null; } })();
          if (!restore) return;
          const saved = readState(); const courseButton = courseButtonForId(restore.courseId, saved);
          if (!courseButton) { sessionStorage.removeItem(keepListOpenKey); return; }
          const listOpen = document.querySelector('.app-shell')?.classList.contains('note-list-open');
          if (activeCourseId(saved) !== restore.courseId || !listOpen) courseButton.click();
          sessionStorage.removeItem(keepListOpenKey);
          if (restore.nextId) window.setTimeout(() => {
            const input = document.querySelector('.search input');
            if (input && typeof restore.query === 'string' && input.value !== restore.query) {
              const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
              setValue?.call(input, restore.query); input.dispatchEvent(new Event('input', { bubbles: true }));
            }
            window.setTimeout(() => { applyDeleteControls(); cardForId(restore.nextId)?.click(); }, 100);
          }, 120);
        }, 300);
      };
      enqueue('note-delete-controls', run);
    };
    sync();
    const watchHost = () => {
      const listHost = document.querySelector('.note-list');
      if (!listHost || listHost === watchHost.current) return;
      hostObserver?.disconnect();
      hostObserver = new MutationObserver(() => {
        if (document.querySelector('.note-index-scroll') !== observedList) sync();
      });
      hostObserver.observe(listHost, { childList: true });
      watchHost.current = listHost;
    };
    listen('chengmo:ui-mounted', 'note-controls-ui', () => { watchHost(); sync(); });
    listen('chengmo:note-created', 'note-controls-created', event => { pendingCreatedNoteId = event.detail?.id || ''; sync(); });
    listen('chengmo:notes-state-updated', 'note-controls-state', () => { stateCache.raw = undefined; sync(); });
    window.addEventListener('storage', event => {
      if (event.key === stateKey) stateCache.raw = undefined;
      if ([annotationKey, recentKey, drawingKey].includes(event.key)) valueCache.delete(event.key);
    });
    watchHost();
    window.addEventListener('pagehide', saveSession);
    document.addEventListener('click', async event => {
      const courseDelete = event.target.closest?.('.course-group__delete');
      if (courseDelete) {
        event.preventDefault(); event.stopPropagation();
        const group = courseDelete.closest('.course-group'); const state = readState();
        const courseId = group?.dataset.courseId || courseIdForButton(group?.querySelector('.course-button'), state);
        const courses = Array.isArray(state.courses) ? state.courses : [];
        const course = courses.find(item => item.id === courseId);
        if (!course) { alert('\u65e0\u6cd5\u786e\u8ba4\u8fd9\u4e2a\u5206\u7c7b\u3002\u8bf7\u5237\u65b0\u540e\u91cd\u8bd5\u3002'); return; }
        if (courses.length <= 1) { alert('\u81f3\u5c11\u4fdd\u7559\u4e00\u4e2a\u7b14\u8bb0\u5206\u7c7b\u3002'); return; }
        const noteCount = (state.notes || []).filter(note => note?.courseId === courseId).length;
        if (noteCount) {
          alert(`\u300c${course.name}\u300d\u4e2d\u8fd8\u6709 ${noteCount} \u7bc7\u7b14\u8bb0\u3002\n\n\u4e3a\u4e86\u907f\u514d\u7b14\u8bb0\u88ab\u8bef\u5220\uff0c\u8bf7\u5148\u5728\u7f16\u8f91\u6a21\u5f0f\u5c06\u5b83\u4eec\u79fb\u52a8\u5230\u5176\u4ed6\u5206\u7c7b\u3002`);
          return;
        }
        if (!confirm(`\u786e\u5b9a\u5220\u9664\u7a7a\u5206\u7c7b\u300c${course.name}\u300d\uff1f`)) return;
        const remaining = courses.filter(item => item.id !== courseId);
        try {
          localStorage.setItem(stateKey, JSON.stringify({ ...state, courses: remaining }));
          const session = readSession();
          if (session?.courseId === courseId) localStorage.setItem(readingSessionKey, JSON.stringify({ ...session, courseId: remaining[0]?.id || '' }));
          await window.chengmoStorage?.flush?.();
          window.location.reload();
        } catch {
          alert('\u5220\u9664\u5206\u7c7b\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u6d4f\u89c8\u5668\u7684\u672c\u5730\u5b58\u50a8\u540e\u91cd\u8bd5\u3002');
        }
        return;
      }
      const close = event.target.closest?.('.compact-note__delete');
      if (!close) {
        if (event.target.closest?.('.compact-note, .course-button')) window.setTimeout(saveSession, 0);
        return;
      }
      event.preventDefault(); event.stopPropagation();
      const noteButton = close.closest('.compact-note');
      if (!noteButton) return;
      const state = readState(); const notes = state.notes || [];
      const knownIds = new Set(notes.map(note => note.id));
      const targetId = reactKey(noteButton, knownIds) || noteButton.dataset.noteId || '';
      const target = notes.find(item => item.id === targetId);
      if (!target) { alert('\u65e0\u6cd5\u786e\u8ba4\u8fd9\u7bc7\u7b14\u8bb0\u3002\u8bf7\u5237\u65b0\u540e\u91cd\u8bd5\u3002'); return; }
      const annotations = readArray(annotationKey) || [];
      const drawings = readRecord(drawingKey) || {};
      const annotationCount = annotations.filter(item => item?.noteId === target.id).length;
      const drawingCount = Array.isArray(drawings[target.id]) ? drawings[target.id].length : 0;
      const related = [annotationCount && `${annotationCount} \u6761\u6587\u672c\u6807\u6ce8`, drawingCount && `${drawingCount} \u6761\u7ed8\u56fe\u7b14\u8ff9`].filter(Boolean).join('\u3001');
      const relatedHint = related ? `\n\n\u540c\u65f6\u4f1a\u5220\u9664\uff1a${related}\u3002` : '';
      if (!confirm(`\u786e\u5b9a\u5220\u9664\u300c${noteTitle(target)}\u300d\uff1f${relatedHint}`)) return;
      if (!confirm('\u8bf7\u518d\u6b21\u786e\u8ba4\uff1a\u5220\u9664\u540e\u65e0\u6cd5\u64a4\u9500\u3002')) return;
      applyDeleteControls();
      const visibleIds = [...document.querySelectorAll('.compact-note')].map(card => card.dataset.noteId).filter(id => knownIds.has(id));
      const selectedId = document.querySelector('.compact-note.selected')?.dataset.noteId || readSession()?.noteId || '';
      const selectedIndex = visibleIds.indexOf(target.id);
      const successorId = selectedIndex < 0 ? '' : visibleIds.slice(selectedIndex + 1).concat(visibleIds.slice(0, selectedIndex)).find(id => id !== target.id) || '';
      const nextId = selectedId === target.id ? successorId : (notes.some(note => note.id === selectedId && note.id !== target.id) ? selectedId : '');
      const courseId = activeCourseId(state) || target.courseId || '';
      const query = document.querySelector('.search input')?.value || '';
      if (!writeDeletion({ state, targetId: target.id, nextId, courseId })) { alert('\u5220\u9664\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u6d4f\u89c8\u5668\u7684\u672c\u5730\u5b58\u50a8\u7a7a\u95f4\u540e\u91cd\u8bd5\u3002'); return; }
      // Reloading lets React load the changed note data cleanly. Preserve the
      // current list and reader target, then restore them exactly once.
      sessionStorage.setItem(keepListOpenKey, JSON.stringify({ courseId, nextId, query }));
      sessionStorage.setItem('chengmo-pending-notice', JSON.stringify({ message: `\u5df2\u5220\u9664\u300c${noteTitle(target)}\u300d\u3002` }));
      // Wait for the asynchronous note store before reloading. Otherwise a
      // long-running IndexedDB write can restore the old note on the next page.
      try { await window.chengmoStorage?.flush?.(); } catch {}
      window.location.reload();
    }, true);
  };
  (runtime?.whenReady || (task => document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', task, { once: true }) : task()))(start);
})();
