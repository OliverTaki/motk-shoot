/* MOTK Shoot — optional browser-granted local JPEG mirror.
 * IndexedDB remains the recovery copy. A directory handle is project-scoped,
 * permission-gated, and every filename is immutable/collision-refusing. */
'use strict';
K.localFolder = {
  handle: null,
  projectDir: null,
  permission: 'none',

  supported() { return typeof window.showDirectoryPicker === 'function'; },
  _key() { return `localCaptureFolder:${K.project.current?.id || 'none'}`; },
  _safe(value, fallback = 'project') {
    return String(value || fallback).trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 80) || fallback;
  },

  async init() {
    K.bus.on('project:opened', () => this.restore().catch(() => this._emit()));
    await this.restore();
  },

  async restore() {
    this.handle = null;
    this.projectDir = null;
    this.permission = this.supported() ? 'none' : 'unsupported';
    if (!this.supported() || !K.project.current) return this._emit();
    const handle = await K.db.getMeta(this._key()).catch(() => null);
    if (!handle || handle.kind !== 'directory') return this._emit();
    this.handle = handle;
    this.permission = await handle.queryPermission({ mode: 'readwrite' }).catch(() => 'prompt');
    if (this.permission === 'granted') await this._openProjectDir();
    this._emit();
  },

  async choose() {
    if (!this.supported()) throw new Error('This browser cannot keep a persistent folder. Use Save / Share backup instead.');
    const handle = await window.showDirectoryPicker({ id: 'motk-shoot-captures', mode: 'readwrite' });
    const permission = await handle.requestPermission({ mode: 'readwrite' });
    if (permission !== 'granted') throw new Error('Folder access was not granted');
    this.handle = handle;
    this.permission = permission;
    await K.db.setMeta(this._key(), handle);
    await this._openProjectDir();
    this._emit();
    return handle.name;
  },

  async reconnect() {
    if (!this.handle) return this.choose();
    const permission = await this.handle.requestPermission({ mode: 'readwrite' });
    if (permission !== 'granted') throw new Error('Folder access was not granted');
    this.permission = permission;
    await this._openProjectDir();
    this._emit();
    return this.handle.name;
  },

  async forget() {
    if (K.project.current) await K.db.del('meta', this._key()).catch(() => {});
    this.handle = null;
    this.projectDir = null;
    this.permission = this.supported() ? 'none' : 'unsupported';
    this._emit();
  },

  async _openProjectDir() {
    if (!this.handle || this.permission !== 'granted') return null;
    this.projectDir = await this.handle.getDirectoryHandle(this._safe(K.project.current?.name, 'MOTK_Shoot'), { create: true });
    return this.projectDir;
  },

  async _writeUnique(dir, basename, blob) {
    let name = basename;
    for (let suffix = 0; suffix < 1000; suffix++) {
      try {
        await dir.getFileHandle(name);
        const dot = basename.lastIndexOf('.');
        name = dot > 0 ? `${basename.slice(0, dot)}_${suffix + 1}${basename.slice(dot)}` : `${basename}_${suffix + 1}`;
      } catch (error) {
        if (error?.name !== 'NotFoundError') throw error;
        const file = await dir.getFileHandle(name, { create: true });
        const writer = await file.createWritable({ keepExistingData: false });
        try { await writer.write(blob); await writer.close(); }
        catch (writeError) { await writer.abort().catch(() => {}); throw writeError; }
        return name;
      }
    }
    throw new Error('Could not allocate a unique capture filename');
  },

  async writeCapture({ id, blob, isTest = false, variant = '' }) {
    if (!blob || this.permission !== 'granted') return null;
    const root = this.projectDir || await this._openProjectDir();
    if (!root) return null;
    const folder = await root.getDirectoryHandle(isTest ? 'tests' : 'frames', { create: true });
    const captureIndex = Math.max(1, K.frames.captures.findIndex((capture) => capture.id === id) + 1);
    const marker = this._safe(String(id).slice(-8), 'capture');
    const kind = variant ? `_${this._safe(variant)}` : '';
    const name = `${isTest ? 'test' : 'capture'}_${String(captureIndex).padStart(5, '0')}_${marker}${kind}.jpg`;
    const written = await this._writeUnique(folder, name, blob);
    K.bus.emit('local-folder:wrote', { id, name: written, isTest, variant });
    this._emit();
    return written;
  },

  async writeSession(result, csv) {
    if (this.permission !== 'granted') return false;
    const root = this.projectDir || await this._openProjectDir();
    if (!root) return false;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await this._writeUnique(root, `session_${stamp}.json`, new Blob([JSON.stringify(result || {}, null, 2)], { type: 'application/json' }));
    if (csv) await this._writeUnique(root, `session_${stamp}.csv`, new Blob([csv], { type: 'text/csv' }));
    return true;
  },

  async shareBackup() {
    const blob = await K.exporter.buildProjectBackup();
    const name = `${this._safe(K.project.current?.name, 'motk-shoot')}_backup.zip`;
    const file = new File([blob], name, { type: 'application/zip' });
    if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
      await navigator.share({ title: K.project.current?.name || 'MOTK Shoot', files: [file] });
      return 'shared';
    }
    K.downloadBlob(name, blob);
    return 'downloaded';
  },

  state() {
    return {
      supported: this.supported(),
      connected: this.permission === 'granted' && !!this.projectDir,
      permission: this.permission,
      folderName: this.handle?.name || '',
      projectFolder: this.projectDir?.name || '',
    };
  },

  _emit() { K.bus.emit('local-folder:changed', this.state()); },
};
