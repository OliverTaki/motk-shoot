/* MOTK Shoot — edit/take A/B review overlay. */
'use strict';
K.review = {
  mode: 'off',
  target: '',
  showB: false,
  bitmap: null,
  _key: '',
  _loading: false,

  set({ mode = this.mode, target = this.target, showB = this.showB } = {}) {
    this.mode = mode; this.target = target; this.showB = showB; this._key = '';
    K.viewport.invalidate();
  },

  async _frameId(exp) {
    if (!this.target) return null;
    const [kind, id] = this.target.split(':');
    if (kind === 'edit') {
      const edit = K.frames.edits.find((item) => item.id === id);
      if (!edit) return null;
      const expanded = edit.items.flatMap((item) => Array(Math.max(1, item.hold || 1)).fill(item.id));
      return { id: expanded[Math.min(exp, Math.max(0, expanded.length - 1))], local: true };
    }
    if (kind === 'project') {
      const project = await K.db.get('projects', id); if (!project) return null;
      const edit = (project.edits || []).find((item) => item.id === project.activeEditId) || project.edits?.[0];
      const expanded = (edit?.items || []).flatMap((item) => Array(Math.max(1, item.hold || 1)).fill(item.id));
      return { id: expanded[Math.min(exp, Math.max(0, expanded.length - 1))], local: false };
    }
    return null;
  },

  async request(exp) {
    if (this.mode === 'off' || !this.target || this._loading) return;
    const key = `${this.target}:${exp}`; if (key === this._key) return;
    this._loading = true;
    try {
      const frame = await this._frameId(exp); if (!frame?.id) return;
      const bitmap = frame.local ? await K.frames.getBitmap(frame.id) : await K.db.get('frames', frame.id).then((rec) => rec ? createImageBitmap(rec.blob) : null);
      if (!bitmap) return;
      if (this.bitmap && this.bitmap !== bitmap && !frame.local) this.bitmap.close();
      this.bitmap = bitmap; this._key = key; K.viewport.invalidate();
    } finally { this._loading = false; }
  },

  render(ctx, w, h, exp) {
    if (this.mode === 'off' || !this.target) return;
    this.request(exp).catch((e) => console.warn('Compare:', e.message));
    if (!this.bitmap) return;
    if (this.mode === 'split') {
      ctx.save(); ctx.beginPath(); ctx.rect(w / 2, 0, w / 2, h); ctx.clip(); ctx.drawImage(this.bitmap, 0, 0, w, h); ctx.restore();
      ctx.save(); ctx.strokeStyle = '#ffc857'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke(); ctx.restore();
    } else if (this.mode === 'ab' && this.showB) ctx.drawImage(this.bitmap, 0, 0, w, h);
  },
};
