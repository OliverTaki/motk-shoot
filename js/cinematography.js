/* MOTK Shoot — non-destructive cinematography monitor tools. */
'use strict';
K.cine = {
  settings: {
    histogram: false, zebra: false, clipLevel: 245,
    peaking: false, peakThreshold: 55,
    chroma: false, chromaColor: '#00ff00', chromaTolerance: 85,
    desqueeze: 1,
  },
  _canvas: null,
  _ctx: null,
  _lastAnalysis: 0,

  apply(settings = {}) {
    Object.assign(this.settings, settings || {});
    this.settings.desqueeze = K.clamp(parseFloat(this.settings.desqueeze) || 1, 1, 2);
    this._showHistogram();
    K.viewport?.invalidate();
  },

  _ensure(w, h) {
    const scale = Math.min(1, 960 / Math.max(1, w));
    const tw = Math.max(2, Math.round(w * scale));
    const th = Math.max(2, Math.round(h * scale));
    if (!this._canvas) {
      this._canvas = document.createElement('canvas');
      this._ctx = this._canvas.getContext('2d', { willReadFrequently: true });
    }
    if (this._canvas.width !== tw || this._canvas.height !== th) {
      this._canvas.width = tw; this._canvas.height = th;
    }
    return { canvas: this._canvas, ctx: this._ctx, w: tw, h: th };
  },

  _rgb(hex) {
    const value = parseInt(String(hex || '#00ff00').replace('#', ''), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  },

  drawSource(ctx, source, w, h) {
    if (!source) return;
    const activePixels = this.settings.chroma || this.settings.zebra || this.settings.peaking || this.settings.histogram;
    let drawable = source;
    if (activePixels) {
      const temp = this._ensure(w, h);
      temp.ctx.setTransform(1, 0, 0, 1, 0, 0);
      temp.ctx.globalCompositeOperation = 'source-over';
      temp.ctx.globalAlpha = 1;
      temp.ctx.clearRect(0, 0, temp.w, temp.h);
      temp.ctx.drawImage(source, 0, 0, temp.w, temp.h);
      const image = temp.ctx.getImageData(0, 0, temp.w, temp.h);
      const data = image.data;
      const key = this._rgb(this.settings.chromaColor);
      const tol2 = this.settings.chromaTolerance * this.settings.chromaTolerance;
      const lum = this.settings.peaking ? new Uint8Array(temp.w * temp.h) : null;
      const hist = this.settings.histogram ? new Uint32Array(256) : null;
      for (let i = 0, px = 0; i < data.length; i += 4, px++) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const y = Math.round(r * 0.2126 + g * 0.7152 + b * 0.0722);
        if (hist) hist[y]++;
        if (lum) lum[px] = y;
        if (this.settings.chroma) {
          const dr = r - key[0], dg = g - key[1], db = b - key[2];
          if (dr * dr + dg * dg + db * db <= tol2) data[i + 3] = 0;
        }
        if (this.settings.zebra && y >= this.settings.clipLevel && (((px % temp.w) + Math.floor(px / temp.w)) % 12 < 5)) {
          data[i] = 255; data[i + 1] = 35; data[i + 2] = 35; data[i + 3] = 210;
        }
      }
      if (lum) {
        const threshold = this.settings.peakThreshold;
        for (let y = 1; y < temp.h - 1; y++) for (let x = 1; x < temp.w - 1; x++) {
          const p = y * temp.w + x;
          const edge = Math.abs(lum[p + 1] - lum[p - 1]) + Math.abs(lum[p + temp.w] - lum[p - temp.w]);
          if (edge >= threshold) {
            const i = p * 4; data[i] = 30; data[i + 1] = 255; data[i + 2] = 90; data[i + 3] = 255;
          }
        }
      }
      temp.ctx.putImageData(image, 0, 0);
      drawable = temp.canvas;
      if (hist && performance.now() - this._lastAnalysis >= 180) {
        this._lastAnalysis = performance.now();
        this._drawHistogram(hist);
      }
    }
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(this.settings.desqueeze, 1);
    ctx.drawImage(drawable, -w / 2, -h / 2, w, h);
    ctx.restore();
    this._showHistogram();
  },

  _showHistogram() {
    const canvas = K.$('#histogramCanvas');
    if (canvas) canvas.classList.toggle('hidden', !this.settings.histogram);
  },

  _drawHistogram(hist) {
    const canvas = K.$('#histogramCanvas');
    if (!canvas || !this.settings.histogram) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,.78)'; ctx.fillRect(0, 0, w, h);
    let max = 1;
    for (let i = 2; i < 254; i++) max = Math.max(max, hist[i]);
    ctx.strokeStyle = '#d7dde6'; ctx.lineWidth = 1.4; ctx.beginPath();
    for (let x = 0; x < w; x++) {
      const bin = Math.min(255, Math.floor(x / w * 256));
      const y = h - 4 - Math.log1p(hist[bin]) / Math.log1p(max) * (h - 10);
      if (!x) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    const clipX = this.settings.clipLevel / 255 * w;
    ctx.fillStyle = 'rgba(255,95,69,.75)'; ctx.fillRect(clipX, 0, 1, h);
  },
};
