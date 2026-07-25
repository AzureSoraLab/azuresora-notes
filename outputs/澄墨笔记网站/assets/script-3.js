
/* Freehand annotations: a small, persistent drawing layer modelled on Zotero's reader controls. */
(() => {
  const runtime = window.chengmoRuntime;
  const enqueue = runtime?.schedule || window.chengmoSchedule || ((_, task) => window.requestAnimationFrame(task));
  const listen = runtime?.on || ((type, _, listener) => { document.addEventListener(type, listener); return () => document.removeEventListener(type, listener); });
  const storageKey = 'chengmo-freehand-annotations-v1';
  const preferencesKey = 'chengmo-freehand-drawing-preferences-v1';
  const palette = [
    ['#f8d84b', '黄色'], ['#ff6b6b', '红色'], ['#72b64a', '绿色'], ['#3ca8df', '蓝色'],
    ['#a687e8', '紫色'], ['#d86ee8', '洋红'], ['#f39a3e', '橙色'], ['#a7aaa5', '灰色']
  ];
  // Ink remains stored per note, but starts hidden after every page load so a
  // reader opens on the clean text. Entering drawing or selection reveals it.
  const defaultState = { color: palette[0][0], size: 2, eraserSize: 14, eraser: false, drawing: false, selecting: false, inkVisible: false };
  let state = { ...defaultState };
  const chunkHeight = 900;
  let canvas = null, context = null, activeStroke = null, selectedStroke = -1, dragStart = null, selectionAnchor = null, interactionPointerId = null, selectionDragFrame = 0, pendingSelectionPoint = null, eraserPointerActive = false, eraserDirty = false, saveTimer = 0, saveIdle = 0, pendingDrawingSave = null, redrawFrame = 0, eraseFrame = 0, pendingErasePoints = [], resizeObserver = null, scrollRoot = null, selectionDelete = null, selectionDeletePosition = '', observedDrawContent = null, colorButton = null;
  let chunkCanvases = new Map();
  let menu = null;
  let drawingStore = null;
  const read = () => drawingStore || (drawingStore = (() => { try { return JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch { return {}; } })());
  const write = value => {
    drawingStore = value;
    // Keep a compact synchronous cache for the existing reader and export
    // flow; the current note is persisted independently by IndexedDB.
    localStorage.setItem(storageKey, JSON.stringify(value));
  };
  const loadPreferences = () => { try { state = { ...defaultState, ...JSON.parse(localStorage.getItem(preferencesKey) || '{}'), drawing: false, selecting: false, inkVisible: false }; } catch {} };
  const savePreferences = () => localStorage.setItem(preferencesKey, JSON.stringify({ color: state.color, size: state.size, eraserSize: state.eraserSize }));
  loadPreferences();
  const reader = () => document.querySelector('.reader-body');
  const noteIds = () => {
    try { return new Set((window.chengmoStorage?.peekNotes?.()?.notes || JSON.parse(localStorage.getItem('chengmo-notes-v1') || '{}').notes || []).map(note => note?.id).filter(Boolean)); } catch { return new Set(); }
  };
  const reactKey = (node, ids) => {
    const fiberKey = Object.keys(node || {}).find(key => key.startsWith('__reactFiber$'));
    const fiber = fiberKey && node[fiberKey];
    const id = fiber?.key ?? fiber?.alternate?.key;
    return typeof id === 'string' && ids.has(id) ? id : '';
  };
  // Ink is always owned by a real note ID. Prefer React's keyed note item over
  // a DOM attribute, which can briefly belong to the prior card during a list
  // reconciliation. The old shared `default` bucket is never read again.
  const noteId = () => {
    const card = document.querySelector('.compact-note.selected');
    const ids = noteIds();
    const keyed = reactKey(card, ids);
    if (keyed) return keyed;
    const attribute = card?.dataset.noteId || card?.getAttribute('data-note-id') || '';
    return ids.has(attribute) ? attribute : '';
  };
  // Zotero treats the complete reading page (including its side whitespace) as
  // drawable, rather than restricting ink to the text column alone.
  const drawingRoot = () => reader() || null;
  const naturalPageHeight = root => {
    // Never derive the document height from root.scrollHeight: it may include
    // the absolutely positioned drawing layer itself and create a feedback loop.
    const contentHeight = [...root.children]
      .filter(node => !node.classList.contains('drawing-layer') && !node.classList.contains('drawing-canvas'))
      .reduce((height, node) => Math.max(height, node.offsetTop + Math.max(node.offsetHeight, node.scrollHeight)), 0);
    return Math.max(root.clientHeight, contentHeight);
  };
  const saveDrawing = (id, strokes) => {
    if (!id) return;
    const data = read(); data[id] = strokes;
    if (window.chengmoStorage?.saveDrawing) {
      window.chengmoStorage.saveDrawing(id, strokes);
    }
    else write(data);
  };
  const persistRecoverySnapshot = (id = loadedNoteId, strokes = drawingsCache) => {
    if (!id) return;
    // Store each completed interaction synchronously. The full IndexedDB save
    // remains batched below, but Ctrl+R immediately after lifting the pen must
    // never lose a completed stroke.
    if (window.chengmoStorage?.persistDrawingSnapshot) window.chengmoStorage.persistDrawingSnapshot(id, strokes);
    else { const data = read(); data[id] = strokes; write(data); }
  };
  const flushDrawingSave = () => {
    if (!pendingDrawingSave) return;
    const { id, strokes } = pendingDrawingSave;
    pendingDrawingSave = null;
    window.clearTimeout(saveTimer); saveTimer = 0;
    if (saveIdle) { window.cancelIdleCallback?.(saveIdle); saveIdle = 0; }
    // Serialize once after a burst of completed strokes, rather than cloning
    // every point while the user is still writing.
    const snapshot = strokes.map(stroke => ({ ...stroke, points: (stroke.points || []).map(point => [...point]) }));
    saveDrawing(id, snapshot);
    if (id === loadedNoteId) rememberPersistedDrawing(id);
  };
  const queueSave = () => {
    pendingDrawingSave = { id: loadedNoteId, strokes: drawingsCache };
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = 0;
      if (window.requestIdleCallback) saveIdle = window.requestIdleCallback(() => { saveIdle = 0; flushDrawingSave(); }, { timeout: 1400 });
      else flushDrawingSave();
    }, 480);
  };
  let drawingsCache = [];
  let loadedNoteId = '', renderedNoteId = '', lastCanvasGeometry = '', lastVisibleRange = '', drawingRevision = 0, persistedDrawingNoteId = '', persistedDrawingRevision = -1, renderedRevision = -1, renderedSelectedStroke = -1;
  const rememberPersistedDrawing = (id, revision = drawingRevision) => { persistedDrawingNoteId = id; persistedDrawingRevision = revision; };
  // React replaces the reader shortly after a note card is clicked. Keep the
  // outgoing ink hidden during that hand-off so it can never be painted on the
  // incoming note, even for two notes with the same visible title.
  let pendingNoteSwitchId = '', noteSwitchFrame = 0;
  let geometryRoot = null, geometryDirty = true, cachedGeometry = { width: 0, height: 0 }, observedGeometrySignature = '';
  let chunkStrokeIndex = null, chunkIndexSignature = '', segmentHitIndex = null, segmentHitSignature = '';
  let strokeBounds = new WeakMap();
  const clearRenderedChunks = () => {
    chunkCanvases.forEach(chunk => chunk.node.remove());
    chunkCanvases.clear();
    lastCanvasGeometry = ''; lastVisibleRange = ''; renderedNoteId = ''; renderedRevision = -1; renderedSelectedStroke = -1;
  };
  const discardOverflowChunks = pageHeight => {
    chunkCanvases.forEach((chunk, index) => {
      if (chunk.top >= pageHeight || index * chunkHeight >= pageHeight) {
        chunk.node.remove(); chunkCanvases.delete(index);
      }
    });
  };
  const markDrawingChanged = () => { drawingRevision += 1; strokeBounds = new WeakMap(); chunkStrokeIndex = null; chunkIndexSignature = ''; segmentHitIndex = null; segmentHitSignature = ''; };
  const invalidateGeometry = () => { geometryDirty = true; observedGeometrySignature = ''; chunkStrokeIndex = null; chunkIndexSignature = ''; segmentHitIndex = null; segmentHitSignature = ''; };
  const refreshGeometryIfNeeded = () => {
    const root = drawingRoot();
    if (!root) return;
    const content = observedDrawContent;
    // ResizeObserver can fire several times for one React commit. Only discard
    // the page/chunk cache when the drawable rectangle really changed.
    const signature = `${root.clientWidth}:${root.clientHeight}:${content?.offsetTop || 0}:${content?.offsetHeight || 0}:${content?.scrollHeight || 0}`;
    if (signature === observedGeometrySignature) return;
    observedGeometrySignature = signature;
    geometryDirty = true; chunkStrokeIndex = null; chunkIndexSignature = ''; segmentHitIndex = null; segmentHitSignature = '';
    scheduleRedraw();
  };
  const boundsFor = (stroke, cache = true) => {
    if (cache && strokeBounds.has(stroke)) return strokeBounds.get(stroke);
    const points = stroke?.points || [];
    let minY = 1, maxY = 0;
    points.forEach(point => { minY = Math.min(minY, point[1]); maxY = Math.max(maxY, point[1]); });
    const bounds = points.length ? { minY, maxY } : { minY: 1, maxY: 0 };
    if (cache) strokeBounds.set(stroke, bounds);
    return bounds;
  };
  const intersectsChunk = (stroke, top, height, pageHeight, bounds = boundsFor(stroke, false)) => {
    const bleed = Math.max(2, stroke.size || 2) / 2;
    return bounds.maxY * pageHeight + bleed >= top && bounds.minY * pageHeight - bleed <= top + height;
  };
  const pageGeometry = root => {
    if (root !== geometryRoot) { geometryRoot = root; geometryDirty = true; }
    if (geometryDirty) {
      cachedGeometry = { width: Math.max(1, root.clientWidth), height: Math.max(1, naturalPageHeight(root)) };
      canvas?.style.setProperty('--draw-page-width', `${cachedGeometry.width}px`);
      canvas?.style.setProperty('--draw-page-height', `${cachedGeometry.height}px`);
      // A note can become much shorter after a React render. Remove old page
      // chunks immediately instead of merely hiding them until the next scroll.
      discardOverflowChunks(cachedGeometry.height);
      geometryDirty = false;
    }
    return cachedGeometry;
  };
  const indexStrokesByChunk = pageHeight => {
    const signature = `${loadedNoteId}:${drawingRevision}:${pageHeight}`;
    if (chunkStrokeIndex && chunkIndexSignature === signature) return chunkStrokeIndex;
    const index = new Map();
    drawingsCache.forEach((stroke, strokeIndex) => {
      const bounds = boundsFor(stroke);
      const bleed = Math.max(2, stroke.size || 2) / 2;
      const first = Math.max(0, Math.floor((bounds.minY * pageHeight - bleed) / chunkHeight));
      const last = Math.max(first, Math.floor((bounds.maxY * pageHeight + bleed) / chunkHeight));
      for (let chunk = first; chunk <= last; chunk += 1) {
        const entries = index.get(chunk) || []; entries.push(strokeIndex); index.set(chunk, entries);
      }
    });
    chunkStrokeIndex = index; chunkIndexSignature = signature;
    return index;
  };
  const segmentIndexFor = rect => {
    const cellSize = 96;
    const signature = `${loadedNoteId}:${drawingRevision}:${Math.round(rect.width)}x${Math.round(rect.height)}`;
    if (segmentHitIndex && segmentHitSignature === signature) return segmentHitIndex;
    const cells = new Map();
    const add = (cell, segment) => { const bucket = cells.get(cell) || []; bucket.push(segment); cells.set(cell, bucket); };
    drawingsCache.forEach((stroke, strokeIndex) => {
      if (stroke.eraser) return;
      const points = stroke.points || [];
      const radius = Math.max(8, (stroke.size || 2) / 2 + 6);
      for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
        const a = points[Math.max(0, pointIndex - 1)] || points[pointIndex]; const b = points[pointIndex];
        const ax = a[0] * rect.width, ay = a[1] * rect.height, bx = b[0] * rect.width, by = b[1] * rect.height;
        const minX = Math.floor((Math.min(ax, bx) - radius) / cellSize), maxX = Math.floor((Math.max(ax, bx) + radius) / cellSize);
        const minY = Math.floor((Math.min(ay, by) - radius) / cellSize), maxY = Math.floor((Math.max(ay, by) + radius) / cellSize);
        // A rare page-spanning line stays searchable without flooding the map.
        if ((maxX - minX + 1) * (maxY - minY + 1) > 48) { add(`${Math.floor((ax + bx) / 2 / cellSize)}:${Math.floor((ay + by) / 2 / cellSize)}`, { strokeIndex, ax, ay, bx, by, radius }); continue; }
        for (let x = minX; x <= maxX; x += 1) for (let y = minY; y <= maxY; y += 1) add(`${x}:${y}`, { strokeIndex, ax, ay, bx, by, radius });
      }
    });
    segmentHitIndex = { cells, cellSize }; segmentHitSignature = signature;
    return segmentHitIndex;
  };
  const loadDrawing = () => {
    // Only materialize the selected note's strokes. Other notes remain compact
    // JSON data until the user actually opens them.
    const nextNoteId = noteId();
    if (!nextNoteId) return;
    loadedNoteId = nextNoteId;
    const cachedDrawings = read();
    // Legacy builds could write unowned strokes under `default`. Keep the
    // record untouched for safety, but never attach it to any real note.
    if (Object.prototype.hasOwnProperty.call(cachedDrawings, 'default')) delete cachedDrawings.default;
    // The synchronous cache is written before deferred IndexedDB work. If it
    // already has this note, it may be newer after a quick close/reload.
    const cachedStrokes = Array.isArray(cachedDrawings[loadedNoteId]) ? cachedDrawings[loadedNoteId] : [];
    // The recovery entry is intentionally scoped to one note, so completing a
    // stroke never serializes another note's ink. It is newer than the boot
    // cache when the page was refreshed before the deferred IndexedDB write.
    const recoveryStrokes = window.chengmoStorage?.getDrawingRecovery?.(loadedNoteId);
    // An empty compatibility entry is not authoritative: it is commonly
    // created before the IndexedDB drawing record has hydrated after refresh.
    // Only non-empty local ink may be newer than an asynchronous IDB read.
    const hasCachedDrawing = Array.isArray(recoveryStrokes) || cachedStrokes.length > 0;
    drawingsCache = Array.isArray(recoveryStrokes) ? recoveryStrokes : cachedStrokes; selectedStroke = -1;
    clearRenderedChunks(); invalidateGeometry(); markDrawingChanged(); rememberPersistedDrawing(loadedNoteId);
    // IndexedDB is the canonical drawing store. The old localStorage record
    // supplies an immediate first paint, then a note-scoped read upgrades it
    // without scanning every other note's ink.
    const requestedId = loadedNoteId;
    const requestedRevision = drawingRevision;
    window.chengmoStorage?.getDrawing(requestedId).then(strokes => {
      // An asynchronous old-record read must never overwrite ink created
      // immediately after switching into this note.
      if (!Array.isArray(strokes) || hasCachedDrawing || requestedId !== loadedNoteId || activeStroke || drawingRevision !== requestedRevision) return;
      drawingsCache = strokes; selectedStroke = -1;
      const data = read(); data[requestedId] = strokes;
      markDrawingChanged(); rememberPersistedDrawing(requestedId); scheduleRedraw();
    }).catch(() => {});
  };
  const scheduleRedraw = () => {
    if (!canvas || pendingNoteSwitchId) return;
    if (redrawFrame) return;
    redrawFrame = requestAnimationFrame(() => { redrawFrame = 0; redraw(); });
  };
  const redraw = () => {
    if (!canvas || pendingNoteSwitchId) return;
    const root = canvas.parentElement;
    const ratio = window.devicePixelRatio || 1;
    // Scrolling does not change a note's dimensions. Cache the expensive
    // content-height measurement until the reader itself actually resizes.
    const page = root ? pageGeometry(root) : { width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
    const pageWidth = page.width, pageHeight = page.height;
    const geometry = `${pageWidth}x${pageHeight}@${ratio}`;
    const first = Math.max(0, Math.floor((root?.scrollTop || 0) / chunkHeight) - 1);
    const last = Math.ceil(((root?.scrollTop || 0) + (root?.clientHeight || pageHeight)) / chunkHeight) + 1;
    const renderSignature = `${pageWidth}x${pageHeight}@${ratio}:${drawingRevision}:${selectedStroke}:${activeStroke?.points.length || 0}`;
    const visibleRange = `${first}:${last}`;
    // Most scroll events stay within the same buffered chunk range. In that
    // case every canvas is already correct, so skip indexing and repainting.
    if (!activeStroke && renderedNoteId === loadedNoteId && lastCanvasGeometry === geometry && renderedRevision === drawingRevision && renderedSelectedStroke === selectedStroke && lastVisibleRange === visibleRange) {
      if (state.selecting || !selectionDelete?.hidden) updateSelectionDelete(canvas.getBoundingClientRect());
      return;
    }
    const strokeIndex = indexStrokesByChunk(pageHeight);
    const activeBounds = activeStroke ? boundsFor(activeStroke, false) : null;
    const wanted = new Set(); for (let index = first; index <= last; index += 1) wanted.add(index);
    chunkCanvases.forEach((chunk, index) => { if (!wanted.has(index)) { chunk.node.remove(); chunkCanvases.delete(index); } });
    wanted.forEach(index => {
      const top = index * chunkHeight, height = Math.min(chunkHeight, pageHeight - top); if (height <= 0) return;
      let chunk = chunkCanvases.get(index);
      if (!chunk) { const node = document.createElement('canvas'); node.className = 'drawing-canvas'; canvas.append(node); chunk = { node, context: node.getContext('2d'), top: 0, height: 0 }; chunkCanvases.set(index, chunk); }
      chunk.top = top; chunk.height = height; chunk.node.style.top = `${top}px`; chunk.node.style.setProperty('--draw-chunk-height', `${height}px`);
      const width = Math.round(pageWidth * ratio), pixelHeight = Math.round(height * ratio);
      const signature = renderSignature;
      if (chunk.signature === signature && chunk.node.width === width && chunk.node.height === pixelHeight) return;
      if (chunk.node.width !== width || chunk.node.height !== pixelHeight) { chunk.node.width = width; chunk.node.height = pixelHeight; }
      context = chunk.context; context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, pageWidth, height); context.save(); context.translate(0, -top);
      (strokeIndex.get(index) || []).forEach(strokeIndex => {
        const stroke = drawingsCache[strokeIndex];
        paintStroke(stroke, { width: pageWidth, height: pageHeight });
        if (strokeIndex === selectedStroke) paintSelection(stroke, { width: pageWidth, height: pageHeight });
      });
      if (activeStroke && intersectsChunk(activeStroke, top, height, pageHeight, activeBounds)) paintStroke(activeStroke, { width: pageWidth, height: pageHeight });
      context.restore();
      chunk.signature = signature;
    });
    context = null;
    if (state.selecting || !selectionDelete?.hidden) updateSelectionDelete(canvas.getBoundingClientRect());
    lastCanvasGeometry = geometry; lastVisibleRange = visibleRange; renderedNoteId = loadedNoteId; renderedRevision = drawingRevision; renderedSelectedStroke = selectedStroke;
  };
  const paintStroke = (stroke, rect) => {
    if (!stroke.points?.length || !context) return;
    context.save(); context.lineCap = 'round'; context.lineJoin = 'round';
    context.lineWidth = stroke.size || 2;
    context.strokeStyle = stroke.color || palette[0][0];
    context.globalCompositeOperation = stroke.eraser ? 'destination-out' : 'source-over';
    context.beginPath();
    stroke.points.forEach((point, index) => {
      const x = point[0] * rect.width, y = point[1] * rect.height;
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    });
    if (stroke.points.length === 1) { const p = stroke.points[0]; context.arc(p[0] * rect.width, p[1] * rect.height, (stroke.size || 2) / 2, 0, Math.PI * 2); context.fillStyle = context.strokeStyle; context.fill(); }
    else context.stroke();
    context.restore();
  };
  const paintSelection = (stroke, rect) => {
    if (!stroke.points?.length || !context) return;
    // Follow the ink itself instead of drawing a large bounding box around it.
    // This stays understandable for long handwriting strokes and nearby marks.
    context.save(); context.setLineDash([4, 3]); context.lineCap = 'round'; context.lineJoin = 'round';
    context.lineWidth = Math.max(2, (stroke.size || 2) + 3); context.strokeStyle = '#5d8dea'; context.globalAlpha = .9; context.beginPath();
    stroke.points.forEach((point, index) => { const x = point[0] * rect.width, y = point[1] * rect.height; if (index === 0) context.moveTo(x, y); else context.lineTo(x, y); });
    if (stroke.points.length === 1) { const p = stroke.points[0]; context.arc(p[0] * rect.width, p[1] * rect.height, Math.max(5, (stroke.size || 2) + 3), 0, Math.PI * 2); }
    context.stroke(); context.restore();
  };
  const updateSelectionDelete = rect => {
    if (!selectionDelete) {
      selectionDelete = document.createElement('button'); selectionDelete.type = 'button'; selectionDelete.className = 'drawing-selection-delete'; selectionDelete.title = '删除所选笔迹'; selectionDelete.setAttribute('aria-label', '删除所选笔迹'); selectionDelete.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 11v6m4-6v6M9 7l.8-2h4.4l.8 2M7.5 7l.7 12h7.6l.7-12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      selectionDelete.addEventListener('click', deleteSelectedStroke); document.body.append(selectionDelete);
    }
    const stroke = drawingsCache[selectedStroke];
    if (!state.selecting || !stroke?.points?.length) { selectionDelete.hidden = true; selectionDeletePosition = ''; return; }
    const point = selectionAnchor || stroke.points[stroke.points.length - 1];
    const x = rect.left + point[0] * rect.width, y = rect.top + point[1] * rect.height;
    const readerRect = canvas.parentElement?.getBoundingClientRect();
    const visible = x >= Math.max(0, readerRect?.left || 0) && x <= Math.min(window.innerWidth, readerRect?.right || window.innerWidth) && y >= Math.max(0, readerRect?.top || 0) && y <= Math.min(window.innerHeight, readerRect?.bottom || window.innerHeight);
    if (!visible) { selectionDelete.hidden = true; selectionDeletePosition = ''; return; }
    const left = Math.max(8, Math.min(window.innerWidth - 36, x + 10));
    const top = Math.max(8, y - 34);
    const position = `${left}:${top}`;
    if (selectionDeletePosition !== position) {
      selectionDelete.style.left = `${left}px`;
      selectionDelete.style.top = `${top}px`;
      selectionDeletePosition = position;
    }
    selectionDelete.hidden = false;
  };
  const paintSegment = (stroke, previous, current, rect) => {
    if (!context || !previous || !current) return;
    context.save(); context.lineCap = 'round'; context.lineJoin = 'round';
    context.lineWidth = stroke.size || 2;
    context.strokeStyle = stroke.color || palette[0][0];
    context.globalCompositeOperation = stroke.eraser ? 'destination-out' : 'source-over';
    context.beginPath();
    context.moveTo(previous[0] * rect.width, previous[1] * rect.height);
    context.lineTo(current[0] * rect.width, current[1] * rect.height);
    context.stroke(); context.restore();
  };
  const paintLiveSegments = (stroke, samples) => {
    const root = canvas?.parentElement;
    if (!root || !samples.length) return false;
    const page = pageGeometry(root), ratio = window.devicePixelRatio || 1;
    let previous = stroke.points[stroke.points.length - samples.length - 1];
    if (!previous) return false;
    for (const current of samples) {
      const first = Math.max(0, Math.floor(Math.min(previous[1], current[1]) * page.height / chunkHeight));
      const last = Math.floor(Math.max(previous[1], current[1]) * page.height / chunkHeight);
      for (let index = first; index <= last; index += 1) {
        const chunk = chunkCanvases.get(index);
        if (!chunk) return false;
        context = chunk.context; context.save(); context.setTransform(ratio, 0, 0, ratio, 0, 0); context.translate(0, -chunk.top);
        paintSegment(stroke, previous, current, page);
        context.restore(); context = null;
        // The live stroke is now newer than this chunk's cached signature.
        chunk.signature = '';
      }
      previous = current;
    }
    return true;
  };
  const pointFor = (event, rect = canvas.getBoundingClientRect()) => {
    return [Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))];
  };
  const nearestStroke = point => {
    const rect = canvas.getBoundingClientRect();
    const px = point[0] * rect.width, py = point[1] * rect.height;
    let index = -1, distance = Infinity, threshold = 10;
    const hitIndex = segmentIndexFor(rect), cellX = Math.floor(px / hitIndex.cellSize), cellY = Math.floor(py / hitIndex.cellSize);
    const segmentDistance = (x, y, ax, ay, bx, by) => {
      const dx = bx - ax, dy = by - ay;
      const length = dx * dx + dy * dy;
      const t = length ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length)) : 0;
      return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
    };
    const seen = new Set();
    for (let x = cellX - 1; x <= cellX + 1; x += 1) for (let y = cellY - 1; y <= cellY + 1; y += 1) {
      (hitIndex.cells.get(`${x}:${y}`) || []).forEach(segment => {
        const key = `${segment.strokeIndex}:${segment.ax}:${segment.ay}:${segment.bx}:${segment.by}`;
        if (seen.has(key)) return; seen.add(key);
        const d = segmentDistance(px, py, segment.ax, segment.ay, segment.bx, segment.by);
        if (d < distance) { distance = d; threshold = segment.radius; index = segment.strokeIndex; }
      });
    }
    return distance <= threshold ? index : -1;
  };
  const deleteSelectedStroke = () => {
    if (selectedStroke < 0) return;
    // A delayed save may still point at the pre-delete stroke array. Retire it
    // before saving an immutable post-delete snapshot, so old ink cannot be
    // written back after the user has removed it.
    window.clearTimeout(saveTimer); saveTimer = 0;
    if (saveIdle) {
      if (window.cancelIdleCallback) window.cancelIdleCallback(saveIdle); else window.clearTimeout(saveIdle);
      saveIdle = 0;
    }
    pendingDrawingSave = null;
    drawingsCache = drawingsCache.filter((_, index) => index !== selectedStroke);
    selectedStroke = -1; selectionAnchor = null; markDrawingChanged();
    if (selectionDelete) selectionDelete.hidden = true;
    const snapshot = drawingsCache.map(stroke => ({ ...stroke, points: (stroke.points || []).map(point => [...point]) }));
    persistRecoverySnapshot(loadedNoteId, snapshot);
    saveDrawing(loadedNoteId, snapshot);
    rememberPersistedDrawing(loadedNoteId);
    lastCanvasGeometry = ''; renderedRevision = -1;
    redraw();
  };
  const erasePoints = (points, radius) => {
    if (!points.length) return false;
    const root = canvas.getBoundingClientRect();
    const targets = points.map(point => [point[0] * root.width, point[1] * root.height]);
    let changed = false;
    // Process all coalesced pointer samples in one pass. The old path rebuilt
    // every stroke once per sample, which became expensive during fast erasing.
    drawingsCache = drawingsCache.flatMap(stroke => {
      if (stroke.eraser || !stroke.points?.length) return [stroke];
      const segments = [], current = [];
      stroke.points.forEach(p => {
        const x = p[0] * root.width, y = p[1] * root.height;
        const keep = !targets.some(([px, py]) => Math.hypot(x - px, y - py) <= radius + (stroke.size || 2) / 2);
        if (keep) current.push(p);
        else { if (current.length) segments.push(current.splice(0)); changed = true; }
      });
      if (current.length) segments.push(current);
      return segments.map(points => ({ ...stroke, points }));
    });
    if (changed) markDrawingChanged();
    return changed;
  };
  const queueErase = point => {
    pendingErasePoints.push(point);
    if (eraseFrame) return;
    eraseFrame = requestAnimationFrame(() => {
      eraseFrame = 0;
      const points = pendingErasePoints; pendingErasePoints = [];
      const changed = erasePoints(points, state.eraserSize / 2);
      if (changed) { eraserDirty = true; queueSave(); scheduleRedraw(); }
    });
  };
  const clearInteractionPointer = () => {
    if (interactionPointerId === null) return;
    canvas?.releasePointerCapture?.(interactionPointerId);
    interactionPointerId = null;
  };
  const cancelSelectionDrag = () => {
    if (selectionDragFrame) { cancelAnimationFrame(selectionDragFrame); selectionDragFrame = 0; }
    pendingSelectionPoint = null;
    dragStart = null;
    canvas?.classList.remove('is-dragging');
  };
  const applySelectionDrag = point => {
    if (!dragStart || selectedStroke < 0 || !point) return false;
    const dx = point[0] - dragStart.point[0], dy = point[1] - dragStart.point[1];
    const movedPixels = Math.hypot(dx * canvas.clientWidth, dy * canvas.clientHeight);
    if (!dragStart.moved && movedPixels < 4) return false;
    dragStart.moved = true;
    canvas.classList.add('is-dragging');
    drawingsCache[selectedStroke].points = dragStart.strokes.map(p => [Math.max(0, Math.min(1, p[0] + dx)), Math.max(0, Math.min(1, p[1] + dy))]);
    selectionAnchor = point;
    markDrawingChanged(); scheduleRedraw();
    return true;
  };
  const flushSelectionDrag = () => {
    if (selectionDragFrame) { cancelAnimationFrame(selectionDragFrame); selectionDragFrame = 0; }
    const point = pendingSelectionPoint; pendingSelectionPoint = null;
    return applySelectionDrag(point);
  };
  const begin = event => {
    if ((!state.drawing && !state.selecting && !state.eraser) || event.button !== 0 || event.isPrimary === false || interactionPointerId !== null) return;
    event.preventDefault(); event.stopPropagation();
    if (state.selecting) {
      const point = pointFor(event);
      selectedStroke = nearestStroke(point);
      selectionAnchor = selectedStroke >= 0 ? point : null;
      if (selectedStroke < 0 && selectionDelete) selectionDelete.hidden = true;
      // Selecting is a click. Only turn it into a move after a small movement
      // threshold, so a normal click cannot accidentally shift handwriting.
      if (selectedStroke >= 0) { dragStart = { point, strokes: drawingsCache[selectedStroke].points.map(p => [...p]), moved: false }; interactionPointerId = event.pointerId; canvas.setPointerCapture?.(event.pointerId); }
      scheduleRedraw(); return;
    }
    if (state.eraser) {
      // One click erases at that point; subsequent movement keeps erasing
      // until the pointer is released. Hovering alone never changes ink.
      eraserPointerActive = true; eraserDirty = false; queueErase(pointFor(event));
      interactionPointerId = event.pointerId; canvas.setPointerCapture?.(event.pointerId); return;
    }
    activeStroke = { color: state.color, size: state.size, eraser: false, points: [pointFor(event)] };
    scheduleRedraw();
    interactionPointerId = event.pointerId; canvas.setPointerCapture?.(event.pointerId);
  };
  const move = event => {
    if (state.selecting && dragStart && selectedStroke >= 0) {
      if (event.pointerId !== interactionPointerId) return;
      event.preventDefault(); pendingSelectionPoint = pointFor(event);
      if (!selectionDragFrame) selectionDragFrame = requestAnimationFrame(() => { selectionDragFrame = 0; const point = pendingSelectionPoint; pendingSelectionPoint = null; applySelectionDrag(point); });
      return;
    }
    if (state.eraser) {
      if (!eraserPointerActive || event.pointerId !== interactionPointerId) return;
      const samples = event.getCoalescedEvents ? event.getCoalescedEvents() : [event];
      const rect = canvas.getBoundingClientRect();
      samples.forEach(sample => queueErase(pointFor(sample, rect)));
      return;
    }
    if (!activeStroke || event.pointerId !== interactionPointerId) return;
    event.preventDefault();
    const samples = event.getCoalescedEvents ? event.getCoalescedEvents() : [event];
    const rect = canvas.getBoundingClientRect();
    const points = samples.map(sample => pointFor(sample, rect)); activeStroke.points.push(...points);
    // Draw new segments straight into their visible chunks. This avoids
    // repainting all nearby handwriting for every pointer event.
    if (!paintLiveSegments(activeStroke, points)) scheduleRedraw();
  };
  const end = event => {
    if (event.pointerId !== interactionPointerId) return;
    if (state.selecting && dragStart) { event.preventDefault(); flushSelectionDrag(); const moved = dragStart.moved; cancelSelectionDrag(); clearInteractionPointer(); if (moved) { persistRecoverySnapshot(); queueSave(); } return; }
    if (state.eraser) {
      event.preventDefault();
      if (eraseFrame) { cancelAnimationFrame(eraseFrame); eraseFrame = 0; const points = pendingErasePoints; pendingErasePoints = []; const changed = erasePoints(points, state.eraserSize / 2); if (changed) { eraserDirty = true; queueSave(); scheduleRedraw(); } }
      eraserPointerActive = false; pendingErasePoints = [];
      if (eraserDirty) persistRecoverySnapshot();
      clearInteractionPointer();
      return;
    }
    if (!activeStroke) return;
    event.preventDefault();
    if (activeStroke.points.length) { drawingsCache.push(activeStroke); markDrawingChanged(); persistRecoverySnapshot(); queueSave(); }
    activeStroke = null;
    clearInteractionPointer();
    scheduleRedraw();
  };
  const syncCanvas = () => {
    const root = drawingRoot(); if (!root) return;
    const activeNoteId = noteId();
    // Do not accept the old selected card while React is still committing the
    // click. The switch coordinator below releases this as soon as the chosen
    // card becomes the real selected note.
    if (pendingNoteSwitchId && activeNoteId !== pendingNoteSwitchId) return;
    if (pendingNoteSwitchId === activeNoteId) pendingNoteSwitchId = '';
    if (!activeNoteId) {
      if (saveTimer || saveIdle || pendingDrawingSave) flushDrawingSave();
      if (loadedNoteId || drawingsCache.length) {
        loadedNoteId = ''; drawingsCache = []; selectedStroke = -1; persistedDrawingNoteId = ''; persistedDrawingRevision = -1;
        clearRenderedChunks(); invalidateGeometry();
      }
      return;
    }
    if (loadedNoteId !== activeNoteId) {
      // Persist the outgoing note before replacing its in-memory stroke cache.
      if (saveTimer || saveIdle || pendingDrawingSave) flushDrawingSave();
      loadDrawing();
    }
    if (getComputedStyle(root).position === 'static') root.style.position = 'relative';
    let next = root.querySelector(':scope > .drawing-layer');
    if (!next) {
      // Remove the bundled legacy canvas before installing chunk canvases.
      root.querySelectorAll('.drawing-canvas').forEach(node => node.remove());
      next = document.createElement('div'); next.className = 'drawing-layer'; root.append(next);
    }
    if (next !== canvas) {
      clearRenderedChunks(); canvas = next; context = null; chunkCanvases = new Map();
      canvas.addEventListener('pointerdown', begin); canvas.addEventListener('pointermove', move);
      canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
      if (scrollRoot && scrollRoot !== root) scrollRoot.removeEventListener('scroll', scheduleRedraw);
      if (scrollRoot !== root) { root.addEventListener('scroll', scheduleRedraw, { passive: true }); scrollRoot = root; }
      resizeObserver?.disconnect(); observedDrawContent = null;
      resizeObserver = new ResizeObserver(refreshGeometryIfNeeded); resizeObserver.observe(root);
    }
    const content = [...root.children].find(node => !node.classList.contains('drawing-layer')) || null;
    if (content !== observedDrawContent) {
      if (observedDrawContent) resizeObserver?.unobserve(observedDrawContent);
      observedDrawContent = content;
      if (content) resizeObserver?.observe(content);
      invalidateGeometry();
      refreshGeometryIfNeeded();
    }
    canvas.classList.toggle('is-drawing', state.drawing); canvas.classList.toggle('is-selecting', state.selecting); canvas.classList.toggle('is-erasing', state.eraser); canvas.classList.toggle('is-ink-hidden', !state.inkVisible); scheduleRedraw();
  };
  const closeMenu = () => { if (menu) menu.hidden = true; if (colorButton) colorButton.setAttribute('aria-expanded', 'false'); };
  const refreshInteractionUi = () => {
    const control = document.querySelector('.zotero-draw-control');
    control?.classList.toggle('is-active', state.drawing);
    control?.querySelector('.zotero-draw-control__select')?.classList.toggle('is-active', state.selecting);
    canvas?.classList.toggle('is-drawing', state.drawing);
    canvas?.classList.toggle('is-selecting', state.selecting);
    canvas?.classList.toggle('is-erasing', state.eraser);
    canvas?.classList.toggle('is-ink-hidden', !state.inkVisible);
  };
  const leaveInteractionMode = () => {
    if (!state.drawing && !state.selecting && !state.eraser) return false;
    state.drawing = false; state.selecting = false; state.eraser = false;
    selectedStroke = -1; selectionAnchor = null; cancelSelectionDrag(); clearInteractionPointer();
    if (selectionDelete) selectionDelete.hidden = true;
    closeMenu(); refreshInteractionUi(); scheduleRedraw();
    window.chengmoNotice?.('已退出绘图模式');
    return true;
  };
  const icon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.4 18.7 4 22l3.4-1.4L18 10a3.1 3.1 0 0 0-4.4-4.4L3 16.2l2.4 2.5Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="m12.2 7 4.7 4.7" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>';
  const selectIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4v5M5 5h5M19 4v5m0-4h-5M5 20v-5m0 4h5m9 1v-5m0 4h-5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m10 9 5 4-2.8.5L11 16z" fill="currentColor"/></svg>';
  const visibilityIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.8 12s3.3-5.3 9.2-5.3 9.2 5.3 9.2 5.3-3.3 5.3-9.2 5.3S2.8 12 2.8 12Z" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.35" fill="none" stroke="currentColor" stroke-width="1.65"/></svg>';
  const eraserIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 18 7.6-10.1a2.1 2.1 0 0 1 3.3 2.6L11.8 18H7Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M4 18h16" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
  const mount = () => {
    const actions = document.querySelector('.reader-actions'); if (!actions || actions.querySelector('.zotero-draw-control')) return;
    const control = document.createElement('div'); control.className = 'zotero-draw-control';
    control.innerHTML = `<button type="button" class="zotero-draw-control__button" title="绘图" aria-label="绘图">${icon}</button><button type="button" class="zotero-draw-control__select" title="选择笔迹" aria-label="选择笔迹">${selectIcon}</button><button type="button" class="zotero-draw-control__visibility" title="隐藏笔迹" aria-label="隐藏笔迹" aria-pressed="true">${visibilityIcon}</button><button type="button" class="zotero-draw-control__color" title="选择绘图颜色" aria-label="选择绘图颜色" aria-expanded="false"><span class="zotero-draw-control__swatch"></span><span class="zotero-draw-control__chevron"></span></button>`;
    const drawButton = control.querySelector('.zotero-draw-control__button'); const selectButton = control.querySelector('.zotero-draw-control__select'); const visibilityButton = control.querySelector('.zotero-draw-control__visibility'); colorButton = control.querySelector('.zotero-draw-control__color'); const swatch = control.querySelector('.zotero-draw-control__swatch');
    const update = () => {
      swatch.style.background = state.color; control.classList.toggle('is-active', state.drawing); drawButton.classList.toggle('is-active', state.drawing); drawButton.setAttribute('aria-pressed', String(state.drawing)); selectButton.classList.toggle('is-active', state.selecting);
      visibilityButton.classList.toggle('is-hidden', !state.inkVisible);
      visibilityButton.title = state.inkVisible ? '隐藏笔迹' : '显示笔迹';
      visibilityButton.setAttribute('aria-label', visibilityButton.title);
      visibilityButton.setAttribute('aria-pressed', String(state.inkVisible));
      if (canvas) {
        const diameter = Math.max(12, Math.min(35, state.eraserSize));
        const center = Math.round(diameter / 2);
        const circle = `<svg xmlns="http://www.w3.org/2000/svg" width="${diameter}" height="${diameter}" viewBox="0 0 ${diameter} ${diameter}"><circle cx="${center}" cy="${center}" r="${Math.max(4, center - 1)}" fill="none" stroke="#000" stroke-width="1.25"/></svg>`;
        canvas.style.setProperty('--draw-eraser-cursor', `url("data:image/svg+xml,${encodeURIComponent(circle)}") ${center} ${center}, crosshair`);
        canvas.classList.toggle('is-erasing', state.eraser);
        canvas.classList.toggle('is-ink-hidden', !state.inkVisible);
      }
    };
    drawButton.addEventListener('click', () => { if (!noteId()) return; state.inkVisible = true; state.drawing = !state.drawing; state.selecting = false; state.eraser = false; selectedStroke = -1; selectionAnchor = null; dragStart = null; if (selectionDelete) selectionDelete.hidden = true; closeMenu(); syncCanvas(); update(); });
    selectButton.addEventListener('click', () => { if (!noteId()) return; state.inkVisible = true; state.selecting = !state.selecting; state.drawing = false; state.eraser = false; selectedStroke = -1; selectionAnchor = null; dragStart = null; if (selectionDelete) selectionDelete.hidden = true; closeMenu(); syncCanvas(); update(); });
    visibilityButton.addEventListener('click', () => { state.inkVisible = !state.inkVisible; if (!state.inkVisible) { state.drawing = false; state.selecting = false; state.eraser = false; selectedStroke = -1; selectionAnchor = null; dragStart = null; if (selectionDelete) selectionDelete.hidden = true; closeMenu(); } syncCanvas(); update(); });
    colorButton.addEventListener('click', event => { event.stopPropagation(); buildMenu(colorButton, update); });
    actions.prepend(control); update();
  };
  const buildMenu = (anchor, update) => {
    if (!menu) { menu = document.createElement('div'); menu.className = 'zotero-draw-menu'; menu.setAttribute('role', 'menu'); document.body.append(menu); }
    const wasOpen = !menu.hidden; closeMenu(); if (wasOpen) return;
    const activeSize = state.eraser ? state.eraserSize : state.size;
    const maxSize = state.eraser ? 35 : 12;
    const minSize = state.eraser ? 8 : 1;
    menu.innerHTML = palette.map(([color, name]) => `<button type="button" class="zotero-draw-menu__color ${!state.eraser && state.color === color ? 'is-selected' : ''}" data-color="${color}"><b>✓</b><i style="background:${color}"></i>${name}</button>`).join('') + `<div class="zotero-draw-menu__divider"></div><button type="button" class="zotero-draw-menu__eraser ${state.eraser ? 'is-active' : ''}">${eraserIcon}<span>橡皮擦</span></button><div class="zotero-draw-menu__size"><span>大小:</span><input type="range" min="${minSize}" max="${maxSize}" step=".5" value="${activeSize}"><span class="zotero-draw-menu__value">${activeSize.toFixed(1)}</span></div>`;
    const rect = anchor.getBoundingClientRect(); menu.style.left = `${Math.max(8, Math.min(window.innerWidth - 244, rect.left))}px`; menu.style.top = `${Math.min(window.innerHeight - 335, rect.bottom + 6)}px`; menu.hidden = false; anchor.setAttribute('aria-expanded', 'true');
    menu.querySelectorAll('[data-color]').forEach(button => button.addEventListener('click', () => { state.color = button.dataset.color; state.eraser = false; savePreferences(); update(); buildMenu(anchor, update); }));
    menu.querySelector('.zotero-draw-menu__eraser').addEventListener('click', () => { state.eraser = !state.eraser; update(); buildMenu(anchor, update); });
    const range = menu.querySelector('input'); range.addEventListener('input', () => { if (state.eraser) state.eraserSize = Number(range.value); else state.size = Number(range.value); savePreferences(); menu.querySelector('.zotero-draw-menu__value').textContent = Number(range.value).toFixed(1); update(); });
  };
  document.addEventListener('click', event => { if (!event.target.closest('.zotero-draw-control, .zotero-draw-menu')) closeMenu(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !event.target.matches('input, textarea, [contenteditable="true"]')) {
      if (leaveInteractionMode()) { event.preventDefault(); return; }
      closeMenu();
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && state.selecting && selectedStroke >= 0 && !event.target.matches('input, textarea, [contenteditable="true"]')) { event.preventDefault(); deleteSelectedStroke(); }
  });
  const scheduleMountAndSync = () => {
    const run = () => { mount(); syncCanvas(); };
    enqueue('drawing-ui', run);
  };
  listen('chengmo:ui-mounted', 'drawing-ui', scheduleMountAndSync);
  // IDs are attached by the note-list enhancer after React commits the list.
  listen('chengmo:note-list-ready', 'drawing-note-list', scheduleMountAndSync);
  const clearOutgoingDrawing = () => {
    if (saveTimer || saveIdle || pendingDrawingSave) flushDrawingSave();
    activeStroke = null; eraserPointerActive = false; pendingErasePoints = []; cancelSelectionDrag(); clearInteractionPointer();
    if (redrawFrame) { cancelAnimationFrame(redrawFrame); redrawFrame = 0; }
    loadedNoteId = ''; drawingsCache = []; selectedStroke = -1; persistedDrawingNoteId = ''; persistedDrawingRevision = -1;
    clearRenderedChunks(); invalidateGeometry(); markDrawingChanged();
  };
  const beginNoteSwitch = card => {
    const ids = noteIds();
    const nextId = reactKey(card, ids) || card?.dataset.noteId || '';
    if (!nextId || !ids.has(nextId) || nextId === loadedNoteId) return;
    pendingNoteSwitchId = nextId;
    clearOutgoingDrawing();
    if (noteSwitchFrame) cancelAnimationFrame(noteSwitchFrame);
    let attempts = 0;
    const settle = () => {
      noteSwitchFrame = 0;
      const selectedId = noteId();
      if (selectedId === pendingNoteSwitchId) {
        pendingNoteSwitchId = '';
        scheduleMountAndSync();
        return;
      }
      attempts += 1;
      if (attempts < 12) noteSwitchFrame = requestAnimationFrame(settle);
      else {
        // A failed reconciliation must leave the layer blank rather than
        // resurrecting an outgoing note's ink.
        pendingNoteSwitchId = '';
        scheduleMountAndSync();
      }
    };
    noteSwitchFrame = requestAnimationFrame(settle);
  };
  document.addEventListener('click', event => {
    const card = event.target.closest?.('.compact-note');
    if (card && !event.target.closest('.compact-note__delete')) beginNoteSwitch(card);
  }, true);
  listen('chengmo:note-selected', 'drawing-note-selected', () => {
    // Some navigation paths invoke a note card programmatically. Recheck on
    // the next frame after React has committed the reader.
    requestAnimationFrame(scheduleMountAndSync);
  });
  window.addEventListener('storage', event => { if (event.key === storageKey) { drawingStore = null; if (!activeStroke) loadDrawing(); scheduleRedraw(); } });
  window.addEventListener('resize', () => { closeMenu(); enqueue('drawing-redraw', scheduleRedraw); });
  const persistBeforeLeave = () => {
    flushDrawingSave();
    // A visibility change often follows a completed pen-up. Do not enqueue the
    // identical note a second time once its latest revision is already queued.
    if (loadedNoteId && (persistedDrawingNoteId !== loadedNoteId || persistedDrawingRevision !== drawingRevision)) {
      saveDrawing(loadedNoteId, drawingsCache);
      rememberPersistedDrawing(loadedNoteId);
    }
    // flushBootCache happens synchronously before this promise waits on IDB.
    window.chengmoStorage?.flush?.().catch(() => {});
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persistBeforeLeave(); }, { capture: true });
  window.addEventListener('pagehide', persistBeforeLeave, { capture: true });
  window.addEventListener('load', () => { window.setTimeout(scheduleMountAndSync, 80); });
})();
