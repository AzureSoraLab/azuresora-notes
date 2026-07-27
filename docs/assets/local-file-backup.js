/* A user-chosen folder is the only safe way a web page can keep a local file. */
(() => {
  const DB_NAME = 'azuresora-notes-local-backup-v1';
  const STORE = 'settings';
  const KEY = 'directory';
  const FILE_NAME = 'azuresora-notes-backup.json';
  let directoryHandle = null;
  let savePromise = Promise.resolve();
  const supported = () => typeof window.showDirectoryPicker === 'function';
  const database = () => new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Unable to open local backup settings.'));
  });
  const readHandle = async () => {
    try {
      const db = await database();
      return await new Promise((resolve, reject) => {
        const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    } catch { return null; }
  };
  const writeHandle = async handle => {
    const db = await database();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).put(handle, KEY);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  };
  const removeHandle = async () => {
    directoryHandle = null;
    try {
      const db = await database();
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE, 'readwrite');
        transaction.objectStore(STORE).delete(KEY);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
    } catch {}
  };
  const hasPermission = async (request = false) => {
    if (!directoryHandle) return false;
    const options = { mode: 'readwrite' };
    const state = request ? await directoryHandle.requestPermission(options) : await directoryHandle.queryPermission(options);
    return state === 'granted';
  };
  const makePayload = async () => {
    const factory = window.chengmoBuildBackupPayload;
    if (typeof factory !== 'function') throw new Error('The backup module is still loading.');
    return factory();
  };
  const save = async (payload, requestPermission = false) => {
    if (!supported()) return { ok: false, reason: 'unsupported' };
    if (!directoryHandle) directoryHandle = await readHandle();
    if (!directoryHandle) return { ok: false, reason: 'missing' };
    if (!await hasPermission(requestPermission)) return { ok: false, reason: 'permission' };
    const data = payload || await makePayload();
    savePromise = savePromise.catch(() => {}).then(async () => {
      const file = await directoryHandle.getFileHandle(FILE_NAME, { create: true });
      const writable = await file.createWritable();
      await writable.write(JSON.stringify(data, null, 2));
      await writable.close();
    });
    await savePromise;
    return { ok: true, fileName: FILE_NAME };
  };
  const chooseDirectory = async payload => {
    if (!supported()) return { ok: false, reason: 'unsupported' };
    directoryHandle = await window.showDirectoryPicker({ id: 'azuresora-notes-backups', mode: 'readwrite' });
    await writeHandle(directoryHandle);
    return save(payload, true);
  };
  window.chengmoLocalBackup = { supported, chooseDirectory, save, clearDirectory: removeHandle, fileName: FILE_NAME };
  readHandle().then(handle => { directoryHandle = handle; });
})();
