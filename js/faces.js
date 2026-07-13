/* MOTK Shoot — X-Sheet phoneme face-set monitor overlay. */
'use strict';
K.faces = {
  TOKENS: ['A', 'E', 'I', 'O', 'U', 'MBP', 'FV', 'L', 'WQ', 'REST'],
  settings: { enabled: false, x: 0, y: 220, scale: 100, assets: {} },
  _images: new Map(),
  _generic: new Map(),

  async apply(settings = {}) {
    Object.assign(this.settings, settings || {});
    for (const bitmap of this._images.values()) bitmap.close();
    this._images.clear();
    for (const [token, assetId] of Object.entries(this.settings.assets || {})) {
      const rec = await K.db.get('assets', assetId).catch(() => null);
      if (rec) this._images.set(token, await createImageBitmap(rec.blob));
    }
    K.viewport?.invalidate();
  },

  token(note) {
    const text = String(note || '').trim().toUpperCase();
    if (!text) return 'REST';
    const first = text.match(/\b(MBP|FV|WQ|REST|A|E|I|O|U|L)\b/);
    return first ? first[1] : 'REST';
  },

  async loadFiles(files) {
    const assets = { ...(this.settings.assets || {}) };
    for (const file of files) {
      const base = file.name.replace(/\.[^.]+$/, '').toUpperCase();
      const token = this.TOKENS.find((name) => base === name || base.startsWith(name + '_'));
      if (!token) continue;
      const id = 'face_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      await K.db.put('assets', { id, projectId: K.project.current.id, blob: file }); assets[token] = id;
    }
    this.settings.assets = assets; await this.apply(this.settings); K.project.saveSoon();
  },

  useGeneric() {
    this.settings.assets = {};
    for (const bitmap of this._images.values()) bitmap.close();
    this._images.clear(); K.project.saveSoon(); K.viewport.invalidate();
  },

  _genericCanvas(token) {
    if (this._generic.has(token)) return this._generic.get(token);
    const canvas = document.createElement('canvas'); canvas.width = 260; canvas.height = 180;
    const ctx = canvas.getContext('2d'); ctx.translate(130, 90);
    ctx.fillStyle = 'rgba(20,23,28,.88)'; ctx.strokeStyle = '#ffc857'; ctx.lineWidth = 7;
    ctx.beginPath();
    const shapes = { REST:[80,12], A:[62,60], E:[90,30], I:[48,52], O:[48,66], U:[60,48], MBP:[92,7], FV:[86,20], L:[72,42], WQ:[38,54] };
    const [rx, ry] = shapes[token] || shapes.REST;
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (token === 'L') { ctx.fillStyle = '#ff8f8f'; ctx.fillRect(-18, -4, 36, 44); }
    if (token === 'FV') { ctx.fillStyle = '#f4f1e8'; ctx.fillRect(-70, -14, 140, 13); }
    ctx.setTransform(1,0,0,1,0,0); ctx.fillStyle = '#fff'; ctx.font = '700 20px ui-monospace'; ctx.fillText(token, 10, 26);
    this._generic.set(token, canvas); return canvas;
  },

  render(ctx, w, h, exp) {
    if (!this.settings.enabled) return;
    const expanded = K.frames.expanded();
    const frame = K.frames.list[expanded[Math.min(exp, Math.max(0, expanded.length - 1))]];
    const token = this.token(frame?.note);
    const image = this._images.get(token) || this._genericCanvas(token);
    if (!image) return;
    const scale = K.clamp(+this.settings.scale || 100, 10, 500) / 100;
    const iw = image.width * scale, ih = image.height * scale;
    ctx.save(); ctx.globalAlpha = .9;
    ctx.drawImage(image, w / 2 + (+this.settings.x || 0) - iw / 2, h / 2 + (+this.settings.y || 0) - ih / 2, iw, ih);
    ctx.restore();
  },
};
