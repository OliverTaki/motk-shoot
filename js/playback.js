/* MOTK Shoot — playback engine: real-time preview with holds, loop, ping-pong, short play, audio sync */
'use strict';
K.playback = {
  playing: false,
  loop: false,
  speed: 1,
  inPoint: null,
  outPoint: null,
  shortFrames: 0,     // when >0 only play the last N exposures then return to live
  _expanded: [],      // exposure list: frame indices
  _startExp: 0,
  _t0: 0,
  _timer: 0,
  _lastDrawnExp: -1,
  _returnMode: 'live',

  toggle(opts = {}) {
    if (this.playing) this.stop();
    else this.play(opts);
  },

  async play({ short = false, fromStart = null } = {}) {
    const fs = K.frames;
    if (fs.count() === 0) { K.toast('No frames to play'); return; }
    this._expanded = fs.expanded();
    const total = this._expanded.length;
    const fps = K.project.current.fps;
    const rangeStart = this.inPoint === null ? 0 : K.clamp(this.inPoint, 0, total - 1);
    const rangeEnd = this.outPoint === null ? total - 1 : K.clamp(this.outPoint, rangeStart, total - 1);

    let start = 0;
    if (short) {
      const n = Math.max(Math.round(fps * 1.5), 4); // last ~1.5 seconds
      start = Math.max(rangeStart, rangeEnd - n + 1);
    } else if (fromStart === false && K.viewport.mode === 'review') {
      start = K.clamp(K.viewport.reviewExp, rangeStart, rangeEnd);
      if (start >= rangeEnd) start = rangeStart;
    } else {
      start = rangeStart;
    }
    this._startExp = start;
    this._returnMode = K.viewport.mode;
    this._short = short;
    this.playing = true;
    K.viewport.playing = true;

    // Resolve the first image before starting the clock. IndexedDB-backed
    // frames are asynchronous, and starting the timer first could advance
    // past a frame before its bitmap ever reached the viewport.
    const firstFrame = fs.list[this._expanded[start]];
    if (firstFrame) {
      try {
        const firstBitmap = await fs.getBitmap(firstFrame.id);
        if (!this.playing) return;
        K.viewport.playExp = start;
        K.viewport.playBitmap = firstBitmap;
        K.viewport.invalidate();
      } catch (error) {
        this.playing = false;
        K.viewport.playing = false;
        K.toast(`Playback could not read the first frame: ${error.message}`, 'err');
        return;
      }
    }
    this._t0 = performance.now();
    this._lastDrawnExp = start;

    // prefetch first frames
    this._prefetch(start);
    K.audio.startPlayback(start, fps, this.speed);
    K.bus.emit('playback:started', { start, total, short, speed: this.speed, inPoint: rangeStart, outPoint: rangeEnd });
    K.bus.emit('playback:frame', { exposure: start, frame: this._expanded[start] });
    this._tick();
  },

  stop(atExp = null) {
    if (!this.playing) return;
    clearTimeout(this._timer);
    this.playing = false;
    K.viewport.playing = false;
    K.viewport.playBitmap = null;
    K.audio.stopPlayback();
    const fs = K.frames;
    K.viewport.playExp = null;
    if (this._short || this._returnMode === 'live') {
      K.viewport.setMode('live');
    } else if (atExp !== null && this._expanded.length) {
      K.viewport.setExposure(atExp);
    } else {
      K.viewport.setMode(fs.count() ? 'review' : 'live', fs.count() - 1);
    }
    K.bus.emit('playback:stopped', {});
  },

  async _prefetch(fromExp) {
    const fs = K.frames;
    const seen = new Set();
    for (let e = fromExp; e < Math.min(fromExp + 16, this._expanded.length); e++) {
      const fi = this._expanded[e];
      const f = fs.list[fi];
      if (f && !seen.has(f.id)) { seen.add(f.id); fs.getBitmap(f.id); }
    }
  },

  _tick() {
    if (!this.playing) return;
    const fps = K.project.current.fps;
    const elapsed = (performance.now() - this._t0) / 1000;
    let exp = this._startExp + Math.floor(elapsed * fps * this.speed);
    const total = this._expanded.length;
    const rangeStart = this.inPoint === null ? 0 : K.clamp(this.inPoint, 0, total - 1);
    const rangeEnd = this.outPoint === null ? total - 1 : K.clamp(this.outPoint, rangeStart, total - 1);

    if (exp > rangeEnd) {
      if (this.loop && !this._short) {
        // wrap
        this._t0 = performance.now();
        this._startExp = rangeStart;
        exp = rangeStart;
        K.audio.stopPlayback();
        K.audio.startPlayback(rangeStart, fps, this.speed);
      } else {
        this.stop(rangeEnd);
        return;
      }
    }

    if (exp !== this._lastDrawnExp) {
      this._lastDrawnExp = exp;
      K.viewport.playExp = exp;
      const frameIdx = this._expanded[exp];
      const f = K.frames.list[frameIdx];
      if (f) {
        // draw only if bitmap ready; never await inside the tick
        const cached = K.frames._bitmaps.get(f.id);
        if (cached) {
          K.viewport.playBitmap = cached;
          K.viewport.invalidate();
        } else {
          const requestedExp = exp;
          K.frames.getBitmap(f.id).then((bitmap) => {
            if (this.playing && K.viewport.playExp === requestedExp) {
              K.viewport.playBitmap = bitmap;
              K.viewport.invalidate();
            }
          }).catch((error) => K.toast(`Playback frame unavailable: ${error.message}`, 'err'));
        }
      }
      this._prefetch(exp + 1);
      K.bus.emit('playback:frame', { exposure: exp, frame: frameIdx });
    }
    // setTimeout (not rAF) so the clock keeps running in throttled/hidden tabs
    this._timer = setTimeout(() => this._tick(), Math.max(4, 1000 / (fps * this.speed) / 3));
  },
};
