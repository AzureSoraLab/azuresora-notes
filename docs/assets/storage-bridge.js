/*
 * Async persistence for the standalone reader.
 *
 * localStorage remains the synchronous boot cache because the bundled React
 * application reads it before an async database can respond. IndexedDB is the
 * durable, per-note store: it receives batched snapshots after the UI is idle
 * and provides a fast recovery path when the synchronous cache is unavailable.
 */
(() => {
  let local;
  try { local = window.localStorage; } catch {
    // Preview sandboxes sometimes deny storage entirely. Keep the reader
    // usable there; normal browsers continue into the IndexedDB path below.
    const unavailable = async () => null;
    window.chengmoStorage = { database: unavailable, saveNotes() {}, queueDrawing() {}, removeDrawing() {}, getDrawing: unavailable, getAllDrawings: async () => ({}), flush() {}, packStroke: value => value, unpackStroke: value => value, version: 2 };
    window.chengmoStorageReady = Promise.resolve();
    document.documentElement.dataset.chengmoPersistence = 'fallback';
    return;
  }
  const DB_NAME = 'chengmo-notebook-v2';
  const DB_VERSION = 1;
  const KEYS = {
    notes: 'chengmo-notes-v1',
    annotations: 'chengmo-text-selection-annotations-v1',
    drawings: 'chengmo-freehand-annotations-v1',
    drawingRecovery: 'chengmo-freehand-recovery-v1',
    preferences: 'chengmo-freehand-drawing-preferences-v1',
    recent: 'chengmo-recent-notes-v1',
    session: 'chengmo-reading-session-v1'
  };
  const SNAPSHOT_KEYS = [KEYS.notes, KEYS.annotations, KEYS.preferences, KEYS.recent, KEYS.session];
  const migrationKey = 'chengmo-indexeddb-migrated-v2';
  // Some embedded browser contexts do not expose the `Storage` constructor
  // even though localStorage itself is available. Patch its actual prototype.
  const storagePrototype = Object.getPrototypeOf(local);
  const nativeSetItem = storagePrototype.setItem;
  const nativeGetItem = storagePrototype.getItem;
  const nativeRemoveItem = storagePrototype.removeItem;
  const bootCache = new Map();
  let noteStateCache = null;
  let latestNotesState = null;
  let notesRevision = 0;
  let drawingStateCache = null;
  let drawingBootCacheDirty = false;
  let bootCacheTimer = 0;
  const jsonCache = new Map();
  const toJson = value => {
    try { return JSON.parse(value); } catch { return undefined; }
  };
  const readJson = (key, fallback) => {
    const raw = local.getItem(key);
    const cached = jsonCache.get(key);
    if (cached?.raw === raw) return cached.value === undefined ? fallback : cached.value;
    const value = toJson(raw);
    jsonCache.set(key, { raw, value });
    return value === undefined ? fallback : value;
  };
  const open = () => new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('IndexedDB is unavailable')); return; }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      if (!db.objectStoreNames.contains('notes')) db.createObjectStore('notes', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('drawings')) db.createObjectStore('drawings', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('textAnnotations')) db.createObjectStore('textAnnotations', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Unable to open IndexedDB'));
  });
  const complete = transaction => new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
  });
  const requestValue = request => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });
  const numericColor = color => {
    const value = String(color || '#000000').replace('#', '');
    return /^[0-9a-f]{6}$/i.test(value) ? parseInt(value, 16) : 0;
  };
  const colorFromNumber = value => `#${Number(value || 0).toString(16).padStart(6, '0')}`;
  const packStroke = stroke => {
    const points = Array.isArray(stroke?.points) ? stroke.points : [];
    const packed = new Uint16Array(points.length * 2);
    points.forEach((point, index) => {
      packed[index * 2] = Math.round(Math.max(0, Math.min(1, Number(point?.[0]) || 0)) * 65535);
      packed[index * 2 + 1] = Math.round(Math.max(0, Math.min(1, Number(point?.[1]) || 0)) * 65535);
    });
    return { color: numericColor(stroke?.color), size: Number(stroke?.size) || 2, eraser: Boolean(stroke?.eraser), points: packed };
  };
  const unpackStroke = stroke => {
    const source = stroke?.points instanceof Uint16Array ? stroke.points : new Uint16Array(stroke?.points || []);
    const points = [];
    for (let index = 0; index + 1 < source.length; index += 2) points.push([source[index] / 65535, source[index + 1] / 65535]);
    return { color: colorFromNumber(stroke?.color), size: Number(stroke?.size) || 2, eraser: Boolean(stroke?.eraser), points };
  };
  let dbPromise = null;
  let databaseWritePromise = Promise.resolve();
  let databaseWriteRevision = 0;
  let noteWritePromise = Promise.resolve();
  let pendingNotesState = null;
  let notesRetryTimer = 0;
  let drawingTimer = 0;
  let drawingIdle = 0;
  const drawingQueue = new Map();
  let drawingFlushPromise = null;
  let drawingWritePromise = Promise.resolve();
  let drawingRetryTimer = 0;
  const drawingReads = new Map();
  let metaTimer = 0;
  let metaRetryTimer = 0;
  const metaQueue = new Map();
  let metaWritePromise = Promise.resolve();
  let annotationWritePromise = Promise.resolve();
  let pendingAnnotations = null;
  let annotationRetryTimer = 0;
  const database = () => dbPromise || (dbPromise = open().catch(error => {
    console.warn('澄墨 IndexedDB 不可用，将继续使用浏览器本地缓存。', error);
    return null;
  }));
  const waitForIdle = callback => {
    if ('requestIdleCallback' in window) return window.requestIdleCallback(callback, { timeout: 1600 });
    return window.setTimeout(callback, 420);
  };
  const enqueueDatabaseWrite = operation => {
    databaseWriteRevision += 1;
    databaseWritePromise = databaseWritePromise.catch(() => {}).then(operation);
    return databaseWritePromise;
  };
  const scheduleNotesRetry = () => {
    if (notesRetryTimer || !pendingNotesState) return;
    notesRetryTimer = window.setTimeout(() => {
      notesRetryTimer = 0;
      // Rebuild this store so deletions are retried too.
      saveNotes(pendingNotesState, true);
    }, 2400);
  };
  const scheduleAnnotationsRetry = () => {
    if (annotationRetryTimer || !pendingAnnotations) return;
    annotationRetryTimer = window.setTimeout(() => {
      annotationRetryTimer = 0;
      saveAnnotations(pendingAnnotations, true);
    }, 2400);
  };
  const scheduleMetaRetry = () => {
    if (metaRetryTimer || !metaQueue.size) return;
    metaRetryTimer = window.setTimeout(() => {
      metaRetryTimer = 0;
      flushMeta().catch(() => scheduleMetaRetry());
    }, 2400);
  };
  const flushMeta = async () => {
    metaTimer = 0;
    const entries = [...metaQueue.entries()];
    if (!entries.length) return;
    metaWritePromise = enqueueDatabaseWrite(async () => {
      const db = await database();
      if (!db) throw new Error('IndexedDB is unavailable');
      const transaction = db.transaction('meta', 'readwrite');
      const store = transaction.objectStore('meta');
      entries.forEach(([key, value]) => store.put(value, key));
      await complete(transaction);
      // Do not discard values queued while this transaction was in flight.
      entries.forEach(([key, value]) => { if (metaQueue.get(key) === value) metaQueue.delete(key); });
    });
    try { await metaWritePromise; } catch (error) { scheduleMetaRetry(); throw error; }
    if (metaQueue.size) window.setTimeout(() => flushMeta().catch(() => scheduleMetaRetry()), 0);
  };
  const scheduleDrawingRetry = () => {
    if (drawingRetryTimer || !drawingQueue.size) return;
    drawingRetryTimer = window.setTimeout(() => {
      drawingRetryTimer = 0;
      flushDrawings().catch(() => {});
    }, 2400);
  };
  const flushDrawings = async () => {
    if (drawingFlushPromise) return drawingFlushPromise;
    drawingIdle = 0;
    const entries = [...drawingQueue.entries()];
    if (!entries.length) return;
    drawingFlushPromise = drawingWritePromise = enqueueDatabaseWrite(async () => {
      const db = await database();
      if (!db) throw new Error('IndexedDB is unavailable');
      const transaction = db.transaction('drawings', 'readwrite');
      const store = transaction.objectStore('drawings');
      entries.forEach(([id, strokes]) => store.put({ id, strokes: strokes.map(packStroke), updatedAt: Date.now() }));
      await complete(transaction);
      // A newer save may have replaced this queue entry while the write ran.
      entries.forEach(([id, strokes]) => { if (drawingQueue.get(id) === strokes) drawingQueue.delete(id); });
    }).catch(error => {
      scheduleDrawingRetry();
      throw error;
    }).finally(() => {
      drawingFlushPromise = null;
      // Flush anything added while the previous transaction was pending after
      // releasing the single-flight guard.
      if (drawingQueue.size) window.setTimeout(() => flushDrawings().catch(() => scheduleDrawingRetry()), 0);
    });
    return drawingFlushPromise;
  };
  const saveNotes = (state, replace = false) => {
    if (!state || typeof state !== 'object' || !Array.isArray(state.notes)) return;
    pendingNotesState = state;
    const { notes: ignoredNotes, ...stateMeta } = state;
    // Keep an explicit manifest. Older records can remain in IndexedDB after
    // an interrupted write, but they must never be restored as live notes.
    const meta = { ...stateMeta, noteIds: state.notes.map(note => note?.id).filter(Boolean) };
    noteWritePromise = enqueueDatabaseWrite(async () => {
      const db = await database();
      if (!db) return;
      const transaction = db.transaction(['meta', 'notes'], 'readwrite');
      transaction.objectStore('meta').put(meta, 'notes-state');
      const notes = transaction.objectStore('notes');
      // A full replacement makes consecutive create/delete operations safe even
      // when both changes are queued before either IndexedDB transaction runs.
      notes.clear();
      state.notes.forEach(note => note?.id && notes.put({ ...note }));
      await complete(transaction);
      saveNotes.previous = new Map(state.notes.filter(note => note?.id).map(note => [note.id, note]));
    }).catch(() => { scheduleNotesRetry(); });
    return noteWritePromise;
  };
  const saveNotesFromObject = state => {
    saveNotes(state);
    queueNoteBootCache(state);
    document.dispatchEvent(new CustomEvent('chengmo:notes-state-updated'));
  };
  const saveAnnotations = (items, replace = false) => {
    if (!Array.isArray(items)) return;
    pendingAnnotations = items;
    const next = new Set(items.map(item => item?.id).filter(Boolean));
    annotationWritePromise = enqueueDatabaseWrite(async () => {
      const db = await database();
      if (!db) return;
      const transaction = db.transaction('textAnnotations', 'readwrite');
      const store = transaction.objectStore('textAnnotations');
      // Match the synchronous annotation list exactly to avoid orphan records
      // from rapid add/remove operations.
      store.clear();
      items.forEach(item => item?.id && store.put({ ...item }));
      await complete(transaction);
      saveAnnotations.previous = next;
    }).catch(() => { scheduleAnnotationsRetry(); });
    return annotationWritePromise;
  };
  const flushBootCache = () => {
    bootCacheTimer = 0;
    if (noteStateCache) {
      bootCache.set(KEYS.notes, JSON.stringify(noteStateCache));
      noteStateCache = null;
    }
    if (drawingStateCache && drawingBootCacheDirty) {
      bootCache.set(KEYS.drawings, JSON.stringify(drawingStateCache));
      drawingBootCacheDirty = false;
    }
    bootCache.forEach((value, key) => nativeSetItem.call(local, key, value));
    bootCache.clear();
  };
  const scheduleBootCacheFlush = () => {
    if (bootCacheTimer) return;
    bootCacheTimer = window.setTimeout(flushBootCache, 1800);
  };
  const queueBootCache = (key, value) => {
    bootCache.set(key, value);
    scheduleBootCacheFlush();
  };
  const queueNoteBootCache = state => {
    noteStateCache = state;
    latestNotesState = state;
    notesRevision += 1;
    scheduleBootCacheFlush();
  };
  const queueDrawingsCache = drawings => {
    drawingStateCache = drawings;
    drawingBootCacheDirty = true;
    scheduleBootCacheFlush();
  };
  const queueMeta = (key, value) => {
    metaQueue.set(key, value);
    if (metaTimer) return;
    metaTimer = window.setTimeout(() => { flushMeta().catch(() => scheduleMetaRetry()); }, 480);
  };
  const queueDrawing = (id, strokes) => {
    if (!id) return;
    drawingQueue.set(id, strokes.map(stroke => ({ ...stroke, points: (stroke.points || []).map(point => [point[0], point[1]]) })));
    window.clearTimeout(drawingTimer);
    drawingTimer = window.setTimeout(() => {
      drawingTimer = 0;
      if (drawingIdle) return;
      drawingIdle = waitForIdle(() => { flushDrawings().catch(() => {}); });
    }, 680);
  };
  let drawingRevision = 0;
  const saveDrawing = (id, strokes) => {
    if (!id) return;
    const current = drawingStateCache || readJson(KEYS.drawings, {});
    current[id] = strokes;
    // Retain the updated compatibility snapshot in memory until it is flushed.
    // Without this assignment, every completed stroke reparses the complete
    // drawing JSON while the deferred cache write is still pending.
    drawingStateCache = current;
    drawingRevision += 1;
    queueDrawingsCache(current);
    queueDrawing(id, strokes);
  };
  const persistDrawingSnapshot = (id, strokes) => {
    if (!id || !Array.isArray(strokes)) return;
    // Keep only the just-finished note synchronous. Writing the complete ink
    // library for every pen-up made long notes stutter, while this small
    // recovery record still survives an immediate Ctrl+R.
    try { nativeSetItem.call(local, KEYS.drawingRecovery, JSON.stringify({ id, strokes, updatedAt: Date.now() })); } catch {}
  };
  const getDrawingRecovery = id => {
    if (!id) return null;
    const record = readJson(KEYS.drawingRecovery, null);
    return record?.id === id && Array.isArray(record.strokes) ? record.strokes : null;
  };
  const removeDrawing = id => {
    if (!id) return;
    drawingQueue.delete(id);
    drawingRevision += 1;
    // Serialize deletes after an in-flight put so an old delayed write cannot
    // recreate ink for a note that has already been deleted.
    drawingWritePromise = enqueueDatabaseWrite(async () => {
      const db = await database();
      if (!db) return;
      const transaction = db.transaction('drawings', 'readwrite');
      transaction.objectStore('drawings').delete(id);
      await complete(transaction);
    });
    return drawingWritePromise;
  };
  const flushDrawingsUntilStable = async () => {
    while (true) {
      const revision = drawingRevision;
      await flushDrawings();
      await drawingWritePromise;
      if (revision === drawingRevision && !drawingQueue.size && !drawingFlushPromise) return;
    }
  };
  const flushDatabaseUntilStable = async () => {
    while (true) {
      const revision = databaseWriteRevision;
      await databaseWritePromise;
      if (revision === databaseWriteRevision) return;
    }
  };
  const flush = async () => {
    if (drawingTimer) { window.clearTimeout(drawingTimer); drawingTimer = 0; }
    if (drawingIdle) {
      if ('cancelIdleCallback' in window) window.cancelIdleCallback(drawingIdle); else window.clearTimeout(drawingIdle);
      drawingIdle = 0;
    }
    if (metaTimer) { window.clearTimeout(metaTimer); metaTimer = 0; }
    if (bootCacheTimer) { window.clearTimeout(bootCacheTimer); bootCacheTimer = 0; }
    flushBootCache();
    await Promise.all([flushMeta(), flushDrawingsUntilStable()]);
    await flushDatabaseUntilStable();
  };
  const migrate = async () => {
    if (local.getItem(migrationKey) === '1') return;
    const db = await database();
    if (!db) return;
    const notes = readJson(KEYS.notes, {});
    const annotations = readJson(KEYS.annotations, []);
    const drawings = readJson(KEYS.drawings, {});
    const transaction = db.transaction(['meta', 'notes', 'drawings', 'textAnnotations'], 'readwrite');
    const meta = transaction.objectStore('meta');
    const noteStore = transaction.objectStore('notes');
    const drawingStore = transaction.objectStore('drawings');
    const annotationStore = transaction.objectStore('textAnnotations');
    SNAPSHOT_KEYS.filter(key => key !== KEYS.notes).forEach(key => meta.put(readJson(key, []), key));
    const { notes: legacyNotes, ...legacyMeta } = notes;
    meta.put({ ...legacyMeta, noteIds: (Array.isArray(legacyNotes) ? legacyNotes : []).map(note => note?.id).filter(Boolean) }, 'notes-state');
    (Array.isArray(notes?.notes) ? notes.notes : []).forEach(note => note?.id && noteStore.put({ ...note }));
    (Array.isArray(annotations) ? annotations : []).forEach(item => item?.id && annotationStore.put({ ...item }));
    Object.entries(drawings && typeof drawings === 'object' ? drawings : {}).forEach(([id, strokes]) => {
      if (Array.isArray(strokes)) drawingStore.put({ id, strokes: strokes.map(packStroke), updatedAt: Date.now() });
    });
    await complete(transaction);
    saveNotes.previous = new Map((Array.isArray(notes?.notes) ? notes.notes : []).filter(note => note?.id).map(note => [note.id, note]));
    saveAnnotations.previous = new Set((Array.isArray(annotations) ? annotations : []).map(item => item?.id).filter(Boolean));
    local.setItem(migrationKey, '1');
  };
  const hydrateNotes = async () => {
    const requestedRevision = notesRevision;
    const db = await database();
    if (!db) return;
    const transaction = db.transaction(['meta', 'notes'], 'readonly');
    const meta = await requestValue(transaction.objectStore('meta').get('notes-state'));
    const records = await requestValue(transaction.objectStore('notes').getAll());
    // The reader is ready before IndexedDB finishes. Never let a delayed
    // hydration replace notes created or edited during that short window.
    const hasManifest = Array.isArray(meta?.noteIds);
    const notes = hasManifest ? records.filter(note => meta.noteIds.includes(note?.id)) : records;
    if (!meta || (!notes.length && !hasManifest) || notesRevision !== requestedRevision) return;
    const { noteIds, notes: ignoredNotes, ...stateMeta } = meta;
    const state = { ...stateMeta, notes };
    nativeSetItem.call(local, KEYS.notes, JSON.stringify(state));
    latestNotesState = state;
    saveNotes.previous = new Map(notes.filter(note => note?.id).map(note => [note.id, note]));
  };
  const restoreDrawings = async () => {
    const db = await database();
    if (!db) return;
    const transaction = db.transaction('drawings', 'readonly');
    const records = await requestValue(transaction.objectStore('drawings').getAll());
    const cached = readJson(KEYS.drawings, {});
    if (!records?.length || Object.keys(cached || {}).length) return;
    const restored = {};
    records.forEach(record => { restored[record.id] = (record.strokes || []).map(unpackStroke); });
    local.setItem(KEYS.drawings, JSON.stringify(restored));
  };
  const getDrawing = async id => {
    const db = await database();
    if (!db || !id) return null;
    if (drawingReads.has(id)) return drawingReads.get(id);
    const request = (async () => {
      const transaction = db.transaction('drawings', 'readonly');
      const record = await requestValue(transaction.objectStore('drawings').get(id));
      return record ? (record.strokes || []).map(unpackStroke) : null;
    })().finally(() => drawingReads.delete(id));
    drawingReads.set(id, request);
    return request;
  };
  const getAllDrawings = async () => {
    const db = await database();
    if (!db) return {};
    const transaction = db.transaction('drawings', 'readonly');
    const records = await requestValue(transaction.objectStore('drawings').getAll());
    return Object.fromEntries(records.map(record => [record.id, (record.strokes || []).map(unpackStroke)]));
  };
  const replaceSnapshot = async snapshot => {
    if (!snapshot || typeof snapshot !== 'object') return;
    return enqueueDatabaseWrite(async () => {
      window.clearTimeout(drawingTimer); drawingTimer = 0;
      if (drawingIdle) {
        if ('cancelIdleCallback' in window) window.cancelIdleCallback(drawingIdle); else window.clearTimeout(drawingIdle);
        drawingIdle = 0;
      }
      window.clearTimeout(metaTimer); metaTimer = 0;
      drawingQueue.clear(); metaQueue.clear();
      const db = await database();
      if (!db) return;
      const notesState = snapshot.notes && typeof snapshot.notes === 'object' ? snapshot.notes : {};
      const notes = Array.isArray(notesState.notes) ? notesState.notes : [];
      const annotations = Array.isArray(snapshot.annotations) ? snapshot.annotations : [];
      const drawings = snapshot.drawings && typeof snapshot.drawings === 'object' ? snapshot.drawings : {};
      const transaction = db.transaction(['meta', 'notes', 'drawings', 'textAnnotations'], 'readwrite');
      const meta = transaction.objectStore('meta');
      const noteStore = transaction.objectStore('notes');
      const drawingStore = transaction.objectStore('drawings');
      const annotationStore = transaction.objectStore('textAnnotations');
      const { notes: ignoredNotes, ...stateMeta } = notesState;
      meta.put({ ...stateMeta, noteIds: notes.map(note => note?.id).filter(Boolean) }, 'notes-state');
      if (snapshot.recent) meta.put(snapshot.recent, KEYS.recent);
      if (snapshot.preferences) meta.put(snapshot.preferences, KEYS.preferences);
      noteStore.clear(); drawingStore.clear(); annotationStore.clear();
      notes.forEach(note => note?.id && noteStore.put({ ...note }));
      annotations.forEach(item => item?.id && annotationStore.put({ ...item }));
      Object.entries(drawings).forEach(([id, strokes]) => {
        if (Array.isArray(strokes)) drawingStore.put({ id, strokes: strokes.map(packStroke), updatedAt: Date.now() });
      });
      await complete(transaction);
      saveNotes.previous = new Map(notes.filter(note => note?.id).map(note => [note.id, note]));
      saveAnnotations.previous = new Set(annotations.map(item => item?.id).filter(Boolean));
      pendingNotesState = notesState;
      pendingAnnotations = annotations;
      drawingStateCache = drawings;
      drawingBootCacheDirty = false;
      drawingRevision += 1;
    });
  };
  const mirrorStorageWrite = () => {
    storagePrototype.getItem = function patchedGetItem(key) {
      if (this === local && bootCache.has(key)) return bootCache.get(key);
      return nativeGetItem.call(this, key);
    };
    storagePrototype.setItem = function patchedSetItem(key, value) {
      if (this !== local) { nativeSetItem.call(this, key, value); return; }
      if (key === KEYS.notes) {
        const state = toJson(value);
        saveNotes(state);
        latestNotesState = state && typeof state === 'object' ? state : null;
        notesRevision += 1;
        queueBootCache(key, value);
        document.dispatchEvent(new CustomEvent('chengmo:notes-state-updated'));
        return;
      }
      if (key === KEYS.annotations) {
        saveAnnotations(toJson(value));
        queueBootCache(key, value);
        return;
      }
      if (key === KEYS.drawings) {
        const drawings = toJson(value);
        // Keep the in-memory compatibility snapshot aligned with explicit
        // imports and deletions. This avoids reparsing all drawing JSON on the
        // next stroke without allowing an older snapshot to overwrite data.
        drawingStateCache = drawings && typeof drawings === 'object' ? drawings : {};
        drawingBootCacheDirty = false;
        if (drawings && typeof drawings === 'object') Object.entries(drawings).forEach(([id, strokes]) => Array.isArray(strokes) && queueDrawing(id, strokes));
        queueBootCache(key, value);
        return;
      }
      nativeSetItem.call(this, key, value);
      if (SNAPSHOT_KEYS.includes(key)) queueMeta(key, toJson(value));
    };
    storagePrototype.removeItem = function patchedRemoveItem(key) {
      if (this === local) {
        bootCache.delete(key);
        if (key === KEYS.notes) { latestNotesState = null; notesRevision += 1; }
        if (key === KEYS.drawings) { drawingStateCache = {}; drawingBootCacheDirty = false; }
      }
      nativeRemoveItem.call(this, key);
    };
  };
  mirrorStorageWrite();
  // IndexedDB is asynchronous, so begin persistence when the page becomes
  // hidden instead of waiting until the final pagehide event.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush().catch(() => {}); }, { capture: true });
  window.addEventListener('pagehide', () => { flush().catch(() => {}); }, { capture: true });
  const peekNotes = () => noteStateCache || latestNotesState || readJson(KEYS.notes, {});
  window.chengmoStorage = { database, saveNotes: saveNotesFromObject, queueNoteBootCache, peekNotes, saveDrawing, persistDrawingSnapshot, getDrawingRecovery, queueDrawing, removeDrawing, getDrawing, getAllDrawings, replaceSnapshot, flush, unpackStroke, packStroke, version: 2 };
  document.documentElement.dataset.chengmoPersistence = 'loading';
  window.chengmoStorageReady = database()
    .then(migrate)
    .then(hydrateNotes)
    .then(() => { document.documentElement.dataset.chengmoPersistence = 'ready'; })
    .catch(() => { document.documentElement.dataset.chengmoPersistence = 'fallback'; });
})();
