/* MOTK Shoot — viewport: composites live video / frames / onion skin / guides onto the main canvas */
'use strict';
K.viewport = {
  canvas: null,
  ctx: null,
  mode: 'live',        // 'live' | 'review'
  reviewIdx: -1,       // frame index shown in review mode
  reviewExp: 0,        // exposure (koma) index — the selection unit
  playBitmap: null,    // bitmap forced by playback engine
  playExp: null,       // exposure during playback (for layer keyframes)
  playing: false,
  popThrough: false,

  zoom: 1,
  panX: 0, panY: 0,    // in content pixels
  _dragging: false,
  _dragStart: null,

  onion: { on: true, frames: 1, alpha: 0.35, mode: 'normal', next: false, offsetX: 0, offsetY: 0 },
  guides: { grid: 'off', cross: false, safe: false, mask: 'off', maskAlpha: 0.7 },

  _reviewBitmap: null,
  _reviewBitmapIdx: -1,
  _onionBitmaps: [],   // [{bmp, depth}]
  _dirty: true,

  init() {
    this.canvas = K.$('#viewport');
    this.ctx = this.canvas.getContext('2d');
    const wrap = K.$('#viewportWrap');
    const size = () => {
      const w = Math.max(1, wrap.clientWidth * devicePixelRatio);
      const h = Math.max(1, wrap.clientHeight * devicePixelRatio);
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
        this.invalidate();
      }
    };
    size();
    new ResizeObserver(size).observe(wrap);
    window.addEventListener('resize', size);
    document.addEventListener('visibilitychange', size);

    /* zoom & pan */
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
      this.zoom = K.clamp(this.zoom * factor, 1, 10);
      if (this.zoom === 1) { this.panX = 0; this.panY = 0; }
      this._updateZoomBadge();
      this.invalidate();
    }, { passive: false });

    this.canvas.addEventListener('pointerdown', (e) => {
      // layer drag takes priority while the LAYER tab is open with a selection
      const layerTab = document.querySelector('#sideTabs button[data-tab="layers"]');
      if (layerTab && layerTab.classList.contains('active') && K.layers.selected()) {
        const l = K.layers.selected();
        if (l.type === 'pen') {
          const p = this._contentPoint(e);
          this._dragging = 'pen'; this._dragStart = p;
          K.layers.addPenPoint(p.x, p.y, true);
          this.canvas.setPointerCapture(e.pointerId);
          return;
        }
        this._dragging = 'layer';
        this._dragStart = { x: e.clientX, y: e.clientY, lx: l.x, ly: l.y };
        this.canvas.setPointerCapture(e.pointerId);
        return;
      }
      if (this.zoom <= 1) return;
      this._dragging = 'pan';
      this._dragStart = { x: e.clientX, y: e.clientY, panX: this.panX, panY: this.panY };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this._dragging) return;
      const s = this._dragStart;
      const k = devicePixelRatio / (this._fitScale() * this.zoom);
      if (this._dragging === 'layer') {
        const l = K.layers.selected();
        if (l) {
          l.x = Math.round(s.lx + (e.clientX - s.x) * k);
          l.y = Math.round(s.ly + (e.clientY - s.y) * k);
          K.bus.emit('layers:nudged', {});
          this.invalidate();
        }
        return;
      }
      if (this._dragging === 'pen') {
        const p = this._contentPoint(e); K.layers.addPenPoint(p.x, p.y, false); return;
      }
      this.panX = s.panX + (e.clientX - s.x) * k;
      this.panY = s.panY + (e.clientY - s.y) * k;
      this.invalidate();
    });
    this.canvas.addEventListener('pointerup', () => {
      if (this._dragging === 'layer' || this._dragging === 'pen') K.project.saveSoon();
      this._dragging = false;
    });
    this.canvas.addEventListener('dblclick', () => {
      this.zoom = 1; this.panX = 0; this.panY = 0;
      this._updateZoomBadge();
      this.invalidate();
    });

    K.bus.on('frames:changed', () => { this._refreshAsync(); });
    K.bus.on('camera:started', () => { this.invalidate(); });
    K.bus.on('camera:stopped', () => { this.invalidate(); });

    requestAnimationFrame(() => this._loop());
  },

  _contentPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * devicePixelRatio;
    const cy = (e.clientY - rect.top) * devicePixelRatio;
    const { w, h } = this.contentSize();
    const scale = this._fitScale() * this.zoom;
    return { x: (cx - this.canvas.width / 2) / scale - this.panX + w / 2, y: (cy - this.canvas.height / 2) / scale - this.panY + h / 2 };
  },

  _updateZoomBadge() {
    const b = K.$('#badgeZoom');
    if (this.zoom > 1.001) {
      b.textContent = this.zoom.toFixed(1) + '×';
      b.classList.remove('hidden');
    } else b.classList.add('hidden');
  },

  invalidate() { this._dirty = true; },

  async setPopThrough(on) {
    this.popThrough = !!on;
    if (on && this.mode === 'live' && K.frames.count()) {
      const index = this.reviewIdx >= 0 ? this.reviewIdx : K.frames.count() - 1;
      const frame = K.frames.list[index];
      if (frame) this._reviewBitmap = await K.frames.getBitmap(frame.id);
    }
    this.invalidate();
    K.bus.emit('popthrough:changed', { on: this.popThrough });
  },

  setMode(mode, reviewIdx = null) {
    this.mode = mode;
    if (reviewIdx !== null) {
      this.reviewIdx = K.clamp(reviewIdx, 0, Math.max(0, K.frames.count() - 1));
      this.reviewExp = K.frames.exposureOf(this.reviewIdx);
    }
    this._refreshAsync();
    K.bus.emit('mode:changed', { mode: this.mode, reviewIdx: this.reviewIdx, reviewExp: this.reviewExp });
  },

  /* select by exposure (koma) — the finer selection unit */
  setExposure(expIdx) {
    const expanded = K.frames.expanded();
    if (!expanded.length) { this.setMode('live'); return; }
    this.reviewExp = K.clamp(expIdx, 0, expanded.length - 1);
    this.reviewIdx = expanded[this.reviewExp];
    this.mode = 'review';
    this._refreshAsync();
    K.bus.emit('mode:changed', { mode: this.mode, reviewIdx: this.reviewIdx, reviewExp: this.reviewExp });
  },

  /* exposure the viewport is showing right now (drives layer keyframes) */
  currentExposure() {
    if (this.playing && this.playExp !== null) return this.playExp;
    if (this.mode === 'review') return this.reviewExp;
    return K.frames.totalExposures(); // live = the next koma to be shot
  },

  /* async: fetch review + onion bitmaps then repaint */
  async _refreshAsync() {
    const fs = K.frames;
    if (this.mode === 'review') {
      this.reviewIdx = K.clamp(this.reviewIdx, 0, Math.max(0, fs.count() - 1));
      // keep the exposure cursor inside the selected frame's span after edits
      const f = fs.list[this.reviewIdx];
      const start = fs.exposureOf(this.reviewIdx);
      this.reviewExp = K.clamp(this.reviewExp, start, start + ((f && f.hold) || 1) - 1);
      if (f) {
        const idxWanted = this.reviewIdx;
        const bmp = await fs.getBitmap(f.id);
        if (idxWanted === this.reviewIdx) { this._reviewBitmap = bmp; this._reviewBitmapIdx = idxWanted; }
      } else { this._reviewBitmap = null; }
    }
    await this._refreshOnion();
    this.invalidate();
  },

  async _refreshOnion() {
    this._onionBitmaps = [];
    if (!this.onion.on || this.playing) return;
    const fs = K.frames;
    const anchor = this.mode === 'live' ? fs.count() : this.reviewIdx;
    for (let d = 1; d <= this.onion.frames; d++) {
      const f = fs.list[anchor - d];
      if (!f) break;
      const bmp = await fs.getBitmap(f.id);
      if (bmp) this._onionBitmaps.push({ bmp, depth: d, next: false });
    }
    if (this.onion.next && this.mode === 'review') {
      const f = fs.list[this.reviewIdx + 1];
      if (f) {
        const bmp = await fs.getBitmap(f.id);
        if (bmp) this._onionBitmaps.push({ bmp, depth: 1, next: true });
      }
    }
  },

  contentSize() {
    if (this.playing && this.playBitmap) return { w: this.playBitmap.width, h: this.playBitmap.height };
    if (this.mode === 'review' && this._reviewBitmap) return { w: this._reviewBitmap.width, h: this._reviewBitmap.height };
    const cam = K.camera;
    if (cam.running && cam.source === 'tether' && cam.tetherBitmap) return { w: cam.tetherBitmap.width, h: cam.tetherBitmap.height };
    if (cam.running && cam.video.videoWidth) return { w: cam.video.videoWidth, h: cam.video.videoHeight };
    const s = K.frames.size();
    return s || { w: 1920, h: 1080 };
  },

  _fitScale() {
    const { w, h } = this.contentSize();
    return Math.min(this.canvas.width / w, this.canvas.height / h);
  },

  _loop() {
    const liveActive = this.mode === 'live' && K.camera.running;
    if (liveActive || this.playing || this._dirty) {
      this._render();
      this._dirty = false;
    }
    requestAnimationFrame(() => this._loop());
  },

  _render() {
    const ctx = this.ctx;
    const cw = this.canvas.width, ch = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, ch);
    const { w, h } = this.contentSize();
    const fit = this._fitScale();
    const scale = fit * this.zoom;

    ctx.translate(cw / 2, ch / 2);
    ctx.scale(scale, scale);
    ctx.translate(this.panX - w / 2, this.panY - h / 2);
    ctx.imageSmoothingQuality = 'high';

    const cam = K.camera;
    const exp = this.currentExposure();
    const displayMode = this.popThrough ? (this.mode === 'live' ? 'review' : 'live') : this.mode;
    if (this.playing && this.playBitmap) {
      K.layers.render(ctx, w, h, exp, true);
      K.cine.drawSource(ctx, this.playBitmap, w, h);
      K.layers.render(ctx, w, h, exp, false);
      K.faces.render(ctx, w, h, exp);
    } else if (displayMode === 'live') {
      const liveSource = cam.source === 'tether' ? cam.tetherBitmap : cam.video;
      K.layers.render(ctx, w, h, exp, true);
      if (cam.running && liveSource && (cam.source === 'tether' || cam.video.videoWidth)) {
        ctx.save();
        ctx.translate(w / 2, h / 2);
        if (cam.rot180) ctx.rotate(Math.PI);
        ctx.scale(cam.mirrorH ? -1 : 1, cam.mirrorV ? -1 : 1);
        ctx.translate(-w / 2, -h / 2);
        K.cine.drawSource(ctx, liveSource, w, h);
        ctx.restore();
      }
      this._drawOnion(ctx, w, h);
      K.layers.render(ctx, w, h, exp, false);
      K.faces.render(ctx, w, h, exp);
    } else { // review
      K.layers.render(ctx, w, h, exp, true);
      if (this._reviewBitmap) K.cine.drawSource(ctx, this._reviewBitmap, w, h);
      this._drawOnion(ctx, w, h);
      K.layers.render(ctx, w, h, exp, false);
      K.faces.render(ctx, w, h, exp);
    }

    K.review.render(ctx, w, h, exp);

    if (!this.playing) this._drawGuides(ctx, w, h, scale);
    K.ecosystem?.publishViewport(this.canvas);
  },

  _drawOnion(ctx, w, h) {
    if (!this.onion.on || this.playing) return;
    for (const o of this._onionBitmaps) {
      ctx.save();
      ctx.globalAlpha = this.onion.alpha / o.depth;
      if (this.onion.mode === 'difference') ctx.globalCompositeOperation = 'difference';
      else if (o.next) {
        // tint next-frame ghosts slightly is overkill; just draw normally
      }
      ctx.drawImage(o.bmp, this.onion.offsetX || 0, this.onion.offsetY || 0, w, h);
      ctx.restore();
    }
  },

  _drawGuides(ctx, w, h, scale) {
    const g = this.guides;
    ctx.save();
    ctx.lineWidth = 1.2 / scale;
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';

    const lines = (fx) => {
      ctx.beginPath();
      for (const t of fx) {
        ctx.moveTo(w * t, 0); ctx.lineTo(w * t, h);
        ctx.moveTo(0, h * t); ctx.lineTo(w, h * t);
      }
      ctx.stroke();
    };
    if (g.grid === 'thirds') lines([1 / 3, 2 / 3]);
    else if (g.grid === 'quarters') lines([0.25, 0.5, 0.75]);
    else if (g.grid === 'golden') lines([0.382, 0.618]);

    if (g.cross) {
      const s = Math.min(w, h) * 0.04;
      ctx.beginPath();
      ctx.moveTo(w / 2 - s, h / 2); ctx.lineTo(w / 2 + s, h / 2);
      ctx.moveTo(w / 2, h / 2 - s); ctx.lineTo(w / 2, h / 2 + s);
      ctx.stroke();
    }
    if (g.safe) {
      ctx.strokeStyle = 'rgba(255,200,80,0.5)';
      for (const m of [0.9, 0.8]) {
        ctx.strokeRect(w * (1 - m) / 2, h * (1 - m) / 2, w * m, h * m);
      }
    }
    if (g.mask !== 'off') {
      const target = parseFloat(g.mask);
      const cur = w / h;
      ctx.fillStyle = `rgba(0,0,0,${g.maskAlpha})`;
      if (target < cur) { // pillarbox
        const mw = (w - h * target) / 2;
        ctx.fillRect(0, 0, mw, h);
        ctx.fillRect(w - mw, 0, mw, h);
      } else if (target > cur) { // letterbox
        const mh = (h - w / target) / 2;
        ctx.fillRect(0, 0, w, mh);
        ctx.fillRect(0, h - mh, w, mh);
      }
    }
    ctx.restore();
  },
};
