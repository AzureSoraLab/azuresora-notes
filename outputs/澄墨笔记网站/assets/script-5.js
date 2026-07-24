
(() => {
  const key = 'chengmo-text-selection-annotations-v1';
  const palette = ['#f8d84b', '#ff6b6b', '#72b64a', '#3ca8df', '#a687e8', '#d86ee8', '#f39a3e', '#a7aaa5'];
  let filter = null;
  let tagFilter = null;
  let searchFilter = '';
  let activeView = 'annotations';
  let current = null;
  let cachedItems = null; let markCache = new Map(); let shelfIndex = null; let markCacheDirty = true; let renderFrame = 0; let commentSaveTimer = 0;
  let shelfNodes = null;
  let outlineCache = { root: null, signature: '', items: [] };
  const read = () => cachedItems || (cachedItems = (() => { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } })());
  const invalidateShelfIndex = (marks = false) => { shelfIndex = null; markCacheDirty ||= marks; };
  const refreshMarkCache = () => {
    if (!markCacheDirty) return;
    markCache = new Map();
    document.querySelectorAll('mark.selection-annotation[data-annotation-id]').forEach(mark => { const id = mark.dataset.annotationId; const entry = markCache.get(id) || []; entry.push(mark.textContent || ''); markCache.set(id, entry); });
    markCacheDirty = false;
  };
  const annotationIndex = () => {
    if (shelfIndex) return shelfIndex;
    refreshMarkCache();
    const activeIds = new Set(markCache.keys());
    const items = read().filter(item => activeIds.has(item.id)).sort((a, b) => a.start - b.start).map(item => {
      const excerpt = markCache.get(item.id)?.join(' ') || item.text || 'Annotation';
      return { item, excerpt, searchable: `${excerpt} ${item.comment || ''} ${(item.tags || []).join(' ')}`.toLowerCase() };
    });
    shelfIndex = { items, tags: [...new Set(items.flatMap(entry => entry.item.tags || []))] };
    return shelfIndex;
  };
  const outlineEntries = () => {
    const root = document.querySelector('.outline-content');
    if (!root) return [];
    const sourceItems = [...root.querySelectorAll('button.level-2, button.level-3')];
    const signature = sourceItems.map(item => `${item.className}\u0000${item.textContent || ''}`).join('\u0001');
    if (outlineCache.root === root && outlineCache.signature === signature && outlineCache.items.every(item => item.source.isConnected)) return outlineCache.items;
    outlineCache = { root, signature, items: sourceItems.map(source => ({ source, className: source.className, text: source.textContent || '' })) };
    return outlineCache.items;
  };
  const commit = (detail = {}) => { invalidateShelfIndex(); localStorage.setItem(key, JSON.stringify(read())); document.dispatchEvent(new CustomEvent('chengmo:annotations-changed', { detail: { ...detail, source: 'shelf' } })); };
  const saveItem = (id, changes) => { const items = read(); const item = items.find(entry => entry.id === id); if (item) Object.assign(item, changes); commit({ type: 'update', id, changes }); };
  const flushCommentSave = () => { if (!commentSaveTimer) return; window.clearTimeout(commentSaveTimer); commentSaveTimer = 0; commit({ type: 'update', id: current, changes: { comment: read().find(item => item.id === current)?.comment || '' } }); };
  const scheduleCommentSave = () => { invalidateShelfIndex(); window.clearTimeout(commentSaveTimer); commentSaveTimer = window.setTimeout(() => { commentSaveTimer = 0; commit({ type: 'update', id: current, changes: { comment: read().find(item => item.id === current)?.comment || '' } }); }, 260); };
  const scheduleRender = () => {
    const shelf = shelfNodes?.shelf || document.querySelector('.annotation-shelf');
    if (!shelf || shelf.classList.contains('is-hidden') || renderFrame) return;
    renderFrame = window.requestAnimationFrame(() => { renderFrame = 0; render(); });
  };
  const renderTagSummary = () => {
    const summary = shelfNodes?.summary; if (!summary) return;
    const index = annotationIndex();
    summary.replaceChildren(...index.tags.map(tag => { const button = document.createElement('button'); button.type = 'button'; button.textContent = tag; button.classList.toggle('is-active', tagFilter === tag); button.addEventListener('click', () => { tagFilter = tagFilter === tag ? null : tag; scheduleRender(); }); return button; }));
  };
  const patchShelfCard = (id, changes) => {
    const list = shelfNodes?.list; const card = list?.querySelector(`[data-annotation-id="${id}"]`); const item = read().find(entry => entry.id === id);
    if (!card || !item) return false;
    if ('color' in changes) card.style.setProperty('--annotation-color', item.color);
    if ('comment' in changes) {
      const comment = card.querySelector('.annotation-shelf__comment'); const input = card.querySelector('.annotation-shelf__inline-comment');
      if (input && document.activeElement !== input) input.value = item.comment || '';
      else if (comment && item.comment?.trim()) comment.textContent = item.comment;
      else if (comment) comment.remove();
      else if (item.comment?.trim()) { const next = document.createElement('div'); next.className = 'annotation-shelf__comment'; next.textContent = item.comment; card.append(next); }
    }
    if ('tags' in changes) { const addTag = card.querySelector('.annotation-shelf__add-tag'); if (addTag) addTag.textContent = (item.tags || []).length ? `标签：${item.tags.join(', ')}` : '添加标签...'; renderTagSummary(); }
    return true;
  };
  function closeTagPopover() { document.querySelector('.annotation-tag-popover')?.remove(); }
  function showTagPopover(item, anchor) {
    closeTagPopover();
    const popover = document.createElement('div'); popover.className = 'annotation-tag-popover';
    const rect = anchor.getBoundingClientRect();
    const width = 276;
    const height = 132;
    popover.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, rect.left))}px`;
    popover.style.top = `${Math.max(8, Math.min(window.innerHeight - height - 8, rect.bottom + 6))}px`;
    const header = document.createElement('div'); header.className = 'annotation-tag-popover__head';
    const count = document.createElement('span'); count.className = 'annotation-tag-popover__count';
    const close = document.createElement('button'); close.type = 'button'; close.className = 'annotation-tag-popover__close'; close.textContent = '\u00d7'; close.title = '关闭'; close.setAttribute('aria-label', '关闭标签'); close.addEventListener('click', closeTagPopover); header.append(count, close);
    const items = document.createElement('div'); items.className = 'annotation-tag-popover__items';
    const inputLine = document.createElement('div'); inputLine.className = 'annotation-tag-popover__add'; const input = document.createElement('input'); input.placeholder = '添加标签'; const add = document.createElement('button'); add.type = 'button'; add.textContent = '+'; inputLine.append(input, add);
    const draw = () => { const tags = item.tags || []; count.textContent = `${tags.length} 个标签`; items.replaceChildren(...tags.map(tag => { const row = document.createElement('div'); row.className = 'annotation-tag-popover__item'; const label = document.createElement('span'); label.textContent = `# ${tag}`; const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'annotation-tag-popover__remove'; remove.textContent = '\u00d7'; remove.title = '删除标签'; remove.setAttribute('aria-label', `删除标签 ${tag}`); remove.addEventListener('click', () => { item.tags = tags.filter(value => value !== tag); saveItem(item.id, { tags: item.tags }); draw(); scheduleRender(); window.chengmoNotice?.(`已删除标签 #${tag}`); }); row.append(label, remove); return row; })); };
    const addTag = () => { const tag = input.value.trim().replace(/^#/, ''); if (!tag) return; if ((item.tags || []).includes(tag)) { input.value = ''; window.chengmoNotice?.(`标签 #${tag} 已存在`); return; } item.tags = [...(item.tags || []), tag]; saveItem(item.id, { tags: item.tags }); input.value = ''; draw(); scheduleRender(); window.chengmoNotice?.(`已添加标签 #${tag}`); };
    add.addEventListener('click', addTag); input.addEventListener('keydown', event => { if (event.key === 'Enter') addTag(); }); draw(); popover.append(header, items, inputLine); document.body.append(popover); input.focus();
  }
  function build() {
    if (document.querySelector('.annotation-shelf')) return;
    const toggle = document.createElement('button');
    toggle.className = 'annotation-shelf-toggle';
    toggle.type = 'button'; toggle.title = '\u663e\u793a\u6807\u6ce8'; toggle.setAttribute('aria-label', '\u663e\u793a\u6807\u6ce8');
    const toggleIcon = document.createElement('span'); toggle.append(toggleIcon);
    const shelf = document.createElement('aside'); shelf.className = 'annotation-shelf is-hidden'; shelf.setAttribute('aria-label', '\u6807\u6ce8\u9762\u677f');
    const bar = document.createElement('div'); bar.className = 'annotation-shelf__bar';
    const tabs = document.createElement('div'); tabs.className = 'annotation-shelf__tabs';
    const grid = document.createElement('button'); grid.className = 'annotation-shelf__tab annotation-shelf__tab--grid annotation-shelf__tab--active'; grid.type = 'button'; grid.title = '\u6807\u6ce8'; grid.addEventListener('click', () => { activeView = 'annotations'; grid.classList.add('annotation-shelf__tab--active'); outline.classList.remove('is-active'); search.style.display = ''; scheduleRender(); });
    const outline = document.createElement('button'); outline.type = 'button'; outline.className = 'annotation-shelf__outline'; outline.title = '\u76ee\u5f55'; outline.setAttribute('aria-label', '\u672c\u6587\u76ee\u5f55'); outline.addEventListener('click', () => { activeView = 'outline'; outline.classList.add('is-active'); grid.classList.remove('annotation-shelf__tab--active'); search.style.display = 'none'; scheduleRender(); });
    const search = document.createElement('input'); search.type = 'search'; search.className = 'annotation-shelf__search'; search.placeholder = '\u641c\u7d22\u6807\u6ce8'; search.setAttribute('aria-label', '\u641c\u7d22\u6807\u6ce8'); search.addEventListener('input', () => { searchFilter = search.value.trim().toLowerCase(); scheduleRender(); });
    const close = document.createElement('button'); close.type = 'button'; close.className = 'annotation-shelf__close'; close.title = '\u5173\u95ed'; close.setAttribute('aria-label', '\u5173\u95ed\u6807\u6ce8\u9762\u677f'); close.textContent = '\u00d7'; close.addEventListener('click', () => { shelf.classList.add('is-hidden'); toggle.classList.remove('is-open'); toggle.title = '\u663e\u793a\u6807\u6ce8'; });
    tabs.append(grid); bar.append(tabs, outline, search, close);
    const list = document.createElement('div'); list.className = 'annotation-shelf__list';
    const filters = document.createElement('div'); filters.className = 'annotation-shelf__filters';
    palette.forEach(color => { const button = document.createElement('button'); button.type = 'button'; button.className = 'annotation-shelf__filter'; button.style.background = color; button.title = '\u6309\u989c\u8272\u7b5b\u9009'; button.addEventListener('click', () => { filter = filter === color ? null : color; filters.querySelectorAll('button').forEach(item => item.classList.toggle('is-active', item === button && filter === color)); scheduleRender(); }); filters.append(button); });
    const summary = document.createElement('div'); summary.className = 'annotation-shelf__tag-summary'; shelf.append(bar, list, filters, summary);
    document.body.append(toggle, shelf);
    shelfNodes = { shelf, list, filters, summary };
    const positionToggle = () => { const header = document.querySelector('.reader-header'); if (!header) return; const rect = header.getBoundingClientRect(); toggle.style.left = `${Math.max(8, rect.left + 13)}px`; toggle.style.top = `${rect.top + Math.max(5, (rect.height - 30) / 2)}px`; };
    const positionShelf = () => { const rect = toggle.getBoundingClientRect(); shelf.style.left = `${Math.max(8, rect.left)}px`; shelf.style.top = `${Math.min(window.innerHeight - 54, rect.bottom + 1)}px`; };
    let shelfWasDragged = false;
    bar.addEventListener('pointerdown', event => {
      if (event.target.closest('button, input')) return;
      const rect = shelf.getBoundingClientRect(); const offsetX = event.clientX - rect.left; const offsetY = event.clientY - rect.top;
      shelfWasDragged = false; bar.setPointerCapture(event.pointerId);
      const move = moveEvent => { shelfWasDragged = true; shelf.style.left = `${Math.max(8, Math.min(window.innerWidth - rect.width - 8, moveEvent.clientX - offsetX))}px`; shelf.style.top = `${Math.max(8, Math.min(window.innerHeight - rect.height - 8, moveEvent.clientY - offsetY))}px`; };
      const end = endEvent => { bar.releasePointerCapture?.(endEvent.pointerId); bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', end); bar.removeEventListener('pointercancel', end); };
      bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', end); bar.addEventListener('pointercancel', end);
    });
    // Align only after actual layout changes; a permanent animation frame loop
    // needlessly used CPU while the reader was idle.
    let positionFrame = 0;
    const schedulePosition = (force = false) => {
      // A hidden shelf has no visible geometry to maintain during reader scroll.
      if (!force && shelf.classList.contains('is-hidden')) return;
      if (positionFrame) return;
      positionFrame = window.requestAnimationFrame(() => { positionFrame = 0; positionToggle(); if (!shelf.classList.contains('is-hidden') && !shelfWasDragged) positionShelf(); });
    };
    const headerResizeObserver = window.ResizeObserver ? new ResizeObserver(schedulePosition) : null;
    let observedHeader = null;
    const watchHeader = () => {
      const header = document.querySelector('.reader-header');
      if (header !== observedHeader) {
        if (headerResizeObserver && observedHeader) headerResizeObserver.unobserve(observedHeader);
        if (headerResizeObserver && header) headerResizeObserver.observe(header);
        observedHeader = header;
      }
      schedulePosition(true);
    };
    // The data-tools module emits this only when React replaces a major UI region.
    // Rebinding the header is enough; observing the entire root caused needless work.
    document.addEventListener('chengmo:ui-mounted', () => { outlineCache = { root: null, signature: '', items: [] }; watchHeader(); });
    watchHeader();
    toggle.addEventListener('click', () => { const hidden = shelf.classList.toggle('is-hidden'); toggle.classList.toggle('is-open', !hidden); toggle.title = hidden ? '\u663e\u793a\u6807\u6ce8' : '\u9690\u85cf\u6807\u6ce8'; if (!hidden) { positionToggle(); positionShelf(); render(); } });
    window.addEventListener('resize', () => schedulePosition(true), { passive: true });
    document.addEventListener('scroll', () => schedulePosition(false), { capture: true, passive: true });
  }
  const courseButtonForId = (courseId, state) => {
    const ids = new Set((state.courses || []).map(course => course.id));
    const keyed = [...document.querySelectorAll('.course-button')].find(button => {
      const fiberKey = Object.keys(button).find(key => key.startsWith('__reactFiber$'));
      const fiber = fiberKey && button[fiberKey]; const id = fiber?.key ?? fiber?.alternate?.key;
      return typeof id === 'string' && ids.has(id) && id === courseId;
    });
    if (keyed) return keyed;
    const index = (state.courses || []).findIndex(course => course.id === courseId);
    return index < 0 ? null : document.querySelectorAll('.course-button')[index] || null;
  };
  function render() {
    const { list, summary, filters } = shelfNodes || {}; if (!list || !summary || !filters) return;
    if (activeView === 'outline') {
      filters.hidden = true; summary.hidden = true;
      list.replaceChildren(); summary.replaceChildren();
      const sourceItems = outlineEntries();
      if (!sourceItems.length) { const empty = document.createElement('div'); empty.className = 'annotation-shelf__outline-empty'; empty.textContent = '\u6682\u65e0\u76ee\u5f55'; list.append(empty); return; }
      const outlineList = document.createElement('div'); outlineList.className = 'annotation-shelf__outline-list';
      sourceItems.forEach(({ source, className, text }) => { const item = document.createElement('button'); item.type = 'button'; item.className = `annotation-shelf__outline-item ${className}`; item.textContent = text; item.addEventListener('click', () => source.click()); outlineList.append(item); }); list.append(outlineList); return;
    }
    filters.hidden = false; summary.hidden = false;
    const index = annotationIndex();
    const items = index.items.filter(entry => {
      const item = entry.item;
      return (!filter || item.color === filter) && (!tagFilter || (item.tags || []).includes(tagFilter)) && (!searchFilter || entry.searchable.includes(searchFilter));
    });
    list.replaceChildren();
    renderTagSummary();
    if (!items.length) { const empty = document.createElement('div'); empty.className = 'annotation-shelf__empty'; empty.textContent = searchFilter ? '\u6ca1\u6709\u5339\u914d\u7684\u6807\u6ce8' : filter ? '\u6ca1\u6709\u8be5\u989c\u8272\u7684\u6807\u6ce8' : '\u6682\u65e0\u6807\u6ce8'; list.append(empty); return; }
    items.forEach(({ item, excerpt }) => {
      const card = document.createElement('div'); card.className = `annotation-shelf__card ${current === item.id ? 'is-current' : ''}`; card.dataset.annotationId = item.id; card.style.setProperty('--annotation-color', item.color);
      const head = document.createElement('div'); head.className = 'annotation-shelf__card-head';
      const letter = document.createElement('span'); letter.className = 'annotation-shelf__letter'; letter.textContent = 'A';
      const page = document.createElement('span'); page.textContent = '\u6807\u6ce8';
      const more = document.createElement('span'); more.className = 'annotation-shelf__more'; more.textContent = '...'; head.append(letter, page, more);
      const excerptNode = document.createElement('div'); excerptNode.className = 'annotation-shelf__excerpt'; excerptNode.textContent = excerpt; card.append(head, excerptNode);
      if (current === item.id) { const commentInput = document.createElement('input'); commentInput.className = 'annotation-shelf__inline-comment'; commentInput.placeholder = '\u6dfb\u52a0\u8bc4\u8bba'; commentInput.value = item.comment || ''; commentInput.addEventListener('pointerdown', event => event.stopPropagation()); commentInput.addEventListener('click', event => event.stopPropagation()); commentInput.addEventListener('input', () => { item.comment = commentInput.value; scheduleCommentSave(); }); commentInput.addEventListener('blur', flushCommentSave); commentInput.addEventListener('keydown', event => { if (event.key !== 'Enter') return; event.preventDefault(); event.stopPropagation(); flushCommentSave(); commentInput.blur(); scheduleRender(); }); card.append(commentInput); const addTag = document.createElement('button'); addTag.type = 'button'; addTag.className = 'annotation-shelf__add-tag'; addTag.textContent = (item.tags || []).length ? `\u6807\u7b7e\uff1a${(item.tags || []).join(', ')}` : '\u6dfb\u52a0\u6807\u7b7e...'; addTag.addEventListener('pointerdown', event => event.stopPropagation()); addTag.addEventListener('click', event => { event.stopPropagation(); showTagPopover(item, addTag); }); card.append(addTag); } else if (item.comment?.trim()) { const comment = document.createElement('div'); comment.className = 'annotation-shelf__comment'; comment.textContent = item.comment; card.append(comment); }
      card.addEventListener('click', () => { if (current === item.id) { card.classList.toggle('is-expanded'); return; } current = item.id; scheduleRender(); const mark = document.querySelector(`mark.selection-annotation[data-annotation-id="${item.id}"]`); if (mark) mark.scrollIntoView({ behavior: 'smooth', block: 'center' }); else window.chengmoNotice?.('原文位置暂不可见，请切换回对应笔记后查看。'); }); list.append(card);
    });
  }
  window.addEventListener('load', () => { build(); render(); });
  document.addEventListener('chengmo:ui-mounted', () => { closeTagPopover(); invalidateShelfIndex(true); scheduleRender(); });
  document.addEventListener('chengmo:annotations-changed', event => {
    cachedItems = null;
    const detail = event.detail || {};
    const changes = detail.changes || {};
    // Comments and tags change card data only; they do not alter marked text.
    // Avoid another full document scan for those inexpensive metadata edits.
    const marksChanged = ['create', 'delete', 'reanchor'].includes(detail.type) || 'color' in changes || 'kind' in changes;
    invalidateShelfIndex(marksChanged);
    const filterAffected = ('color' in changes && filter) || ('tags' in changes && tagFilter) || ('comment' in changes && searchFilter) || ('tags' in changes && searchFilter);
    if (detail.type === 'update' && !marksChanged && !filterAffected && patchShelfCard(detail.id, changes)) return;
    scheduleRender();
  });
  document.addEventListener('pointerup', event => {
    // Do not rebuild the panel for ordinary navigation clicks. Text-annotation
    // changes happen through these marked controls and still refresh the shelf.
    if (!event.target.closest('.selection-annotation, .selection-annotation-menu')) return;
    cachedItems = null;
    invalidateShelfIndex(false);
    window.setTimeout(scheduleRender, 120);
  });
  window.addEventListener('storage', event => { if (event.key === key) { cachedItems = null; invalidateShelfIndex(true); scheduleRender(); } });
})();
