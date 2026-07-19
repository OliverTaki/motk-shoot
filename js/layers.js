/* MOTK Shoot — overlay layers: reference images, primitives, garbage masks.
 * Layers are GUIDES: drawn in the viewport (live + review), never exported.
 * Each layer has transform + opacity, optionally animated with keyframes
 * over exposures (linear interpolation between keys).
 *
 * layer = {id, name, type:'image'|'rect'|'ellipse'|'cross'|'mask',
 *          visible, behind, opacity, x, y, scale(%), rot(deg),
 *          w, h (shapes), color, fill, invert (mask), maskShape:'rect'|'ellipse',
 *          assetId (images), keys:[{exp, x, y, scale, rot, opacity}]}
 */
'use strict';
K.layers = {
  list: [],
  selectedId: null,
  _images: new Map(), // assetId -> ImageBitmap
  _videos: new Map(), // assetId -> {el,url}

  async reset(list) {
    this.list = list || [];
    this.selectedId = null;
    for (const b of this._images.values()) b.close();
    this._images.clear();
    for (const v of this._videos.values()) { v.el.pause(); URL.revokeObjectURL(v.url); }
    this._videos.clear();
    for (const l of this.list) {
      if (l.type === 'image' && l.assetId) await this._loadImage(l.assetId);
      if (l.type === 'video' && l.assetId) await this._loadVideo(l.assetId);
    }
    K.bus.emit('layers:changed', {});
  },

  async _loadVideo(assetId) {
    if (this._videos.has(assetId)) return this._videos.get(assetId).el;
    const rec = await K.db.get('assets', assetId);
    if (!rec) return null;
    const url = URL.createObjectURL(rec.blob);
    const el = document.createElement('video');
    el.src = url; el.muted = true; el.preload = 'auto'; el.playsInline = true;
    await new Promise((resolve) => { el.addEventListener('loadedmetadata', resolve, { once: true }); el.addEventListener('error', resolve, { once: true }); });
    this._videos.set(assetId, { el, url });
    return el;
  },

  async _loadImage(assetId) {
    if (this._images.has(assetId)) return this._images.get(assetId);
    const rec = await K.db.get('assets', assetId);
    if (!rec) return null;
    const bmp = await createImageBitmap(rec.blob);
    this._images.set(assetId, bmp);
    return bmp;
  },

  selected() { return this.list.find((l) => l.id === this.selectedId) || null; },

  _base(type, name) {
    return {
      id: 'l_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      name, type, visible: true, behind: false, opacity: type === 'mask' ? 0.9 : 0.6,
      x: 0, y: 0, scale: 100, rot: 0,
      w: 400, h: 300, color: type === 'mask' ? '#000000' : '#4da3ff',
      fill: type === 'mask', invert: false, maskShape: 'rect',
      assetId: null, keys: [],
      text: '', fontSize: 72, videoOffset: 0, points: [], lineWidth: 8,
    };
  },

  async addVideo(file, options = {}) {
    const assetId = 'a_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    await K.db.put('assets', { id: assetId, projectId: K.project.current.id, blob: file });
    const video = await this._loadVideo(assetId);
    const l = this._base('video', options.name || file.name.replace(/\.[^.]+$/, ''));
    l.assetId = assetId; l.opacity = options.opacity ?? 0.5;
    Object.assign(l, options, { assetId, type: 'video' });
    if (video?.videoWidth) { l.w = video.videoWidth; l.h = video.videoHeight; }
    this.list.push(l); this.select(l.id); this._save();
    return l;
  },

  addText() {
    const l = this._base('text', 'Text ' + (this.list.length + 1));
    l.text = 'Annotation'; l.opacity = 0.9; l.fill = true;
    this.list.push(l); this.select(l.id); this._save();
  },

  addPen() {
    const l = this._base('pen', 'Pen ' + (this.list.length + 1));
    l.points = []; l.opacity = 0.9;
    this.list.push(l); this.select(l.id); this._save();
  },

  addPenPoint(x, y, move = false) {
    const l = this.selected();
    if (!l || l.type !== 'pen') return;
    l.points.push({ x: Math.round(x - l.x), y: Math.round(y - l.y), move: !!move });
    K.viewport.invalidate();
  },

  async addImage(file, options = {}) {
    const assetId = 'a_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    await K.db.put('assets', { id: assetId, projectId: K.project.current.id, blob: file });
    const bmp = await this._loadImage(assetId);
    const l = this._base('image', options.name || file.name.replace(/\.\w+$/, ''));
    l.assetId = assetId;
    l.opacity = options.opacity ?? 0.5;
    Object.assign(l, options, { assetId, type: 'image' });
    if (bmp) { l.w = bmp.width; l.h = bmp.height; }
    this.list.push(l);
    this.select(l.id);
    this._save();
    return l;
  },

  addShape(type) {
    const names = { rect: 'Rect', ellipse: 'Ellipse', cross: 'Cross', mask: 'Mask' };
    const l = this._base(type === 'mask' ? 'mask' : type, names[type] + ' ' + (this.list.length + 1));
    if (type === 'cross') { l.w = 200; l.h = 200; l.opacity = 0.8; }
    this.list.push(l);
    this.select(l.id);
    this._save();
  },

  select(id) {
    this.selectedId = id;
    K.bus.emit('layers:changed', {});
    K.viewport.invalidate();
  },

  remove(id) {
    const i = this.list.findIndex((l) => l.id === id);
    if (i < 0) return;
    const l = this.list[i];
    if (l.assetId) {
      K.db.del('assets', l.assetId).catch(() => {});
      const bmp = this._images.get(l.assetId);
      if (bmp) { bmp.close(); this._images.delete(l.assetId); }
      const video = this._videos.get(l.assetId);
      if (video) { video.el.pause(); URL.revokeObjectURL(video.url); this._videos.delete(l.assetId); }
    }
    this.list.splice(i, 1);
    if (this.selectedId === id) this.selectedId = null;
    this._save();
  },

  moveLayer(id, dir) {
    const i = this.list.findIndex((l) => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= this.list.length) return;
    [this.list[i], this.list[j]] = [this.list[j], this.list[i]];
    this._save();
  },

  /* update selected layer's properties */
  update(props) {
    const l = this.selected();
    if (!l) return;
    Object.assign(l, props);
    this._save(false);
    K.viewport.invalidate();
  },

  nudge(dx, dy) {
    const l = this.selected();
    if (!l) return;
    l.x = Math.round(l.x + dx);
    l.y = Math.round(l.y + dy);
    K.project.saveSoon();
    K.viewport.invalidate();
    K.bus.emit('layers:nudged', {});
  },

  _save(emit = true) {
    K.project.saveSoon();
    if (emit) K.bus.emit('layers:changed', {});
    K.viewport.invalidate();
  },

  /* ---------- keyframes ---------- */
  setKey(exp) {
    const l = this.selected();
    if (!l) return;
    const key = { exp, x: l.x, y: l.y, scale: l.scale, rot: l.rot, opacity: l.opacity };
    const i = l.keys.findIndex((k) => k.exp === exp);
    if (i >= 0) l.keys[i] = key; else l.keys.push(key);
    l.keys.sort((a, b) => a.exp - b.exp);
    this._save();
  },

  removeKey(exp) {
    const l = this.selected();
    if (!l) return;
    l.keys = l.keys.filter((k) => k.exp !== exp);
    this._save();
  },

  clearKeys() {
    const l = this.selected();
    if (!l) return;
    l.keys = [];
    this._save();
  },

  /* evaluated properties at an exposure */
  propsAt(l, exp) {
    if (!l.keys || !l.keys.length) return l;
    const ks = l.keys;
    if (exp <= ks[0].exp) return ks[0];
    if (exp >= ks[ks.length - 1].exp) return ks[ks.length - 1];
    for (let i = 0; i < ks.length - 1; i++) {
      const a = ks[i], b = ks[i + 1];
      if (exp >= a.exp && exp < b.exp) {
        const t = (exp - a.exp) / (b.exp - a.exp);
        const mix = (p, q) => p + (q - p) * t;
        return {
          x: mix(a.x, b.x), y: mix(a.y, b.y), scale: mix(a.scale, b.scale),
          rot: mix(a.rot, b.rot), opacity: mix(a.opacity, b.opacity),
        };
      }
    }
    return l;
  },

  /* draw all layers of one plane ('front' | 'behind') at an exposure */
  render(ctx, w, h, exp, behind) {
    for (const l of this.list) {
      if (!l.visible || !!l.behind !== behind) continue;
      const p = this.propsAt(l, exp);
      ctx.save();
      ctx.globalAlpha = K.clamp(p.opacity !== undefined ? p.opacity : l.opacity, 0, 1);

      if (l.type === 'mask' && l.invert) {
        // cover everything EXCEPT the shape (evenodd: full rect minus transformed shape)
        const s = (p.scale !== undefined ? p.scale : l.scale) / 100;
        const m = new DOMMatrix()
          .translateSelf(w / 2 + p.x, h / 2 + p.y)
          .rotateSelf(0, 0, p.rot || 0)
          .scaleSelf(s, s);
        const shape = new Path2D();
        if (l.maskShape === 'ellipse') shape.ellipse(0, 0, l.w / 2, l.h / 2, 0, 0, Math.PI * 2);
        else shape.rect(-l.w / 2, -l.h / 2, l.w, l.h);
        const full = new Path2D();
        full.rect(0, 0, w, h);
        full.addPath(shape, m);
        ctx.fillStyle = l.color;
        ctx.fill(full, 'evenodd');
        ctx.restore();
        if (l.id === this.selectedId) this._outline(ctx, l, p, w, h);
        continue;
      }

      ctx.translate(w / 2 + p.x, h / 2 + p.y);
      ctx.rotate((p.rot || 0) * Math.PI / 180);
      const s = (p.scale !== undefined ? p.scale : l.scale) / 100;
      ctx.scale(s, s);

      if (l.type === 'image') {
        const bmp = this._images.get(l.assetId);
        if (bmp) ctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
      } else if (l.type === 'video') {
        const video = this._videos.get(l.assetId)?.el;
        if (video) {
          const target = Math.max(0, (exp - (l.videoOffset || 0)) / Math.max(1, K.project.current.fps));
          if (Number.isFinite(video.duration)) video.currentTime = Math.min(target, Math.max(0, video.duration - 0.001));
          if (video.readyState >= 2) ctx.drawImage(video, -l.w / 2, -l.h / 2, l.w, l.h);
        }
      } else if (l.type === 'text') {
        ctx.fillStyle = l.color; ctx.font = `600 ${Math.max(6, l.fontSize || 72)}px system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        String(l.text || '').split('\n').forEach((line, i, lines) => ctx.fillText(line, 0, (i - (lines.length - 1) / 2) * (l.fontSize || 72) * 1.15));
      } else if (l.type === 'pen') {
        ctx.strokeStyle = l.color; ctx.lineWidth = Math.max(1, l.lineWidth || 8); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath();
        for (const point of l.points || []) { if (point.move) ctx.moveTo(point.x, point.y); else ctx.lineTo(point.x, point.y); }
        ctx.stroke();
      } else if (l.type === 'rect' || (l.type === 'mask' && l.maskShape === 'rect')) {
        this._paintShape(ctx, l, () => ctx.rect(-l.w / 2, -l.h / 2, l.w, l.h));
      } else if (l.type === 'ellipse' || (l.type === 'mask' && l.maskShape === 'ellipse')) {
        this._paintShape(ctx, l, () => ctx.ellipse(0, 0, l.w / 2, l.h / 2, 0, 0, Math.PI * 2));
      } else if (l.type === 'cross') {
        ctx.strokeStyle = l.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-l.w / 2, 0); ctx.lineTo(l.w / 2, 0);
        ctx.moveTo(0, -l.h / 2); ctx.lineTo(0, l.h / 2);
        ctx.stroke();
      }
      ctx.restore();
      if (l.id === this.selectedId) this._outline(ctx, l, p, w, h);
    }
  },

  _paintShape(ctx, l, path) {
    ctx.beginPath();
    path();
    if (l.fill || l.type === 'mask') { ctx.fillStyle = l.color; ctx.fill(); }
    else { ctx.strokeStyle = l.color; ctx.lineWidth = 3; ctx.stroke(); }
  },

  _outline(ctx, l, p, w, h) {
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = '#4da3ff';
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 2;
    ctx.translate(w / 2 + p.x, h / 2 + p.y);
    ctx.rotate((p.rot || 0) * Math.PI / 180);
    const s = (p.scale !== undefined ? p.scale : l.scale) / 100;
    ctx.scale(s, s);
    const bw = l.type === 'image' ? (this._images.get(l.assetId) || { width: l.w }).width : l.w;
    const bh = l.type === 'image' ? (this._images.get(l.assetId) || { height: l.h }).height : l.h;
    ctx.strokeRect(-bw / 2, -bh / 2, bw, bh);
    ctx.restore();
  },

  /* serializable copy for project storage */
  serialize() {
    return this.list.map((l) => ({ ...l }));
  },
};
