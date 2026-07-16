/* MOTK Shoot — non-linear frame model.
 *
 * captures: immutable bin of every shot ever taken (chronological, "as-shot").
 *           Blobs live in IndexedDB and are never destroyed by timeline edits.
 * edits:    named reference lists [{id, hold}] into the captures bin. The
 *           active edit is what the timeline/playback shows. Multiple edits
 *           ("alt edits") coexist; any edit can be reset to as-shot.
 * list:     materialized view of the active edit, consumed by the rest of
 *           the app: [{id, hold, note, w, h, thumb, raw, passes}].
 */
'use strict';
K.frames = {
  captures: [],        // [{id, w, h, thumb, note, raw, passes, shotHold, isTest, capturedAt}]
  edits: [],           // [{id, name, items: [{id, hold}]}]
  activeEditId: null,
  list: [],
  _undo: [],
  _redo: [],
  _undoMax: 100,
  _bitmaps: new Map(), // id -> ImageBitmap (LRU)
  _bitmapMax: 140,
  _thumbW: 118 * 2,

  reset({ captures = [], edits = null, activeEditId = null } = {}) {
    this.captures = captures;
    this.edits = edits && edits.length ? edits : [{ id: 'e1', name: 'Edit 1', items: [] }];
    this.activeEditId = activeEditId && this.edits.some((e) => e.id === activeEditId)
      ? activeEditId : this.edits[0].id;
    this._undo = [];
    this._redo = [];
    for (const b of this._bitmaps.values()) b.close();
    this._bitmaps.clear();
    this._materialize();
  },

  activeEdit() { return this.edits.find((e) => e.id === this.activeEditId); },
  captureOf(id) { return this.captures.find((c) => c.id === id); },

  _materialize() {
    const byId = new Map(this.captures.map((c) => [c.id, c]));
    this.list = this.activeEdit().items.map((it) => {
      const c = byId.get(it.id) || {};
      return { id: it.id, hold: it.hold || 1, note: c.note || '', w: c.w, h: c.h, thumb: c.thumb, raw: c.raw || '', passes: c.passes || [], isTest: !!c.isTest };
    });
  },

  _snapshot() {
    this._undo.push(JSON.stringify(this.activeEdit().items));
    if (this._undo.length > this._undoMax) this._undo.shift();
    this._redo = [];
  },

  _commit(reason) {
    this._materialize();
    K.project.saveSoon();
    K.bus.emit('frames:changed', { reason });
  },

  undo() {
    if (!this._undo.length) { K.toast('Nothing to undo'); return; }
    const ed = this.activeEdit();
    this._redo.push(JSON.stringify(ed.items));
    ed.items = JSON.parse(this._undo.pop());
    this._commit('undo');
  },

  redo() {
    if (!this._redo.length) { K.toast('Nothing to redo'); return; }
    const ed = this.activeEdit();
    this._undo.push(JSON.stringify(ed.items));
    ed.items = JSON.parse(this._redo.pop());
    this._commit('redo');
  },

  count() { return this.list.length; },
  totalExposures() { return this.list.reduce((n, f) => n + (f.hold || 1), 0); },

  expanded() {
    const out = [];
    this.list.forEach((f, i) => {
      for (let k = 0; k < (f.hold || 1); k++) out.push(i);
    });
    return out;
  },

  exposureOf(frameIdx) {
    let n = 0;
    for (let i = 0; i < frameIdx && i < this.list.length; i++) n += this.list[i].hold || 1;
    return n;
  },

  async _makeThumb(blob, w, h) {
    const bmp = await createImageBitmap(blob);
    const tw = this._thumbW;
    const th = Math.max(1, Math.round(tw * (h / w)));
    const c = document.createElement('canvas');
    c.width = tw; c.height = th;
    c.getContext('2d').drawImage(bmp, 0, 0, tw, th);
    bmp.close();
    const tblob = await K.canvasToBlob(c, 'image/jpeg', 0.72);
    return K.blobToDataURL(tblob);
  },

  /* Shoot/import: always creates a capture; test shots stay bin-only. */
  async add({ blob, w, h }, { hold = 1, atIndex = null, note = '', isTest = false, insert = true } = {}) {
    const id = K.uid();
    const thumb = await this._makeThumb(blob, w, h);
    const rec = {
      id, projectId: K.project.current.id, blob, thumb, w, h,
      shotHold: hold, note, raw: '', passes: [], isTest: !!isTest, capturedAt: Date.now(),
    };
    await K.db.put('frames', rec);
    this.captures.push({ id, w, h, thumb, note, raw: '', passes: [], shotHold: hold, isTest: !!isTest, capturedAt: rec.capturedAt });
    if (insert) {
      this._snapshot();
      const items = this.activeEdit().items;
      const item = { id, hold };
      if (atIndex === null || atIndex >= items.length) items.push(item);
      else items.splice(Math.max(0, atIndex), 0, item);
      this._commit('add');
    } else {
      K.project.saveSoon();
      K.bus.emit('captures:changed', { reason: 'add-bin', id, isTest: !!isTest });
    }
    return { id, hold, note, w, h, thumb, isTest: !!isTest };
  },

  async getBlob(id) {
    const rec = await K.db.get('frames', id);
    return rec ? rec.blob : null;
  },

  async getBitmap(id) {
    if (this._bitmaps.has(id)) {
      const b = this._bitmaps.get(id);
      this._bitmaps.delete(id);
      this._bitmaps.set(id, b);
      return b;
    }
    const blob = await this.getBlob(id);
    if (!blob) return null;
    const bmp = await createImageBitmap(blob);
    this._bitmaps.set(id, bmp);
    while (this._bitmaps.size > this._bitmapMax) {
      const [oldId, oldBmp] = this._bitmaps.entries().next().value;
      this._bitmaps.delete(oldId);
      oldBmp.close();
    }
    return bmp;
  },

  /* Remove from the EDIT only — the capture stays in the bin (non-destructive). */
  remove(idx) {
    const items = this.activeEdit().items;
    if (!items[idx]) return;
    this._snapshot();
    items.splice(idx, 1);
    this._commit('remove');
  },

  /* Duplicate = a second reference to the same capture (no blob copy). */
  duplicate(idx) {
    const items = this.activeEdit().items;
    const it = items[idx];
    if (!it) return;
    this._snapshot();
    items.splice(idx + 1, 0, { id: it.id, hold: it.hold });
    this._commit('duplicate');
  },

  /* Insert an existing capture from the bin into the active edit. */
  insertCapture(captureId, atIndex = null) {
    const c = this.captureOf(captureId);
    if (!c) return;
    this._snapshot();
    const items = this.activeEdit().items;
    const item = { id: captureId, hold: c.shotHold || 1 };
    if (atIndex === null || atIndex >= items.length) items.push(item);
    else items.splice(Math.max(0, atIndex), 0, item);
    this._commit('insert');
  },

  move(from, to) {
    const items = this.activeEdit().items;
    if (from === to || from < 0 || from >= items.length) return;
    this._snapshot();
    const [it] = items.splice(from, 1);
    items.splice(K.clamp(to, 0, items.length), 0, it);
    this._commit('move');
  },

  setHold(idx, hold) {
    const items = this.activeEdit().items;
    if (!items[idx]) return;
    const v = K.clamp(Math.round(hold), 1, 99);
    if (items[idx].hold === v) return;
    this._snapshot();
    items[idx].hold = v;
    this._commit('hold');
  },

  /* Notes live on the capture (shared by all references and all edits). */
  async setNote(idx, note) {
    const f = this.list[idx];
    if (!f) return;
    const c = this.captureOf(f.id);
    if (c) c.note = note;
    const rec = await K.db.get('frames', f.id);
    if (rec) { rec.note = note; await K.db.put('frames', rec); }
    this._materialize();
    K.project.saveSoon();
    K.bus.emit('frames:noted', { idx, note });
  },

  /* Attach RAW/original file name(s) captured by the tether agent. */
  async setRaw(captureId, rawNames) {
    const c = this.captureOf(captureId);
    if (!c) return;
    c.raw = rawNames;
    const rec = await K.db.get('frames', captureId);
    if (rec) { rec.raw = rawNames; await K.db.put('frames', rec); }
    this._materialize();
    K.project.saveSoon();
    K.bus.emit('frames:changed', { reason: 'raw' });
  },

  /* Attach named sub-exposures and their original files to one capture. */
  async setPasses(captureId, passes) {
    const c = this.captureOf(captureId);
    if (!c) return;
    const clean = (passes || []).map((pass) => ({
      name: String(pass.name || ''),
      overrides: { ...(pass.overrides || {}) },
      files: [...(pass.files || [])],
    }));
    const raw = clean.flatMap((pass) => pass.files).join(';');
    c.passes = clean;
    c.raw = raw;
    const rec = await K.db.get('frames', captureId);
    if (rec) { rec.passes = clean; rec.raw = raw; await K.db.put('frames', rec); }
    this._materialize();
    K.project.saveSoon();
    K.bus.emit('frames:changed', { reason: 'passes' });
  },

  /* Replace a capture's image (e.g. with the camera's own JPEG from tether). */
  async updateCaptureBlob(captureId, blob) {
    const c = this.captureOf(captureId);
    if (!c) return;
    const bmp = await createImageBitmap(blob);
    const w = bmp.width, h = bmp.height;
    bmp.close();
    const thumb = await this._makeThumb(blob, w, h);
    const rec = await K.db.get('frames', captureId);
    if (rec) {
      rec.blob = blob; rec.w = w; rec.h = h; rec.thumb = thumb;
      await K.db.put('frames', rec);
    }
    c.w = w; c.h = h; c.thumb = thumb;
    if (K.localFolder) K.localFolder.writeCapture({ id: captureId, blob, isTest: !!c.isTest, variant: 'camera' }).catch((error) => {
      console.warn('Local camera JPEG mirror:', error.message);
    });
    if (this._bitmaps.has(captureId)) { this._bitmaps.get(captureId).close(); this._bitmaps.delete(captureId); }
    this._materialize();
    K.viewport._refreshAsync();
    K.bus.emit('frames:changed', { reason: 'blob' });
  },

  reverse() {
    this._snapshot();
    this.activeEdit().items.reverse();
    this._commit('reverse');
  },

  pingPong() {
    const items = this.activeEdit().items;
    if (items.length < 2) return;
    this._snapshot();
    const back = items.slice(0, -1).reverse().map((it) => ({ id: it.id, hold: it.hold }));
    items.push(...back);
    this._commit('pingpong');
  },

  async addBlack(atIndex = null) {
    const last = this.list[this.list.length - 1];
    const w = last ? last.w : 1920, h = last ? last.h : 1080;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    const blob = await K.canvasToBlob(c, 'image/jpeg', 0.9);
    await this.add({ blob, w, h }, { atIndex });
  },

  /* ---------- edits (alt versions) ---------- */
  newAltEdit(name) {
    const src = this.activeEdit();
    const ed = {
      id: 'e_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      name: name || 'Alt ' + this.edits.length,
      items: JSON.parse(JSON.stringify(src.items)),
    };
    this.edits.push(ed);
    this.switchEdit(ed.id);
    K.bus.emit('edits:changed', {});
    return ed;
  },

  switchEdit(id) {
    if (!this.edits.some((e) => e.id === id)) return;
    this.activeEditId = id;
    this._undo = [];
    this._redo = [];
    this._commit('switch-edit');
    K.bus.emit('edits:changed', {});
  },

  renameEdit(id, name) {
    const ed = this.edits.find((e) => e.id === id);
    if (ed) { ed.name = name; K.project.saveSoon(); K.bus.emit('edits:changed', {}); }
  },

  deleteEdit(id) {
    if (this.edits.length <= 1) { K.toast('Cannot delete the last edit'); return; }
    const i = this.edits.findIndex((e) => e.id === id);
    if (i < 0) return;
    this.edits.splice(i, 1);
    if (this.activeEditId === id) this.switchEdit(this.edits[0].id);
    else { K.project.saveSoon(); K.bus.emit('edits:changed', {}); }
  },

  /* Rebuild the take as shot: test captures remain in the bin. */
  resetAsShot() {
    this._snapshot();
    this.activeEdit().items = this.captures.filter((c) => !c.isTest)
      .map((c) => ({ id: c.id, hold: c.shotHold || 1 }));
    this._commit('as-shot');
  },

  /* capture ids referenced by no edit at all */
  unusedCaptureIds() {
    const used = new Set();
    for (const ed of this.edits) for (const it of ed.items) used.add(it.id);
    return this.captures.filter((c) => !used.has(c.id)).map((c) => c.id);
  },

  usedInActive(captureId) {
    return this.activeEdit().items.some((it) => it.id === captureId);
  },

  async purgeUnused() {
    const ids = this.unusedCaptureIds();
    for (const id of ids) {
      await K.db.del('frames', id);
      if (this._bitmaps.has(id)) { this._bitmaps.get(id).close(); this._bitmaps.delete(id); }
      const i = this.captures.findIndex((c) => c.id === id);
      if (i >= 0) this.captures.splice(i, 1);
    }
    K.project.saveSoon();
    K.bus.emit('frames:changed', { reason: 'purge' });
    return ids.length;
  },

  /* Remove a capture that never completed (for example, a failed tether shot). */
  async discardFailedCapture(id) {
    if (!id) return;
    for (const edit of this.edits) edit.items = edit.items.filter((item) => item.id !== id);
    await K.db.del('frames', id).catch(() => {});
    if (this._bitmaps.has(id)) { this._bitmaps.get(id).close(); this._bitmaps.delete(id); }
    const index = this.captures.findIndex((capture) => capture.id === id);
    if (index >= 0) this.captures.splice(index, 1);
    this._commit('discard-failed');
  },

  size() {
    const f = this.list[0] || this.captures[0];
    return f ? { w: f.w, h: f.h } : null;
  },
};
