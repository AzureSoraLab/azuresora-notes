
(() => {
  const runtime = window.chengmoRuntime;
  const enqueue = runtime?.schedule || window.chengmoSchedule || ((_, task) => window.requestAnimationFrame(task));
  const listen = runtime?.on || ((type, _, listener) => { document.addEventListener(type, listener); return () => document.removeEventListener(type, listener); });
  const emit = runtime?.emit || ((type, detail) => document.dispatchEvent(new CustomEvent(type, { detail })));
  const storageKey = 'chengmo-text-selection-annotations-v1';
  const colors = ['#ffd400', '#ff6666', '#5fb236', '#2ea8e5', '#a28ae5', '#e56eee', '#f19837', '#aaaaaa'];
  const legacyColors = new Map([
    ['#f8d84b', colors[0]], ['#ff6b6b', colors[1]], ['#72b64a', colors[2]], ['#3ca8df', colors[3]],
    ['#a687e8', colors[4]], ['#d86ee8', colors[5]], ['#f39a3e', colors[6]], ['#a7aaa5', colors[7]],
    ['#ffd60a', colors[0]], ['#ff453a', colors[1]], ['#30d158', colors[2]], ['#0a84ff', colors[3]],
    ['#bf5af2', colors[4]], ['#ff2d55', colors[5]], ['#ff9f0a', colors[6]], ['#8e8e93', colors[7]]
  ]);
  const displayColor = color => legacyColors.get(String(color || '').toLowerCase()) || color || colors[0];
  let selected = null;
  let kind = 'highlight';
  let menu = null;
  let selectionBox = null;
  let observer = null;
  let applyTimer = 0;
  let touchSelectionTimer = 0;
  const longPressDelay = 500;
  const longPressMoveTolerance = 8;
  let annotationPointer = null;
  let suppressSelectionMenuOnce = false;
  let suppressAnnotationClickId = '';
  let commentSaveTimer = 0;
  let cachedItems = null;
  let renderFrame = 0;
  let lastRoot = null;
  let lastSourceText = null;
  let renderedSignature = '';
  let annotationsByNote = null;
  let annotationsById = null;
  let resolvedAnchors = new Map();
  let anchorTextSignature = '';
  let observedRoot = null;

  const reader = () => document.querySelector('.reader-body');
  const readerContent = () => reader()?.firstElementChild || null;
  const viewportBounds = () => {
    const viewport = window.visualViewport;
    if (!viewport) return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    return {
      left: viewport.offsetLeft,
      top: viewport.offsetTop,
      right: viewport.offsetLeft + viewport.width,
      bottom: viewport.offsetTop + viewport.height
    };
  };
  const selectionIsInReader = (selection = window.getSelection()) => {
    const root = readerContent();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    return Boolean(root && range && root.contains(range.commonAncestorContainer));
  };
  const currentNoteId = () => document.querySelector('.compact-note.selected')?.dataset.noteId || '';
  const read = () => cachedItems || (cachedItems = (() => {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) || '[]');
      return Array.isArray(value) ? value : [];
    } catch { return []; }
  })());
  const annotationIndex = () => {
    if (annotationsByNote && annotationsById) return { byNote: annotationsByNote, byId: annotationsById };
    annotationsByNote = new Map(); annotationsById = new Map();
    read().forEach(item => {
      if (!item?.id) return;
      annotationsById.set(item.id, item);
      const items = annotationsByNote.get(item.noteId) || [];
      items.push(item); annotationsByNote.set(item.noteId, items);
    });
    return { byNote: annotationsByNote, byId: annotationsById };
  };
  const noteAnnotations = noteId => {
    return annotationIndex().byNote.get(noteId) || [];
  };
  const annotationForId = id => annotationIndex().byId.get(id) || null;
  // This is the single persistence gateway for text annotations. Every consumer
  // (the reader, detail card and annotation shelf) receives the same change signal.
  const write = (items, detail = {}) => {
    cachedItems = items;
    annotationsByNote = null; annotationsById = null;
    localStorage.setItem(storageKey, JSON.stringify(items));
    emit('chengmo:annotations-changed', { ...detail, source: 'reader' });
  };
  const offsetOf = (root, container, offset) => {
    const range = document.createRange();
    range.selectNodeContents(root);
    range.setEnd(container, offset);
    return range.toString().length;
  };
  const rootText = root => root === lastRoot && lastSourceText !== null ? lastSourceText : (root?.textContent || '');
  const makeAnchor = (root, start, end) => {
    const text = rootText(root);
    return {
      quote: text.slice(start, end),
      prefix: text.slice(Math.max(0, start - 48), start),
      suffix: text.slice(end, Math.min(text.length, end + 48))
    };
  };
  const resolveAnchor = (root, item, sourceText = rootText(root)) => {
    const text = sourceText;
    const quote = item.quote || item.text || '';
    if (!quote) return null;
    const cacheKey = `${item.id}:${item.start}:${item.end}:${item.quote || ''}:${item.prefix || ''}:${item.suffix || ''}`;
    if (anchorTextSignature === text && resolvedAnchors.has(cacheKey)) return resolvedAnchors.get(cacheKey);
    // Fast path: retain the original offsets when the surrounding source agrees.
    if (text.slice(item.start, item.end) === quote) {
      const resolved = { start: item.start, end: item.end, migrated: !item.quote };
      resolvedAnchors.set(cacheKey, resolved); return resolved;
    }
    let best = null, from = 0;
    while (from <= text.length) {
      const start = text.indexOf(quote, from);
      if (start < 0) break;
      const end = start + quote.length;
      const prefix = item.prefix || '', suffix = item.suffix || '';
      let score = 0;
      if (prefix) { const available = text.slice(Math.max(0, start - prefix.length), start); score += available === prefix ? prefix.length * 2 : 0; }
      if (suffix) { const available = text.slice(end, end + suffix.length); score += available === suffix ? suffix.length * 2 : 0; }
      // When context has been edited, retain the candidate nearest its original location.
      score -= Math.min(80, Math.abs(start - (item.start || 0)) / 12);
      if (!best || score > best.score) best = { start, end, score };
      from = start + Math.max(1, quote.length);
    }
    const resolved = best ? { start: best.start, end: best.end, migrated: true } : null;
    resolvedAnchors.set(cacheKey, resolved); return resolved;
  };
  const annotationId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  function clearMarks(root) {
    root.querySelectorAll('mark.selection-annotation').forEach(mark => mark.replaceWith(...mark.childNodes));
    root.normalize();
  }
  const createMark = (item, content) => {
    const mark = document.createElement('mark');
    const annotationKind = item.kind === 'underline' ? 'underline' : 'highlight';
    mark.className = `selection-annotation selection-annotation--${annotationKind}`;
    mark.style.setProperty('--selection-annotation-color', displayColor(item.color));
    mark.dataset.annotationId = item.id;
    mark.append(content);
    return mark;
  };
  function applyAnnotations(root, items) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node, position = 0;
    while ((node = walker.nextNode())) {
      const start = position;
      position += node.data.length;
      if (node.data) nodes.push({ node, start, end: position });
    }
    // Sweep source text once. The prior implementation scanned the entire note
    // for every item, which became expensive as annotations accumulated.
    const ordered = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
    const active = [];
    let nextItem = 0;
    nodes.forEach(({ node: textNode, start, end }) => {
      while (nextItem < ordered.length && ordered[nextItem].start < end) active.push(ordered[nextItem++]);
      for (let index = active.length - 1; index >= 0; index -= 1) if (active[index].end <= start) active.splice(index, 1);
      if (!active.length || !textNode.parentNode) return;
      const cuts = new Set([0, textNode.data.length]);
      active.forEach(item => {
        if (item.end <= start || item.start >= end) return;
        cuts.add(Math.max(0, item.start - start));
        cuts.add(Math.min(textNode.data.length, item.end - start));
      });
      const offsets = [...cuts].sort((a, b) => a - b);
      const fragment = document.createDocumentFragment();
      for (let index = 0; index < offsets.length - 1; index += 1) {
        const from = offsets[index], to = offsets[index + 1];
        if (from === to) continue;
        let content = document.createTextNode(textNode.data.slice(from, to));
        // Later offsets are wrapped first so overlapping marks keep the same
        // nesting order as the legacy descending-range renderer.
        active.filter(item => item.start <= start + from && item.end >= start + to)
          .sort((a, b) => b.start - a.start || a.end - b.end)
          .forEach(item => { content = createMark(item, content); });
        fragment.append(content);
      }
      textNode.parentNode.replaceChild(fragment, textNode);
    });
  }
  function scheduleAnnotationRender() {
    if (renderFrame) return;
    renderFrame = 1;
    enqueue('text-annotation-render', () => { renderFrame = 0; renderAnnotations(); });
  }
  function renderAnnotations() {
    const root = readerContent();
    if (!root) return;
    const noteId = currentNoteId();
    const noteItems = noteAnnotations(noteId);
    // Most notes are unannotated. Do not read a long article's text or attach
    // a subtree observer unless there is annotation work to keep in sync.
    if (!noteItems.length) {
      observer?.disconnect(); observer = null; observedRoot = null;
      if (root.querySelector('mark.selection-annotation')) clearMarks(root);
      lastRoot = root; lastSourceText = null;
      renderedSignature = `${noteId}\u0000`;
      return;
    }
    const allItems = read();
    const currentText = root.textContent || '';
    const signature = `${noteId}\u0000${currentText}\u0000${noteItems.map(item => `${item.id}:${item.start}:${item.end}:${item.color}:${item.kind}`).join('|')}`;
    // React can announce a UI mount without replacing the article. Avoid tearing
    // down every mark when both the text and its visual annotation state match.
    if (root === lastRoot && signature === renderedSignature && (!noteItems.length || root.querySelector('mark.selection-annotation'))) { watch(root); return; }
    observer?.disconnect(); observer = null; observedRoot = null;
    clearMarks(root);
    // Read source once; resolving anchors no longer repeatedly walks the long note.
    if (anchorTextSignature !== currentText) { anchorTextSignature = currentText; resolvedAnchors = new Map(); }
    lastRoot = root; lastSourceText = currentText;
    let migrated = false;
    const items = noteItems.map(item => {
      const anchor = resolveAnchor(root, item, lastSourceText);
      if (!anchor) return null;
      const next = { ...item, start: anchor.start, end: anchor.end, ...(item.quote ? {} : makeAnchor(root, anchor.start, anchor.end)) };
      migrated ||= anchor.migrated || next.start !== item.start || next.end !== item.end;
      return next;
    }).filter(Boolean);
    if (migrated) {
      const resolved = new Map(items.map(item => [item.id, item]));
      write(allItems.map(item => resolved.get(item.id) || item), { type: 'reanchor', noteId });
    }
    applyAnnotations(root, items);
    renderedSignature = `${noteId}\u0000${lastSourceText}\u0000${items.map(item => `${item.id}:${item.start}:${item.end}:${item.color}:${item.kind}`).join('|')}`;
    watch(root);
  }
  function watch(root) {
    if (!window.MutationObserver) return;
    // A new render pass can leave the same reader node in place. Always retire
    // its old watcher before attaching the replacement to avoid duplicate work.
    if (observer && observedRoot === root) return;
    observer?.disconnect();
    observer = new MutationObserver(() => {
      window.clearTimeout(applyTimer);
      applyTimer = window.setTimeout(scheduleAnnotationRender, 80);
    });
    observer.observe(root, { childList: true, subtree: true });
    observedRoot = root;
  }
  function removeMenu() { menu?.remove(); menu = null; selected = null; selectionBox?.remove(); selectionBox = null; }
  function announce(message) { window.chengmoNotice?.(message); }
  function positionCommentCard(id) {
    if (!menu?.classList.contains('selection-annotation-menu--card') || !selectionBox) return;
    const parts = [...document.querySelectorAll(`mark.selection-annotation[data-annotation-id="${id}"]`)];
    const rects = parts.flatMap(part => [...part.getClientRects()]);
    if (!rects.length) return removeMenu();
    const left = Math.min(...rects.map(part => part.left)); const right = Math.max(...rects.map(part => part.right));
    const top = Math.min(...rects.map(part => part.top)); const bottom = Math.max(...rects.map(part => part.bottom));
    const viewport = viewportBounds();
    const outOfView = bottom < viewport.top || top > viewport.bottom || right < viewport.left || left > viewport.right;
    selectionBox.style.display = outOfView ? 'none' : '';
    menu.style.display = outOfView ? 'none' : '';
    if (outOfView) return;
    selectionBox.style.left = `${left - 4}px`; selectionBox.style.top = `${top - 4}px`; selectionBox.style.width = `${right - left + 8}px`; selectionBox.style.height = `${bottom - top + 8}px`;
    const menuHeight = menu.offsetHeight || 164;
    const menuWidth = menu.offsetWidth || 254;
    const menuTop = bottom + menuHeight + 4 <= viewport.bottom
      ? bottom + 4
      : Math.max(viewport.top + 8, top - menuHeight - 4);
    menu.style.left = `${Math.min(viewport.right - menuWidth - 8, Math.max(viewport.left + 8, left + (right - left - menuWidth) / 2))}px`;
    menu.style.top = `${Math.min(viewport.bottom - menuHeight - 8, menuTop)}px`;
  }
  function updateAnnotation(id, changes) {
    const item = annotationForId(id);
    if (!item) return;
    const changed = Object.entries(changes).some(([key, value]) => item[key] !== value);
    if (!changed) return;
    Object.assign(item, changes);
    write(read(), { type: 'update', id, changes });
    removeMenu();
    renderAnnotations();
  }
  function deleteAnnotation(id) {
    write(read().filter(item => item.id !== id), { type: 'delete', id });
    removeMenu();
    renderAnnotations();
  }
  function showCommentCard(mark) {
    const id = mark.dataset.annotationId;
    const item = annotationForId(id);
    if (!item) return;
    removeMenu();
    selectionBox = document.createElement('div'); selectionBox.className = 'selection-annotation-selection-box';
    document.body.append(selectionBox);
    menu = document.createElement('div'); menu.className = 'selection-annotation-menu selection-annotation-menu--card';
    menu.dataset.annotationId = id; menu.style.setProperty('--selection-annotation-color', displayColor(item.color));
    const header = document.createElement('div'); header.className = 'selection-annotation-card__header';
    const icon = document.createElement('b'); icon.textContent = 'A'; const page = document.createElement('span'); page.textContent = '标注详情'; const close = document.createElement('button'); close.textContent = '×'; close.title = '关闭'; close.addEventListener('click', removeMenu); header.append(icon, page, close);
    let pendingComment = item.comment || '';
    const saveComment = () => { window.clearTimeout(commentSaveTimer); commentSaveTimer = 0; updateAnnotation(id, { comment: pendingComment }); };
    const comment = document.createElement('textarea'); comment.className = 'selection-annotation-card__comment'; comment.placeholder = '添加评论'; comment.value = pendingComment; comment.addEventListener('input', () => { pendingComment = comment.value; window.clearTimeout(commentSaveTimer); commentSaveTimer = window.setTimeout(saveComment, 260); }); comment.addEventListener('blur', saveComment);
    const tags = document.createElement('div'); tags.className = 'selection-annotation-card__tags'; const tagInput = document.createElement('input'); tagInput.className = 'selection-annotation-card__tag'; tagInput.placeholder = '添加标签…';
    const renderTags = () => { tags.replaceChildren(...(item.tags || []).map(tag => { const chip = document.createElement('button'); chip.className = 'selection-annotation-card__tag-chip'; chip.textContent = `#${tag} ×`; chip.title = `删除标签 ${tag}`; chip.setAttribute('aria-label', `删除标签 ${tag}`); chip.addEventListener('click', () => { updateAnnotation(id, { tags: (item.tags || []).filter(value => value !== tag) }); renderTags(); announce(`已删除标签 #${tag}`); }); return chip; })); };
    tagInput.addEventListener('keydown', event => { if (event.key !== 'Enter') return; const tag = tagInput.value.trim().replace(/^#/, ''); if (!tag) return; event.preventDefault(); if ((item.tags || []).includes(tag)) { tagInput.value = ''; announce(`标签 #${tag} 已存在`); return; } updateAnnotation(id, { tags: [...(item.tags || []), tag] }); tagInput.value = ''; renderTags(); announce(`已添加标签 #${tag}`); });
    renderTags(); menu.append(header, comment, tags, tagInput); document.body.append(menu); positionCommentCard(id);
  }
  function positionManageMenu(id) {
    if (!menu?.classList.contains('selection-annotation-menu--manage')) return;
    const parts = [...document.querySelectorAll(`mark.selection-annotation[data-annotation-id="${id}"]`)];
    const anchor = parts[Number(menu.dataset.anchorPart || 0)] || parts[0];
    const rect = anchor?.getBoundingClientRect();
    if (!rect) return removeMenu();
    const viewport = viewportBounds();
    const outOfView = rect.bottom < viewport.top || rect.top > viewport.bottom || rect.right < viewport.left || rect.left > viewport.right;
    menu.style.display = outOfView ? 'none' : '';
    if (outOfView) return;
    // Use the actual long-press point when available, so a wrapped annotation
    // opens its menu beside the text segment the user pressed.
    const menuWidth = 220;
    const menuHeight = menu.offsetHeight || 360;
    const point = menu._anchorPoint;
    const anchorLeft = point ? rect.left + point.offsetX : rect.left;
    const anchorBottom = point ? rect.top + point.offsetY : rect.bottom;
    const left = Math.min(viewport.right - menuWidth - 8, Math.max(viewport.left + 8, anchorLeft));
    const top = anchorBottom + menuHeight + 8 <= viewport.bottom
      ? anchorBottom + 8
      : Math.max(viewport.top + 8, (point ? rect.top + point.offsetY : rect.top) - menuHeight - 8);
    menu.style.left = `${left}px`;
    menu.style.top = `${Math.min(viewport.bottom - menuHeight - 8, top)}px`;
  }
  function showManageMenu(mark, point) {
    const id = mark.dataset.annotationId;
    const item = annotationForId(id);
    if (!item) return;
    removeMenu();
    menu = document.createElement('div');
    menu.className = 'selection-annotation-menu selection-annotation-menu--manage';
    menu.dataset.annotationId = id;
    menu.dataset.anchorPart = String([...document.querySelectorAll(`mark.selection-annotation[data-annotation-id="${id}"]`)].indexOf(mark));
    const markRect = mark.getBoundingClientRect();
    menu._anchorPoint = point ? {
      offsetX: point.x - markRect.left,
      offsetY: point.y - markRect.top
    } : null;
    const title = document.createElement('div');
    title.className = 'selection-annotation-menu__title';
    title.textContent = '\u6807\u6ce8\u7ba1\u7406';
    menu.append(title);
    colors.forEach((color, index) => {
      const button = document.createElement('button');
      button.className = `selection-annotation-menu__item ${displayColor(item.color) === color ? 'is-current' : ''}`;
      const swatch = document.createElement('i');
      swatch.style.backgroundColor = color;
      button.append(swatch, ['黄色', '红色', '绿色', '蓝色', '紫色', '洋红', '橙色', '灰色'][index]);
      button.addEventListener('click', () => updateAnnotation(id, { color }));
      menu.append(button);
    });
    const convert = document.createElement('button');
    convert.className = 'selection-annotation-menu__item';
    convert.textContent = item.kind === 'highlight' ? '转换为下划线' : '转换为高亮';
    convert.addEventListener('click', () => updateAnnotation(id, { kind: item.kind === 'highlight' ? 'underline' : 'highlight' }));
    const remove = document.createElement('button');
    remove.className = 'selection-annotation-menu__item selection-annotation-menu__item--danger';
    remove.textContent = '删除标注';
    remove.addEventListener('click', () => deleteAnnotation(id));
    menu.append(convert, remove);
    document.body.append(menu);
    positionManageMenu(id);
  }
  function choose(color) {
    if (!selected) return;
    const items = read();
    const anchor = makeAnchor(readerContent(), selected.start, selected.end);
    const item = { id: annotationId(), noteId: currentNoteId(), start: selected.start, end: selected.end, color, kind, text: anchor.quote, quote: anchor.quote, prefix: anchor.prefix, suffix: anchor.suffix, comment: '', tags: [] };
    items.push(item);
    write(items, { type: 'create', id: item.id });
    window.getSelection()?.removeAllRanges();
    removeMenu();
    renderAnnotations();
    announce(kind === 'highlight' ? '已添加高亮标注' : '已添加下划线标注');
  }
  const isMobileViewport = () => window.matchMedia('(max-width: 760px)').matches;
  function positionSelectionMenu(rect) {
    if (!menu || menu.classList.contains('selection-annotation-menu--card') || menu.classList.contains('selection-annotation-menu--manage')) return;
    const menuWidth = menu.offsetWidth || 238;
    const menuHeight = menu.offsetHeight || 88;
    const viewport = viewportBounds();
    const left = Math.min(Math.max(rect.left + rect.width / 2, viewport.left + menuWidth / 2 + 8), viewport.right - menuWidth / 2 - 8);
    const below = rect.bottom + 10;
    const top = below + menuHeight <= viewport.bottom - 8 ? below : Math.max(viewport.top + 8, rect.top - menuHeight - 10);
    menu.style.left = `${left}px`;
    menu.style.top = `${Math.min(viewport.bottom - menuHeight - 8, top)}px`;
  }
  function showMenu() {
    const root = readerContent();
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const text = selection?.toString().trim();
    if (!root || !range || !text || !root.contains(range.commonAncestorContainer)) return removeMenu();
    const rect = range.getBoundingClientRect();
    const start = offsetOf(root, range.startContainer, range.startOffset);
    const end = offsetOf(root, range.endContainer, range.endOffset);
    if (end <= start) return removeMenu();
    if (menu && !menu.classList.contains('selection-annotation-menu--card') && !menu.classList.contains('selection-annotation-menu--manage') && selected?.start === start && selected?.end === end) {
      positionSelectionMenu(rect);
      return;
    }
    removeMenu();
    selected = { start, end };
    menu = document.createElement('div');
    menu.className = 'selection-annotation-menu';
    const colorRow = document.createElement('div');
    colorRow.className = 'selection-annotation-menu__colors';
    colors.forEach(color => {
      const button = document.createElement('button');
      button.className = 'selection-annotation-menu__color';
      button.style.backgroundColor = color;
      button.title = '应用颜色';
      button.addEventListener('mousedown', event => event.preventDefault());
      button.addEventListener('click', () => choose(color));
      colorRow.append(button);
    });
    const actionRow = document.createElement('div');
    actionRow.className = 'selection-annotation-menu__actions';
    [['highlight', 'A', '高亮'], ['underline', 'A', '下划线']].forEach(([value, label, title]) => {
      const button = document.createElement('button');
      button.className = `selection-annotation-menu__action ${value === 'underline' ? 'selection-annotation-menu__action--underline' : ''} ${kind === value ? 'is-active' : ''}`;
      button.textContent = label;
      button.title = title;
      button.addEventListener('mousedown', event => event.preventDefault());
      button.addEventListener('click', () => { kind = value; actionRow.querySelectorAll('button').forEach(item => item.classList.toggle('is-active', item === button)); });
      actionRow.append(button);
    });
    menu.append(colorRow, actionRow);
    document.body.append(menu);
    positionSelectionMenu(rect);
  }
  function scheduleTouchSelectionMenu() {
    if (!isMobileViewport()) return;
    if (!selectionIsInReader()) return;
    window.clearTimeout(touchSelectionTimer);
    // Mobile browsers finalize a handle drag after touchend. Waiting one short
    // turn reads the completed native selection instead of a partial range.
    touchSelectionTimer = window.setTimeout(() => {
      touchSelectionTimer = 0;
      const selection = window.getSelection();
      if (selection?.isCollapsed || !selection?.toString().trim()) return;
      showMenu();
    }, 80);
  }
  document.addEventListener('mouseup', event => {
    if (suppressSelectionMenuOnce) { suppressSelectionMenuOnce = false; return; }
    if (event.target.closest('mark.selection-annotation')) return;
    if (menu?.contains(event.target)) return;
    window.setTimeout(showMenu, 0);
  });
  document.addEventListener('touchend', event => {
    if (event.target.closest?.('mark.selection-annotation, .selection-annotation-menu')) return;
    if (readerContent()?.contains(event.target)) scheduleTouchSelectionMenu();
  }, true);
  document.addEventListener('selectionchange', () => {
    const selection = window.getSelection();
    if (isMobileViewport() && selection && !selection.isCollapsed && selection.toString().trim() && selectionIsInReader(selection)) scheduleTouchSelectionMenu();
  });
  document.addEventListener('mousedown', event => { if (menu && !menu.contains(event.target)) removeMenu(); });
  const clearAnnotationPointer = () => {
    if (!annotationPointer) return null;
    const pointer = annotationPointer;
    window.clearTimeout(pointer.timer);
    pointer.target.releasePointerCapture?.(pointer.pointerId);
    annotationPointer = null;
    return pointer;
  };
  document.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.isPrimary === false) return;
    const mark = event.target.closest('mark.selection-annotation');
    if (!mark) return;
    clearAnnotationPointer();
    const pointer = annotationPointer = {
      pointerId: event.pointerId,
      target: mark,
      x: event.clientX,
      y: event.clientY,
      opened: false,
      timer: 0
    };
    mark.setPointerCapture?.(event.pointerId);
    pointer.timer = window.setTimeout(() => {
      if (annotationPointer !== pointer) return;
      pointer.opened = true;
      suppressAnnotationClickId = mark.dataset.annotationId || '';
      showManageMenu(mark, { x: pointer.x, y: pointer.y });
    }, longPressDelay);
  });
  document.addEventListener('pointermove', event => {
    const pointer = annotationPointer;
    if (!pointer || pointer.pointerId !== event.pointerId || pointer.opened) return;
    const distanceX = event.clientX - pointer.x;
    const distanceY = event.clientY - pointer.y;
    if (distanceX * distanceX + distanceY * distanceY > longPressMoveTolerance * longPressMoveTolerance) clearAnnotationPointer();
  });
  document.addEventListener('pointerup', event => {
    const pointer = annotationPointer;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    if (pointer.opened) {
      suppressSelectionMenuOnce = true;
      const annotationId = pointer.target.dataset.annotationId || '';
      // Click follows pointerup synchronously. Clear the guard afterwards so a
      // missing synthetic click cannot suppress a later normal activation.
      window.setTimeout(() => { if (suppressAnnotationClickId === annotationId) suppressAnnotationClickId = ''; }, 0);
    } else if (event.pointerType === 'touch') {
      // Some mobile browsers omit the synthetic click after a text interaction.
      // Resolve a normal tap directly, then ignore any duplicate synthetic click.
      suppressAnnotationClickId = pointer.target.dataset.annotationId || '';
      showCommentCard(pointer.target);
      window.setTimeout(() => { if (suppressAnnotationClickId === pointer.target.dataset.annotationId) suppressAnnotationClickId = ''; }, 0);
    }
    clearAnnotationPointer();
  });
  document.addEventListener('pointercancel', event => {
    if (annotationPointer?.pointerId === event.pointerId) clearAnnotationPointer();
  });
  document.addEventListener('click', event => {
    const mark = event.target.closest('mark.selection-annotation');
    if (!mark) return;
    if (suppressAnnotationClickId && mark.dataset.annotationId === suppressAnnotationClickId) { suppressAnnotationClickId = ''; return; }
    event.preventDefault(); event.stopPropagation(); showCommentCard(mark);
  });
  document.addEventListener('contextmenu', event => {
    // Long-press already opens this app's annotation controls on touch devices.
    if (event.target.closest?.('mark.selection-annotation')) event.preventDefault();
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !menu) return;
    event.preventDefault(); removeMenu();
  }, true);
  let viewportPositionFrame = 0;
  const repositionForViewport = () => {
    if (viewportPositionFrame) return;
    viewportPositionFrame = window.requestAnimationFrame(() => {
      viewportPositionFrame = 0;
      const id = menu?.dataset.annotationId;
      if (id) {
        if (menu.classList.contains('selection-annotation-menu--manage')) positionManageMenu(id);
        else positionCommentCard(id);
        return;
      }
      const selection = window.getSelection();
      if (menu && selectionIsInReader(selection) && selection?.rangeCount) positionSelectionMenu(selection.getRangeAt(0).getBoundingClientRect());
      else if (menu) removeMenu();
    });
  };
  window.addEventListener('resize', repositionForViewport, { passive: true });
  window.visualViewport?.addEventListener('resize', repositionForViewport, { passive: true });
  window.visualViewport?.addEventListener('scroll', repositionForViewport, { passive: true });
  // Scroll events do not bubble. Capture them at document level so the card
  // follows marks even when the reader component swaps its scroll container.
  let scrollPositionFrame = 0;
  document.addEventListener('scroll', () => {
    // A closed annotation menu has no geometry to follow. Avoid scheduling a
    // frame for every reader scroll in the normal reading state.
    if (!menu?.dataset.annotationId) return;
    if (scrollPositionFrame) return;
    scrollPositionFrame = window.requestAnimationFrame(() => {
      scrollPositionFrame = 0;
      const id = menu?.dataset.annotationId;
      if (!id) return;
      if (menu.classList.contains('selection-annotation-menu--manage')) positionManageMenu(id);
      else positionCommentCard(id);
    });
  }, true);
  window.addEventListener('load', () => window.setTimeout(scheduleAnnotationRender, 100));
  // React may replace the reader body during a note switch; redraw only once
  // after the existing UI lifecycle event instead of retaining a stale observer.
  listen('chengmo:ui-mounted', 'text-annotations-ui', () => { removeMenu(); scheduleAnnotationRender(); });
  listen('chengmo:annotations-changed', 'text-annotations-data', event => {
    // The shelf can edit metadata directly. Drop this module's cached copy so a
    // later reader-side edit never writes stale tags or comments back to storage.
    if (event.detail?.source !== 'reader') { cachedItems = null; annotationsByNote = null; annotationsById = null; }
  });
  window.addEventListener('storage', event => { if (event.key === storageKey) { cachedItems = null; annotationsByNote = null; annotationsById = null; scheduleAnnotationRender(); } });
})();
