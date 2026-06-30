// db.js — IndexedDB CRUD for the notepad
// DB: notepad-db v1 · Store: notes (keyPath id) · Indexes: tags(multiEntry), updatedAt

const DB_NAME = 'notepad-db';
const DB_VERSION = 1;
const STORE = 'notes';

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('tags', 'tags', { multiEntry: true });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function tx(mode) {
  return openDB().then((db) => db.transaction(STORE, mode).objectStore(STORE));
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const DB = {
  async create({ title = 'Sem título', content = '', tags = [] } = {}) {
    const now = Date.now();
    const note = {
      id: crypto.randomUUID(),
      title,
      content,
      tags,
      createdAt: now,
      updatedAt: now,
    };
    const store = await tx('readwrite');
    await reqToPromise(store.add(note));
    return note;
  },

  async get(id) {
    const store = await tx('readonly');
    return reqToPromise(store.get(id));
  },

  async update(id, patch) {
    // get + put must run in one transaction WITHOUT an `await` between them —
    // awaiting lets the readwrite transaction auto-commit, after which `put`
    // would throw TransactionInactiveError and the change would never persist.
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      const store = transaction.objectStore(STORE);
      let updated = null;
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const existing = getReq.result;
        if (!existing) {
          reject(new Error('Nota não encontrada: ' + id));
          transaction.abort();
          return;
        }
        updated = { ...existing, ...patch, id, updatedAt: Date.now() };
        store.put(updated); // synchronous in onsuccess → transaction stays active
      };
      getReq.onerror = () => reject(getReq.error);
      transaction.oncomplete = () => resolve(updated);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Transação abortada'));
    });
  },

  async remove(id) {
    const store = await tx('readwrite');
    return reqToPromise(store.delete(id));
  },

  async all() {
    const store = await tx('readonly');
    const notes = await reqToPromise(store.getAll());
    return notes.sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async allTags() {
    const notes = await this.all();
    const counts = new Map();
    for (const n of notes) {
      for (const t of n.tags || []) {
        counts.set(t, (counts.get(t) || 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag, count]) => ({ tag, count }));
  },
};
