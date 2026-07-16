/* MOTK Shoot — IndexedDB persistence
 * stores:
 *  projects: {id, name, fps, edits, activeEditId, layers, settings, audioName, audioOffset, createdAt, updatedAt}
 *  frames:   {id, projectId, blob, thumb(dataURL), w, h, shotHold, note, raw, passes, isTest, capturedAt}
 *  audio:    {projectId, blob, name}
 *  assets:   {id, projectId, blob}            (layer images)
 *  meta:     {key, value}                     (device and app preferences)
 */
'use strict';
K.db = {
  _db: null,

  open() {
    return new Promise((res, rej) => {
      // NOTE: legacy DB name kept on purpose — renaming would orphan existing user data
      const req = indexedDB.open('komadori', 2);
      req.onupgradeneeded = (e) => {
        const db = req.result;
        if (e.oldVersion < 1) {
          db.createObjectStore('projects', { keyPath: 'id' });
          const f = db.createObjectStore('frames', { keyPath: 'id' });
          f.createIndex('byProject', 'projectId', { unique: false });
          db.createObjectStore('audio', { keyPath: 'projectId' });
          db.createObjectStore('meta', { keyPath: 'key' });
        }
        if (e.oldVersion < 2) {
          const a = db.createObjectStore('assets', { keyPath: 'id' });
          a.createIndex('byProject', 'projectId', { unique: false });
        }
      };
      req.onsuccess = () => { this._db = req.result; res(); };
      req.onerror = () => rej(req.error);
    });
  },

  _tx(store, mode, fn) {
    return new Promise((res, rej) => {
      const tx = this._db.transaction(store, mode);
      const st = tx.objectStore(store);
      const out = fn(st);
      tx.oncomplete = () => res(out && out._value !== undefined ? out._value : undefined);
      tx.onerror = () => rej(tx.error);
    });
  },

  put(store, obj) { return this._tx(store, 'readwrite', (st) => st.put(obj)); },
  del(store, key) { return this._tx(store, 'readwrite', (st) => st.delete(key)); },

  get(store, key) {
    return new Promise((res, rej) => {
      const req = this._db.transaction(store).objectStore(store).get(key);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  },

  getAll(store) {
    return new Promise((res, rej) => {
      const req = this._db.transaction(store).objectStore(store).getAll();
      req.onsuccess = () => res(req.result || []);
      req.onerror = () => rej(req.error);
    });
  },

  byProject(store, projectId) {
    return new Promise((res, rej) => {
      const idx = this._db.transaction(store).objectStore(store).index('byProject');
      const req = idx.getAll(projectId);
      req.onsuccess = () => res(req.result || []);
      req.onerror = () => rej(req.error);
    });
  },

  framesOfProject(projectId) { return this.byProject('frames', projectId); },

  async deleteProjectData(projectId) {
    const frames = await this.framesOfProject(projectId);
    await Promise.all(frames.map((f) => this.del('frames', f.id)));
    const assets = await this.byProject('assets', projectId).catch(() => []);
    await Promise.all(assets.map((a) => this.del('assets', a.id)));
    await this.del('audio', projectId).catch(() => {});
    await this.del('projects', projectId);
  },

  async setMeta(key, value) { await this.put('meta', { key, value }); },
  async getMeta(key) { const r = await this.get('meta', key); return r ? r.value : undefined; },
};
