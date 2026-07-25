(() => {
  const runtime = window.chengmoRuntime;
  const enqueue = runtime?.schedule || window.chengmoSchedule || ((_, task) => window.requestAnimationFrame(task));
  const listen = runtime?.on || ((type, _, listener) => { document.addEventListener(type, listener); return () => document.removeEventListener(type, listener); });
  const emit = runtime?.emit || ((type, detail) => document.dispatchEvent(new CustomEvent(type, { detail })));
  const stateKey = 'chengmo-notes-v1';
  const recentKey = 'chengmo-recent-notes-v1';
  const annotationKey = 'chengmo-text-selection-annotations-v1';
  const drawingKey = 'chengmo-freehand-annotations-v1';
  const keepListOpenKey = 'chengmo-keep-note-list-open';
  const mobileInlineRestoreKey = 'chengmo-restore-mobile-inline-course';
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
  const noteCards = (list = document.querySelector('.note-index-scroll')) => list ? [...list.querySelectorAll(':scope > .compact-note')] : [];
  const noteListContext = () => {
    const list = document.querySelector('.note-index-scroll');
    const cards = noteCards(list);
    return {
      list,
      cards,
      searchInput: document.querySelector('.note-list .search input'),
      selectedCard: cards.find(card => card.classList.contains('selected')) || null
    };
  };
  const courseButtons = () => [...document.querySelectorAll('.course-button')];
  const cardForId = (id, cards = noteCards()) => cards.find(card => card.dataset.noteId === id) || null;
  const courseContext = (state = readState(), buttons = courseButtons()) => {
    const courses = Array.isArray(state.courses) ? state.courses : [];
    const ids = new Set(courses.map(course => course.id));
    const idByButton = new Map();
    const buttonById = new Map();
    buttons.forEach((button, index) => {
      const id = reactKey(button, ids) || courses[index]?.id || '';
      if (!id) return;
      idByButton.set(button, id);
      buttonById.set(id, button);
    });
    return { courses, buttons, idByButton, buttonById };
  };
  const courseButtonForId = (courseId, state = readState(), buttons = courseButtons(), context = courseContext(state, buttons)) => {
    return context.buttonById.get(courseId) || null;
  };
  const activeCourseId = (state = readState(), buttons = courseButtons(), context = courseContext(state, buttons)) => {
    const active = document.querySelector('.course-button.active');
    return active ? context.idByButton.get(active) || '' : '';
  };
  const courseIdForButton = (button, state = readState(), buttons = courseButtons(), context = courseContext(state, buttons)) => {
    return context.idByButton.get(button) || '';
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
  let mobileInlineCourseId = '';
  let suppressMobileCourseToggle = false;
  const mobileLibraryIsActive = () => window.matchMedia('(max-width: 760px)').matches && document.querySelector('.library')?.classList.contains('mobile-active');
  const clearMobileInlineNotes = (except = null) => {
    document.querySelectorAll('.mobile-course-notes').forEach(list => {
      if (list.parentElement !== except) list.remove();
    });
  };
  const syncMobileInlineSelection = (list, selectedId) => {
    list.querySelectorAll('.mobile-course-note').forEach(button => {
      button.classList.toggle('is-current', button.dataset.noteId === selectedId);
    });
  };
  const renderMobileInlineNotes = () => {
    if (!mobileLibraryIsActive() || !mobileInlineCourseId) return;
    const state = readState();
    const buttons = courseButtons();
    const context = courseContext(state, buttons);
    const courseButton = context.buttonById.get(mobileInlineCourseId);
    const group = courseButton?.closest('.course-group');
    if (!group) return;
    clearMobileInlineNotes(group);
    let list = group.querySelector(':scope > .mobile-course-notes');
    if (!list) {
      list = document.createElement('div');
      list.className = 'mobile-course-notes';
      list.setAttribute('aria-label', '该分类的笔记');
      group.append(list);
    }
    list.dataset.courseId = mobileInlineCourseId;
    const notes = visibleNotes(state, mobileInlineCourseId, '');
    const selectedId = document.querySelector('.compact-note.selected')?.dataset.noteId || '';
    // Most UI lifecycle events do not alter this category. Keep its existing
    // mobile list and only refresh the selected marker in that common case.
    const signature = JSON.stringify(notes.map(note => [note.id, note.title || '', note.updatedAt || '', Array.isArray(note.tags) ? note.tags : []]));
    if (list.dataset.renderSignature === signature) {
      syncMobileInlineSelection(list, selectedId);
      return;
    }
    const fragment = document.createDocumentFragment();
    if (!notes.length) {
      const empty = document.createElement('p');
      empty.className = 'mobile-course-notes__empty';
      empty.textContent = '暂无笔记';
      fragment.append(empty);
    } else {
      notes.forEach(note => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'mobile-course-note';
        button.dataset.noteId = note.id;
        button.setAttribute('aria-label', `打开笔记「${noteTitle(note)}」`);
        if (note.id === selectedId) button.classList.add('is-current');
        const dot = document.createElement('span'); dot.className = 'mobile-course-note__dot'; dot.textContent = '·';
        const text = document.createElement('span'); text.className = 'mobile-course-note__text';
        const title = document.createElement('strong'); title.textContent = noteTitle(note);
        const subtitle = document.createElement('small'); subtitle.textContent = noteSubtitle(note);
        const remove = document.createElement('span');
        remove.className = 'mobile-course-note__delete'; remove.textContent = '\u00d7';
        remove.title = '\u5220\u9664\u7b14\u8bb0'; remove.setAttribute('role', 'button');
        remove.setAttribute('aria-label', `\u5220\u9664\u7b14\u8bb0\u300c${noteTitle(note)}\u300d`); remove.tabIndex = 0;
        remove.addEventListener('pointerdown', event => event.stopPropagation());
        remove.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.currentTarget.click(); }
        });
        text.append(title, subtitle); button.append(dot, text, remove); fragment.append(button);
      });
    }
    list.replaceChildren(fragment);
    list.dataset.renderSignature = signature;
  };
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
  const applyDeleteControls = (state = readState(), cards = noteCards(), buttons = courseButtons(), context = courseContext(state, buttons), query = '') => {
    // Most observer callbacks are caused by a small React text update. When
    // every rendered card is already bound, avoid rebuilding note metadata and
    // notifying the other reader enhancements again.
    if (!cards.some(card => !card.dataset.noteId || !card.querySelector(':scope > .compact-note__delete'))) return false;
    const courseId = activeCourseId(state, buttons, context);
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
  const applyCourseDeleteControls = (state = readState(), buttons = courseButtons(), context = courseContext(state, buttons)) => {
    const groups = [...document.querySelectorAll('.course-group')];
    if (!groups.some(group => !group.dataset.courseId || !group.querySelector(':scope > .course-group__delete'))) return false;
    groups.forEach(group => {
      const button = group.querySelector('.course-button');
      const courseId = button && courseIdForButton(button, state, buttons, context);
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
  const prepareNoteDeletion = (state, targetId) => {
    const notes = Array.isArray(state.notes) ? state.notes : [];
    const target = notes.find(note => note?.id === targetId);
    if (!target) return null;
    const annotations = readArray(annotationKey) || [];
    const recent = readArray(recentKey) || [];
    const drawings = readRecord(drawingKey) || {};
    const nextAnnotations = annotations.filter(item => item?.noteId !== targetId);
    const nextRecent = recent.filter(item => item?.id !== targetId);
    const drawingCount = Array.isArray(drawings[targetId]) ? drawings[targetId].length : 0;
    const hasDrawing = Object.prototype.hasOwnProperty.call(drawings, targetId);
    const nextDrawings = hasDrawing ? { ...drawings } : drawings;
    if (hasDrawing) delete nextDrawings[targetId];
    return {
      target,
      targetId,
      nextState: { ...state, notes: notes.filter(note => note.id !== targetId) },
      nextAnnotations,
      nextRecent,
      nextDrawings,
      annotationCount: annotations.length - nextAnnotations.length,
      drawingCount,
      annotationsChanged: annotations.length !== nextAnnotations.length,
      recentChanged: recent.length !== nextRecent.length,
      drawingsChanged: hasDrawing
    };
  };
  const writeDeletion = ({ deletion, nextId, courseId, listOpen = true }) => {
    const snapshot = new Map([stateKey, annotationKey, recentKey, drawingKey, readingSessionKey].map(key => [key, localStorage.getItem(key)]));
    const restoreSnapshot = () => snapshot.forEach((value, key) => value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value));
    try {
      if (deletion.annotationsChanged) localStorage.setItem(annotationKey, JSON.stringify(deletion.nextAnnotations));
      if (deletion.recentChanged) localStorage.setItem(recentKey, JSON.stringify(deletion.nextRecent));
      if (deletion.drawingsChanged) localStorage.setItem(drawingKey, JSON.stringify(deletion.nextDrawings));
      localStorage.setItem(stateKey, JSON.stringify(deletion.nextState));
      if (nextId) localStorage.setItem(readingSessionKey, JSON.stringify({ noteId: nextId, courseId, listOpen }));
      else localStorage.removeItem(readingSessionKey);
      // Queue the IndexedDB delete only after its synchronous source-of-truth
      // writes succeed, so a local rollback cannot race an orphan cleanup.
      window.chengmoStorage?.removeDrawing(deletion.targetId);
      return true;
    } catch {
      try { restoreSnapshot(); } catch {}
      return false;
    }
  };
  const prepareCourseDeletion = (state, courseId) => {
    const courses = Array.isArray(state.courses) ? state.courses : [];
    const course = courses.find(item => item?.id === courseId);
    if (!course || courses.length <= 1) return null;
    let noteCount = 0;
    (state.notes || []).forEach(note => { if (note?.courseId === courseId) noteCount += 1; });
    return { course, courseId, noteCount, nextState: { ...state, courses: courses.filter(item => item.id !== courseId) } };
  };
  const writeCourseDeletion = deletion => {
    const snapshot = new Map([stateKey, readingSessionKey].map(key => [key, localStorage.getItem(key)]));
    const restoreSnapshot = () => snapshot.forEach((value, key) => value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value));
    try {
      localStorage.setItem(stateKey, JSON.stringify(deletion.nextState));
      const session = readSession();
      if (session?.courseId === deletion.courseId) localStorage.setItem(readingSessionKey, JSON.stringify({ ...session, courseId: deletion.nextState.courses[0]?.id || '' }));
      return true;
    } catch {
      try { restoreSnapshot(); } catch {}
      return false;
    }
  };
  const deleteNote = async ({ targetId, mobile = false }) => {
    const state = readState(); const notes = state.notes || [];
    const deletion = prepareNoteDeletion(state, targetId);
    if (!deletion) { alert('\u65e0\u6cd5\u786e\u8ba4\u8fd9\u7bc7\u7b14\u8bb0\u3002\u8bf7\u5237\u65b0\u540e\u91cd\u8bd5\u3002'); return; }
    const related = [deletion.annotationCount && `${deletion.annotationCount} \u6761\u6587\u672c\u6807\u6ce8`, deletion.drawingCount && `${deletion.drawingCount} \u6761\u7ed8\u56fe\u7b14\u8ff9`].filter(Boolean).join('\u3001');
    const relatedHint = related ? `\n\n\u540c\u65f6\u4f1a\u5220\u9664\uff1a${related}\u3002` : '';
    if (!confirm(`\u786e\u5b9a\u5220\u9664\u300c${noteTitle(deletion.target)}\u300d\uff1f${relatedHint}`)) return;
    if (!confirm('\u8bf7\u518d\u6b21\u786e\u8ba4\uff1a\u5220\u9664\u540e\u65e0\u6cd5\u64a4\u9500\u3002')) return;
    const listContext = noteListContext();
    const buttons = courseButtons(); const context = courseContext(state, buttons);
    applyDeleteControls(state, listContext.cards, buttons, context, listContext.searchInput?.value?.toLowerCase() || '');
    const knownIds = new Set(notes.map(note => note.id));
    const visibleIds = listContext.cards.map(card => card.dataset.noteId).filter(id => knownIds.has(id));
    const courseIds = notes.filter(note => note.courseId === deletion.target.courseId).map(note => note.id);
    const orderedIds = visibleIds.includes(deletion.target.id) ? visibleIds : courseIds;
    const selectedId = listContext.selectedCard?.dataset.noteId || readSession()?.noteId || '';
    const selectedIndex = orderedIds.indexOf(deletion.target.id);
    const successorId = selectedIndex < 0 ? '' : orderedIds.slice(selectedIndex + 1).concat(orderedIds.slice(0, selectedIndex)).find(id => id !== deletion.target.id) || '';
    const nextId = selectedId === deletion.target.id ? successorId : (notes.some(note => note.id === selectedId && note.id !== deletion.target.id) ? selectedId : '');
    const courseId = mobile ? deletion.target.courseId : (activeCourseId(state, buttons, context) || deletion.target.courseId || '');
    const query = listContext.searchInput?.value || '';
    if (!writeDeletion({ deletion, nextId, courseId, listOpen: !mobile })) { alert('\u5220\u9664\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u6d4f\u89c8\u5668\u7684\u672c\u5730\u5b58\u50a8\u7a7a\u95f4\u540e\u91cd\u8bd5\u3002'); return; }
    // Mobile has no separate note-list panel. Restore the expanded category
    // after reload so deletion keeps the user in the same mobile context.
    if (mobile) sessionStorage.setItem(mobileInlineRestoreKey, JSON.stringify({ courseId, noteId: nextId }));
    else sessionStorage.setItem(keepListOpenKey, JSON.stringify({ courseId, nextId, query }));
    sessionStorage.setItem('chengmo-pending-notice', JSON.stringify({ message: `\u5df2\u5220\u9664\u300c${noteTitle(deletion.target)}\u300d\u3002` }));
    try { await window.chengmoStorage?.flush?.(); } catch {}
    window.location.reload();
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
    let mobileRestoreScheduled = false;
    const watchList = (list = document.querySelector('.note-index-scroll')) => {
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
        const listContext = noteListContext();
        const context = courseContext(state, buttons);
        const notesChanged = applyDeleteControls(state, listContext.cards, buttons, context, listContext.searchInput?.value?.toLowerCase() || '');
        const coursesChanged = applyCourseDeleteControls(state, buttons, context);
        watchList(listContext.list);
        renderMobileInlineNotes();
        // Other modules use this event to resolve freshly rendered list nodes.
        // Do not wake them for observer noise when nothing in the list changed.
        if (notesChanged || coursesChanged) emit('chengmo:note-list-ready');
        if (!sessionRestoreScheduled && !sessionStorage.getItem(keepListOpenKey) && !sessionStorage.getItem(mobileInlineRestoreKey)) {
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
                const listContext = noteListContext();
                applyDeleteControls(readState(), listContext.cards, courseButtons(), undefined, listContext.searchInput?.value?.toLowerCase() || '');
                cardForId(note.id, listContext.cards)?.click();
                window.setTimeout(() => {
                  if (!latest.listOpen && document.querySelector('.app-shell')?.classList.contains('note-list-open')) courseButton.click();
                  document.documentElement.classList.remove('chengmo-restoring-session');
                }, 80);
              }, 140);
            }, 360);
          }
        }
        const mobileRestore = (() => { try { return JSON.parse(sessionStorage.getItem(mobileInlineRestoreKey) || 'null'); } catch { return null; } })();
        if (mobileRestore && !mobileRestoreScheduled) {
          mobileRestoreScheduled = true; sessionRestoreScheduled = true;
          window.setTimeout(() => {
            const restore = (() => { try { return JSON.parse(sessionStorage.getItem(mobileInlineRestoreKey) || 'null'); } catch { return null; } })();
            if (!restore) return;
            const library = document.querySelector('.library');
            const libraryButton = [...document.querySelectorAll('.mobile-nav button')].find(button => button.textContent?.trim() === '\u8d44\u6599\u5e93');
            if (!library?.classList.contains('mobile-active')) libraryButton?.click();
            window.setTimeout(() => {
              const state = readState(); const courseButton = courseButtonForId(restore.courseId, state);
              if (!courseButton || !mobileLibraryIsActive()) { sessionStorage.removeItem(mobileInlineRestoreKey); return; }
              mobileInlineCourseId = '';
              courseButton.click();
              sessionStorage.removeItem(mobileInlineRestoreKey);
              if (restore.noteId) window.setTimeout(() => {
                renderMobileInlineNotes();
                [...document.querySelectorAll('.mobile-course-note')].find(button => button.dataset.noteId === restore.noteId)?.click();
              }, 120);
            }, 140);
          }, 160);
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
            window.setTimeout(() => {
              const listContext = noteListContext();
              applyDeleteControls(readState(), listContext.cards, courseButtons(), undefined, listContext.searchInput?.value?.toLowerCase() || '');
              cardForId(restore.nextId, listContext.cards)?.click();
            }, 100);
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
      const mobileClose = event.target.closest?.('.mobile-course-note__delete');
      if (mobileClose) {
        event.preventDefault(); event.stopPropagation();
        await deleteNote({ targetId: mobileClose.closest('.mobile-course-note')?.dataset.noteId || '', mobile: true });
        return;
      }
      const inlineNote = event.target.closest?.('.mobile-course-note');
      if (inlineNote) {
        event.preventDefault(); event.stopPropagation();
        const noteId = inlineNote.dataset.noteId || '';
        const state = readState(); const note = (state.notes || []).find(item => item.id === noteId);
        const courseButton = note && courseButtonForId(note.courseId, state);
        if (!note || !courseButton) return;
        // React owns the reader state. Open its compact list briefly, use its
        // real note button, then return the mobile library to the foreground.
        const listWasOpen = document.querySelector('.app-shell')?.classList.contains('note-list-open');
        if (!listWasOpen) courseButton.click();
        window.setTimeout(() => {
          const card = cardForId(noteId);
          if (!card) return;
          card.click();
          window.setTimeout(() => {
            if (document.querySelector('.app-shell')?.classList.contains('note-list-open')) {
              suppressMobileCourseToggle = true; courseButton.click();
            }
            // React re-renders the category tree after changing the reader.
            // Reattach after that commit instead of rendering into stale nodes.
            window.setTimeout(renderMobileInlineNotes, 80);
          }, 60);
        }, listWasOpen ? 0 : 90);
        return;
      }
      const courseButton = event.target.closest?.('.course-button');
      if (courseButton && mobileLibraryIsActive()) {
        if (suppressMobileCourseToggle) { suppressMobileCourseToggle = false; return; }
        const state = readState(); const buttons = courseButtons(); const context = courseContext(state, buttons);
        const courseId = courseIdForButton(courseButton, state, buttons, context);
        if (courseId) {
          const wasOpen = document.querySelector('.app-shell')?.classList.contains('note-list-open') === true;
          mobileInlineCourseId = mobileInlineCourseId === courseId ? '' : courseId;
          window.setTimeout(() => {
            // Category selection is still handled by React; suppress only its
            // mobile-only side effect of leaving the separate list panel open.
            if (document.querySelector('.app-shell')?.classList.contains('note-list-open')) {
              suppressMobileCourseToggle = true;
              document.querySelector('.course-button.active')?.click();
            }
            if (!mobileInlineCourseId) clearMobileInlineNotes();
            else renderMobileInlineNotes();
          }, 0);
        }
      }
      const courseDelete = event.target.closest?.('.course-group__delete');
      if (courseDelete) {
        event.preventDefault(); event.stopPropagation();
        const group = courseDelete.closest('.course-group'); const state = readState();
        const buttons = courseButtons(); const context = courseContext(state, buttons);
        const courseId = group?.dataset.courseId || courseIdForButton(group?.querySelector('.course-button'), state, buttons, context);
        const deletion = prepareCourseDeletion(state, courseId);
        if (!deletion) {
          const courses = Array.isArray(state.courses) ? state.courses : [];
          if (courses.length <= 1) alert('\u81f3\u5c11\u4fdd\u7559\u4e00\u4e2a\u7b14\u8bb0\u5206\u7c7b\u3002');
          else alert('\u65e0\u6cd5\u786e\u8ba4\u8fd9\u4e2a\u5206\u7c7b\u3002\u8bf7\u5237\u65b0\u540e\u91cd\u8bd5\u3002');
          return;
        }
        if (deletion.noteCount) {
          alert(`\u300c${deletion.course.name}\u300d\u4e2d\u8fd8\u6709 ${deletion.noteCount} \u7bc7\u7b14\u8bb0\u3002\n\n\u4e3a\u4e86\u907f\u514d\u7b14\u8bb0\u88ab\u8bef\u5220\uff0c\u8bf7\u5148\u5728\u7f16\u8f91\u6a21\u5f0f\u5c06\u5b83\u4eec\u79fb\u52a8\u5230\u5176\u4ed6\u5206\u7c7b\u3002`);
          return;
        }
        if (!confirm(`\u786e\u5b9a\u5220\u9664\u7a7a\u5206\u7c7b\u300c${deletion.course.name}\u300d\uff1f`)) return;
        try {
          if (!writeCourseDeletion(deletion)) throw new Error('Category state write failed');
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
      const state = readState(); const knownIds = new Set((state.notes || []).map(note => note.id));
      await deleteNote({ targetId: reactKey(noteButton, knownIds) || noteButton.dataset.noteId || '' });
    }, true);
  };
  (runtime?.whenReady || (task => document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', task, { once: true }) : task()))(start);
})();
