/* MOTK Shoot — shared helpers + global namespace */
'use strict';
window.K = {};

K.$ = (sel) => document.querySelector(sel);
K.$$ = (sel) => Array.from(document.querySelectorAll(sel));

/* tiny event bus */
K.bus = {
  _t: new EventTarget(),
  on(type, fn) { this._t.addEventListener(type, (e) => fn(e.detail)); },
  emit(type, detail) {
    this._t.dispatchEvent(new CustomEvent(type, { detail }));
    // mirror to the public API + bridge
    if (K.bridge) K.bridge.onBusEvent(type, detail);
  },
};

K.uid = () => 'f_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);

K.clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* frames -> HH:MM:SS.FF */
K.timecode = (frameIdx, fps) => {
  const totalSec = frameIdx / fps;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor(totalSec / 60) % 60;
  const s = Math.floor(totalSec) % 60;
  const f = Math.floor(frameIdx % fps);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(s)}.${p(f)}`;
};

K.debounce = (fn, ms) => {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};

K.downloadBlob = (name, blob) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
};

K.toast = (msg, kind = '', ms = 2600) => {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  K.$('#toasts').appendChild(el);
  setTimeout(() => el.remove(), ms);
};

K.status = (msg) => { K.$('#statusMsg').textContent = msg; };

K.blobToDataURL = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = rej;
  r.readAsDataURL(blob);
});

K.canvasToBlob = (canvas, type = 'image/jpeg', quality = 0.92) =>
  new Promise((res) => canvas.toBlob(res, type, quality));

K.sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ordinal file names: frame_00001.jpg */
K.seqName = (i, ext = 'jpg') => `frame_${String(i + 1).padStart(5, '0')}.${ext}`;
