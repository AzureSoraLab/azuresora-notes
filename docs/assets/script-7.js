
(() => {
  const recentKey = 'chengmo-recent-notes-v1';
  const stateKey = 'chengmo-notes-v1';
  const maxRecent = 5;
  const runtime = window.chengmoRuntime;
  const enqueue = runtime?.schedule || window.chengmoSchedule || ((_, task) => window.requestAnimationFrame(task));
  const listen = runtime?.on || ((type, _, listener) => { document.addEventListener(type, listener); return () => document.removeEventListener(type, listener); });
  const readRecent = () => { try { const value = JSON.parse(localStorage.getItem(recentKey) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } };
  const saveRecent = items => localStorage.setItem(recentKey, JSON.stringify(items.slice(0, maxRecent)));
  const noteState = () => { try { const value = JSON.parse(localStorage.getItem(stateKey) || '{}'); return value && typeof value === 'object' ? value : {}; } catch { return {}; } };
  const noteTitle = note => note?.title?.trim() || '未命名笔记';
  const noteSubtitle = note => (Array.isArray(note?.tags) ? note.tags.slice(0, 2).map(tag => `#${tag}`).join('  ') : '') || '未添加标签';
  const recentRecord = note => ({ id: note.id, courseId: note.courseId || '', title: noteTitle(note), subtitle: noteSubtitle(note) });

  // React does not expose course IDs in attributes, so resolve them through
  // its keyed list and retain an index fallback for the static layout.
  const courseButtonForId = (courseId, state) => {
    const courses = state.courses || [];
    const ids = new Set(courses.map(course => course.id));
    const buttons = [...document.querySelectorAll('.course-button')];
    const keyed = buttons.find(button => {
      const fiberKey = Object.keys(button).find(key => key.startsWith('__reactFiber$'));
      const fiber = fiberKey && button[fiberKey];
      const id = fiber?.key ?? fiber?.alternate?.key;
      return typeof id === 'string' && ids.has(id) && id === courseId;
    });
    if (keyed) return keyed;
    const index = courses.findIndex(course => course.id === courseId);
    return index < 0 ? null : buttons[index] || null;
  };
  const activeCourseId = state => {
    const active = document.querySelector('.course-button.active');
    if (!active) return '';
    const courses = state.courses || [];
    // Resolve the selected React key directly. The old implementation called
    // courseButtonForId once per course, which repeated the same DOM scan when
    // recent reading navigated across a large category library.
    const ids = new Set(courses.map(course => course.id));
    const fiberKey = Object.keys(active).find(key => key.startsWith('__reactFiber$'));
    const fiber = fiberKey && active[fiberKey];
    const keyed = fiber?.key ?? fiber?.alternate?.key;
    if (typeof keyed === 'string' && ids.has(keyed)) return keyed;
    const index = [...document.querySelectorAll('.course-button')].indexOf(active);
    return index < 0 ? '' : courses[index]?.id || '';
  };
  const noteButtonForId = (noteId, state) => {
    const direct = [...document.querySelectorAll('.compact-note')].find(button => button.dataset.noteId === noteId);
    if (direct) return direct;
    const note = (state.notes || []).find(item => item.id === noteId);
    if (!note) return null;
    const title = noteTitle(note); const subtitle = noteSubtitle(note);
    const matches = [...document.querySelectorAll('.compact-note')].filter(button => button.querySelector('strong')?.textContent?.trim() === title && button.querySelector('small')?.textContent?.trim() === subtitle);
    return matches.length === 1 ? matches[0] : null;
  };
  function selectedNote(state) {
    const button = document.querySelector('.compact-note.selected');
    const noteId = button?.dataset.noteId;
    const notes = state.notes || [];
    const note = noteId ? notes.find(item => item.id === noteId) : null;
    if (note) return note;
    const title = button?.querySelector('strong')?.textContent?.trim();
    if (!title) return null;
    const matches = notes.filter(item => noteTitle(item) === title);
    return matches.length === 1 ? matches[0] : null;
  }
  function validRecentNotes(state) {
    const notesById = new Map((state.notes || []).map(note => [note.id, note]));
    const seen = new Set();
    const notes = [];
    for (const item of readRecent()) {
      const note = notesById.get(item?.id);
      if (note && !seen.has(note.id)) { seen.add(note.id); notes.push(note); }
    }
    return notes.slice(0, maxRecent);
  }
  function remember(note) {
    if (!note?.id) return;
    const items = readRecent().filter(item => item?.id !== note.id);
    saveRecent([recentRecord(note), ...items]);
  }
  function closeListIfNeeded(courseButton) {
    if (document.querySelector('.app-shell')?.classList.contains('note-list-open')) courseButton?.click();
  }
  let activeNavigation = null;
  function navigate(noteId) {
    const state = noteState(); const note = (state.notes || []).find(item => item.id === noteId);
    if (!note) { render(state, true); return; }
    const courseButton = courseButtonForId(note.courseId, state);
    if (!courseButton) return;
    // A new recent-note click supersedes any pending category/list retry.
    activeNavigation?.finish();
    let complete = false;
    let stopWaitingForList = null;
    const finish = () => {
      if (complete) return;
      complete = true;
      stopWaitingForList?.(); stopWaitingForList = null;
      window.clearTimeout(timeout);
      if (window.chengmoSilentCourseSwitch === note.courseId) window.chengmoSilentCourseSwitch = '';
      if (activeNavigation?.finish === finish) activeNavigation = null;
    };
    activeNavigation = { finish };
    let retries = 0;
    const tryOpen = () => {
      if (complete) return;
      const target = noteButtonForId(note.id, noteState());
      if (!target) {
        // React may replace the list one frame after a cross-category switch.
        // Retry briefly instead of leaving the recent-note click without a result.
        if (retries++ < 12) window.requestAnimationFrame(tryOpen);
        return;
      }
      target.click();
      window.requestAnimationFrame(() => closeListIfNeeded(courseButton));
      finish();
    };
    const timeout = window.setTimeout(finish, 1600);
    if (activeCourseId(state) === note.courseId) { tryOpen(); return; }
    // The core course handler reads this marker and changes categories while
    // preserving a closed note list. No temporary panel is ever rendered.
    window.chengmoSilentCourseSwitch = note.courseId;
    stopWaitingForList = listen('chengmo:note-list-ready', 'recent-notes-navigation', tryOpen);
    courseButton.click();
    window.requestAnimationFrame(tryOpen);
  }
  function render(state = noteState(), force = false) {
    const content = document.querySelector('.library-content'); if (!content) return;
    let section = content.querySelector('.recent-notes');
    if (!section) {
      section = document.createElement('section'); section.className = 'recent-notes';
      section.addEventListener('click', event => {
        const button = event.target.closest('.recent-notes__item');
        if (button?.dataset.noteId) navigate(button.dataset.noteId);
      });
      const storage = content.querySelector('.storage-note'); content.insertBefore(section, storage || null);
    }
    const items = validRecentNotes(state);
    const currentId = document.querySelector('.compact-note.selected')?.dataset.noteId || '';
    const signature = `${currentId}\u001e${items.map(note => `${note.id}|${noteTitle(note)}|${noteSubtitle(note)}`).join('\u001f')}`;
    if (!force && section.dataset.recentSignature === signature) return;
    section.replaceChildren();
    const title = document.createElement('p'); title.className = 'recent-notes__title'; title.textContent = '最近阅读笔记'; section.append(title);
    if (!items.length) { const empty = document.createElement('p'); empty.className = 'recent-notes__empty'; empty.textContent = '\u6253\u5f00\u8fc7\u7684\u7b14\u8bb0\u4f1a\u663e\u793a\u5728\u8fd9\u91cc\u3002'; section.append(empty); return; }
    items.forEach(note => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'recent-notes__item';
      const isCurrent = note.id === currentId;
      button.dataset.noteId = note.id; button.title = isCurrent ? `正在阅读：${noteTitle(note)}` : noteTitle(note);
      button.classList.toggle('is-current', isCurrent); button.setAttribute('aria-current', isCurrent ? 'page' : 'false');
      button.textContent = noteTitle(note); section.append(button);
    });
    section.dataset.recentSignature = signature;
  }
  let previous = ''; let syncFrame = 0; let syncForce = false;
  const sync = force => {
    syncFrame = 0;
    const state = noteState(); const note = selectedNote(state); const token = note?.id || '';
    if (token && token !== previous) { previous = token; remember(note); force = true; }
    render(state, force || !document.querySelector('.recent-notes'));
  };
  const scheduleSync = force => {
    syncForce ||= Boolean(force);
    if (syncFrame) return;
    syncFrame = 1;
    const run = () => { const shouldForce = syncForce; syncForce = false; sync(shouldForce); };
    enqueue('recent-notes', run);
  };
  const start = () => {
    let observedContent = null;
    let contentObserver = null;
    const watchContent = () => {
      const content = document.querySelector('.library-content');
      if (!content || content === observedContent) return;
      contentObserver?.disconnect();
      contentObserver = new MutationObserver(records => {
        // The recent-notes section is managed by this module. Ignore its own
        // inserts and only resync when React replaces the library controls.
        if (records.some(record => [...record.addedNodes].some(node => node.nodeType === 1 && !node.matches?.('.recent-notes') && !node.closest?.('.recent-notes')))) scheduleSync(true);
      });
      contentObserver.observe(content, { childList: true });
      observedContent = content;
    };
    const syncAndWatch = () => { watchContent(); scheduleSync(true); };
    listen('chengmo:ui-mounted', 'recent-notes-ui', syncAndWatch);
    listen('chengmo:note-selected', 'recent-notes-selection', scheduleSync);
    window.addEventListener('storage', event => { if (event.key === stateKey || event.key === recentKey) scheduleSync(true); });
    syncAndWatch();
  };
  (runtime?.whenReady || (task => document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', task, { once: true }) : task()))(start);
})();
