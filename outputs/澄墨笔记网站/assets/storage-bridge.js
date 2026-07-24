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
  let drawingStateCache = null;
  let bootCacheTimer = 0;
  const toJson = value => {
    try { return JSON.parse(value); } catch { return undefined; }
  };
  const readJson = (key, fallback) => {
    const value = toJson(local.getItem(key));
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
  let drawingTimer = 0;
  let drawingIdle = 0;
  const drawingQueue = new Map();
  let metaTimer = 0;
  const metaQueue = new Map();
  const database = () => dbPromise || (dbPromise = open().catch(error => {
    console.warn('澄墨 IndexedDB 不可用，将继续使用浏览器本地缓存。', error);
    return null;
  }));
  const waitForIdle = callback => {
    if ('requestIdleCallback' in window) return window.requestIdleCallback(callback, { timeout: 1600 });
    return window.setTimeout(callback, 420);
  };
  const flushMeta = async () => {
    metaTimer = 0;
    const entries = [...metaQueue.entries()];
    metaQueue.clear();
    const db = await database();
    if (!db || !entries.length) return;
    const transaction = db.transaction('meta', 'readwrite');
    const store = transaction.objectStore('meta');
    entries.forEach(([key, value]) => store.put(value, key));
    await complete(transaction);
  };
  const flushDrawings = async () => {
    drawingIdle = 0;
    const entries = [...drawingQueue.entries()];
    drawingQueue.clear();
    const db = await database();
    if (!db || !entries.length) return;
    const transaction = db.transaction('drawings', 'readwrite');
    const store = transaction.objectStore('drawings');
    entries.forEach(([id, strokes]) => store.put({ id, strokes: strokes.map(packStroke), updatedAt: Date.now() }));
    await complete(transaction);
  };
  const saveNotes = state => {
    if (!state || typeof state !== 'object' || !Array.isArray(state.notes)) return;
    const currentIds = new Set(state.notes.map(note => note?.id).filter(Boolean));
    const meta = { ...state, notes: undefined };
    const previous = saveNotes.previous || new Map();
    const removed = [...previous.keys()].filter(id => !currentIds.has(id));
    const changed = state.notes.filter(note => note?.id && previous.get(note.id) !== note);
    saveNotes.previous = new Map(state.notes.filter(note => note?.id).map(note => [note.id, note]));
    database().then(db => {
      if (!db) return;
      const transaction = db.transaction(['meta', 'notes'], 'readwrite');
      transaction.objectStore('meta').put(meta, 'notes-state');
      const notes = transaction.objectStore('notes');
      changed.forEach(note => notes.put({ ...note }));
      removed.forEach(id => notes.delete(id));
      return complete(transaction);
    }).catch(() => {});
  };
  const saveNotesFromObject = state => {
    saveNotes(state);
    queueNoteBootCache(state);
  };
  const saveAnnotations = items => {
    if (!Array.isArray(items)) return;
    const previous = saveAnnotations.previous || new Set();
    const next = new Set(items.map(item => item?.id).filter(Boolean));
    const removed = [...previous].filter(id => !next.has(id));
    saveAnnotations.previous = next;
    database().then(db => {
      if (!db) return;
      const transaction = db.transaction('textAnnotations', 'readwrite');
      const store = transaction.objectStore('textAnnotations');
      items.forEach(item => item?.id && store.put({ ...item }));
      removed.forEach(id => store.delete(id));
      return complete(transaction);
    }).catch(() => {});
  };
  const flushBootCache = () => {
    bootCacheTimer = 0;
    if (noteStateCache) {
      bootCache.set(KEYS.notes, JSON.stringify(noteStateCache));
      noteStateCache = null;
    }
    if (drawingStateCache) {
      bootCache.set(KEYS.drawings, JSON.stringify(drawingStateCache));
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
    scheduleBootCacheFlush();
  };
  const queueDrawingsCache = drawings => {
    drawingStateCache = drawings;
    scheduleBootCacheFlush();
  };
  const queueMeta = (key, value) => {
    metaQueue.set(key, value);
    if (metaTimer) return;
    metaTimer = window.setTimeout(() => { flushMeta().catch(() => {}); }, 480);
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
  const saveDrawing = (id, strokes) => {
    if (!id) return;
    const current = drawingStateCache || readJson(KEYS.drawings, {});
    current[id] = strokes;
    // Retain the updated compatibility snapshot in memory until it is flushed.
    // Without this assignment, every completed stroke reparses the complete
    // drawing JSON while the deferred cache write is still pending.
    drawingStateCache = current;
    queueDrawingsCache(current);
    queueDrawing(id, strokes);
  };
  const removeDrawing = id => {
    if (!id) return;
    drawingQueue.delete(id);
    database().then(db => {
      if (!db) return;
      const transaction = db.transaction('drawings', 'readwrite');
      transaction.objectStore('drawings').delete(id);
      return complete(transaction);
    }).catch(() => {});
  };
  const flush = () => {
    if (drawingTimer) { window.clearTimeout(drawingTimer); drawingTimer = 0; }
    if (drawingIdle) {
      if ('cancelIdleCallback' in window) window.cancelIdleCallback(drawingIdle); else window.clearTimeout(drawingIdle);
      drawingIdle = 0;
    }
    if (metaTimer) { window.clearTimeout(metaTimer); metaTimer = 0; }
    if (bootCacheTimer) { window.clearTimeout(bootCacheTimer); bootCacheTimer = 0; }
    flushBootCache();
    flushMeta().catch(() => {});
    flushDrawings().catch(() => {});
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
    meta.put({ ...notes, notes: undefined }, 'notes-state');
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
    const db = await database();
    if (!db) return;
    const transaction = db.transaction(['meta', 'notes'], 'readonly');
    const meta = await requestValue(transaction.objectStore('meta').get('notes-state'));
    const notes = await requestValue(transaction.objectStore('notes').getAll());
    if (!meta || !notes.length) return;
    const state = { ...meta, notes };
    nativeSetItem.call(local, KEYS.notes, JSON.stringify(state));
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
    const transaction = db.transaction('drawings', 'readonly');
    const record = await requestValue(transaction.objectStore('drawings').get(id));
    return record ? (record.strokes || []).map(unpackStroke) : null;
  };
  const getAllDrawings = async () => {
    const db = await database();
    if (!db) return {};
    const transaction = db.transaction('drawings', 'readonly');
    const records = await requestValue(transaction.objectStore('drawings').getAll());
    return Object.fromEntries(records.map(record => [record.id, (record.strokes || []).map(unpackStroke)]));
  };
  const mirrorStorageWrite = () => {
    storagePrototype.getItem = function patchedGetItem(key) {
      if (this === local && bootCache.has(key)) return bootCache.get(key);
      return nativeGetItem.call(this, key);
    };
    storagePrototype.setItem = function patchedSetItem(key, value) {
      if (this !== local) { nativeSetItem.call(this, key, value); return; }
      if (key === KEYS.notes) {
        saveNotes(toJson(value));
        queueBootCache(key, value);
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
        if (key === KEYS.drawings) drawingStateCache = {};
      }
      nativeRemoveItem.call(this, key);
    };
  };
  mirrorStorageWrite();
  window.addEventListener('pagehide', flush, { capture: true });
  window.chengmoStorage = { database, saveNotes: saveNotesFromObject, queueNoteBootCache, saveDrawing, queueDrawing, removeDrawing, getDrawing, getAllDrawings, flush, unpackStroke, packStroke, version: 2 };
  document.documentElement.dataset.chengmoPersistence = 'loading';
  window.chengmoStorageReady = database()
    .then(migrate)
    .then(hydrateNotes)
    .then(restoreDrawings)
    .then(() => { document.documentElement.dataset.chengmoPersistence = 'ready'; })
    .catch(() => { document.documentElement.dataset.chengmoPersistence = 'fallback'; });
})();
