/* MOTK Shoot — multi-track audio, waveform, sync playback, and scrub. */
'use strict';
K.audio = {
  ctx: null,
  tracks: [],
  selectedId: '',
  enabled: true,
  scrub: true,
  _waveBase: null,
  _scrubSources: [],
  _scheduled: [],

  selected() { return this.tracks.find((t) => t.id === this.selectedId) || this.tracks[0] || null; },
  get buffer() { return this.selected()?.buffer || null; },
  get el() { return this.selected()?.el || null; },
  get name() { return this.selected()?.name || ''; },
  get offsetFrames() { return this.selected()?.offsetFrames || 0; },
  set offsetFrames(value) { const t = this.selected(); if (t) { t.offsetFrames = parseInt(value, 10) || 0; this._changed(); } },
  get volume() { return this.selected()?.volume ?? 1; },
  hasAudio() { return this.tracks.length > 0; },

  async _context() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    return this.ctx;
  },

  async _runtime(def) {
    const ctx = await this._context();
    const arr = await def.blob.arrayBuffer();
    const buffer = await ctx.decodeAudioData(arr.slice(0));
    const url = URL.createObjectURL(def.blob);
    const el = new Audio(url);
    el.volume = def.muted ? 0 : def.volume;
    return { ...def, buffer, el, url };
  },

  async load(blob, name, options = {}) {
    const def = {
      id: options.id || ('at_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)),
      name: name || 'audio', blob, offsetFrames: parseInt(options.offsetFrames, 10) || 0,
      volume: options.volume === undefined ? 1 : K.clamp(+options.volume, 0, 1),
      muted: !!options.muted,
    };
    const track = await this._runtime(def);
    this.tracks.push(track); this.selectedId = track.id;
    await this.persist();
    K.bus.emit('audio:loaded', { name: track.name, duration: track.buffer.duration, tracks: this.tracks.length });
    K.bus.emit('audio:changed', {});
    return track;
  },

  async restore(projectId) {
    const rec = await K.db.get('audio', projectId);
    if (!rec) return false;
    this.clear(false);
    const defs = Array.isArray(rec.tracks) ? rec.tracks : rec.blob ? [{
      id: 'at_legacy', name: rec.name || 'audio', blob: rec.blob,
      offsetFrames: K.project.current?.audioOffset || 0, volume: 1, muted: false,
    }] : [];
    for (const def of defs) this.tracks.push(await this._runtime(def));
    this.selectedId = rec.selectedId && this.tracks.some((t) => t.id === rec.selectedId) ? rec.selectedId : this.tracks[0]?.id || '';
    this._waveBase = null;
    if (this.tracks.length) K.bus.emit('audio:loaded', { name: this.name, duration: this.buffer.duration, tracks: this.tracks.length });
    K.bus.emit('audio:changed', {});
    return !!this.tracks.length;
  },

  async persist() {
    if (!K.project.current) return;
    await K.db.put('audio', {
      projectId: K.project.current.id, selectedId: this.selectedId,
      tracks: this.tracks.map((t) => ({ id: t.id, name: t.name, blob: t.blob, offsetFrames: t.offsetFrames, volume: t.volume, muted: t.muted })),
    });
    K.project.current.audioName = this.name;
    K.project.saveSoon();
  },

  _dispose(track) { if (track.el) track.el.pause(); if (track.url) URL.revokeObjectURL(track.url); },
  clear(persist = true) {
    this.stopPlayback();
    this.tracks.forEach((t) => this._dispose(t));
    this.tracks = []; this.selectedId = ''; this._waveBase = null;
    if (persist && K.project.current) { K.db.del('audio', K.project.current.id).catch(() => {}); K.project.current.audioName = ''; K.project.saveSoon(); }
    K.bus.emit('audio:cleared', {}); K.bus.emit('audio:changed', {});
  },

  async removeSelected() {
    const i = this.tracks.findIndex((t) => t.id === this.selectedId);
    if (i < 0) return;
    this._dispose(this.tracks[i]); this.tracks.splice(i, 1);
    this.selectedId = this.tracks[Math.min(i, this.tracks.length - 1)]?.id || '';
    this._waveBase = null; await this.persist();
    if (!this.tracks.length) K.bus.emit('audio:cleared', {});
    K.bus.emit('audio:changed', {});
  },

  select(id) { if (this.tracks.some((t) => t.id === id)) { this.selectedId = id; this._waveBase = null; K.bus.emit('audio:changed', {}); } },
  setVolume(value) { const t = this.selected(); if (!t) return; t.volume = K.clamp(+value, 0, 1); t.el.volume = t.muted ? 0 : t.volume; this._changed(); },
  setMuted(value) { const t = this.selected(); if (!t) return; t.muted = !!value; t.el.volume = t.muted ? 0 : t.volume; this._changed(); },
  _changed() { this._waveBase = null; this.persist().catch(() => {}); K.bus.emit('audio:changed', {}); },

  timeAtExposure(expIdx, fps, track = this.selected()) { return track ? (expIdx - track.offsetFrames) / fps : 0; },
  startPlayback(expIdx, fps, speed = 1) {
    if (!this.enabled) return;
    this.stopPlayback();
    for (const track of this.tracks) {
      if (track.muted) continue;
      const t = this.timeAtExposure(expIdx, fps, track);
      track.el.playbackRate = speed;
      if (t >= 0 && t < track.el.duration) { track.el.currentTime = t; track.el.play().catch(() => {}); }
      else if (t < 0) {
        track.el.currentTime = 0;
        const timer = setTimeout(() => { if (K.playback.playing) track.el.play().catch(() => {}); }, (-t / speed) * 1000);
        this._scheduled.push(timer);
      }
    }
  },
  stopPlayback() { this._scheduled.forEach(clearTimeout); this._scheduled = []; this.tracks.forEach((t) => t.el?.pause()); },

  playSlice(expIdx, fps) {
    if (!this.scrub || !this.tracks.length || !this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this._scrubSources.forEach((s) => { try { s.stop(); } catch {} }); this._scrubSources = [];
    for (const track of this.tracks) {
      if (track.muted) continue;
      const t = this.timeAtExposure(expIdx, fps, track);
      if (t < 0 || t >= track.buffer.duration) continue;
      const src = this.ctx.createBufferSource(); src.buffer = track.buffer;
      const gain = this.ctx.createGain(); gain.gain.value = track.volume;
      src.connect(gain).connect(this.ctx.destination); src.start(0, t, Math.max(1 / fps, 0.045)); this._scrubSources.push(src);
    }
  },

  connectExport(dest, fps, startTime) {
    const nodes = [];
    for (const track of this.tracks) {
      if (track.muted) continue;
      const src = this.ctx.createBufferSource(); src.buffer = track.buffer;
      const gain = this.ctx.createGain(); gain.gain.value = track.volume; src.connect(gain).connect(dest);
      const off = track.offsetFrames / fps;
      if (off >= 0) src.start(startTime + off);
      else if (-off < track.buffer.duration) src.start(startTime, -off);
      else continue;
      nodes.push(src);
    }
    return nodes;
  },

  _trackPeaks(track, width) {
    const data = track.buffer.getChannelData(0), step = Math.max(1, Math.floor(data.length / width)), peaks = new Float32Array(width);
    for (let x = 0; x < width; x++) { let max = 0; for (let i = x * step; i < Math.min((x + 1) * step, data.length); i += 4) max = Math.max(max, Math.abs(data[i])); peaks[x] = max; }
    return peaks;
  },

  drawWave(canvas, curExposure, fps, totalExposures) {
    if (!this.tracks.length) return;
    const w = Math.max(1, Math.round(canvas.clientWidth * devicePixelRatio)), h = Math.max(1, Math.round(canvas.clientHeight * devicePixelRatio));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#191d24'; ctx.fillRect(0, 0, w, h);
    const span = Math.max(totalExposures, ...this.tracks.map((t) => t.buffer.duration * fps + t.offsetFrames), 1);
    const colors = ['#4da3ff', '#3ecf8e', '#c69cff', '#ffc857', '#ff7b6b'];
    this.tracks.forEach((track, ti) => {
      const x0 = track.offsetFrames / span * w, x1 = (track.buffer.duration * fps + track.offsetFrames) / span * w;
      const peaks = this._trackPeaks(track, Math.max(1, Math.round(x1 - x0)));
      ctx.fillStyle = track.muted ? '#49505b' : colors[ti % colors.length];
      const band = h / this.tracks.length, mid = band * (ti + .5);
      for (let x = 0; x < peaks.length; x++) { const amp = Math.max(1, peaks[x] * band * .45); ctx.fillRect(x0 + x, mid - amp, 1, amp * 2); }
    });
    ctx.fillStyle = '#ff5f45'; ctx.fillRect(curExposure / span * w - 1, 0, 2, h);
    ctx.fillStyle = 'rgba(62,207,142,.7)'; ctx.fillRect(0, h - 3, totalExposures / span * w, 3);
    canvas._span = span;
  },
};
