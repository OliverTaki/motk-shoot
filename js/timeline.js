/* MOTK Shoot — timeline: an exposure (koma) grid.
 * Every slot = one exposure at the project frame rate. A frame with hold n
 * occupies exactly n slots; stretching a hold adds/removes slots (no zooming).
 * Selection, the playback cursor and clicks all operate per koma.
 * SLOT width must match the CSS background grid (see css: .slots / #tlRuler).
 */
'use strict';
K.timeline = {
  reel: null,
  ruler: null,
  cursor: null,
  SLOT: 56,

  init() {
    this.reel = K.$('#reel');
    this.ruler = K.$('#tlRuler');
    K.bus.on('frames:changed', () => this.render());
    K.bus.on('frames:noted', () => this.render());
    K.bus.on('mode:changed', () => this.updateSelection());
    K.bus.on('project:opened', () => this.render());
    K.bus.on('playback:frame', ({ exposure }) => this._moveCursor(exposure, true));
    this.render();

    document.addEventListener('click', () => K.$('#ctxMenu').classList.add('hidden'));
  },

  render() {
    const fs = K.frames;
    const fps = K.project.current ? K.project.current.fps : 12;
    const reel = this.reel;
    reel.innerHTML = '';

    let exp = 0;
    fs.list.forEach((f, i) => {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.idx = i;
      cell.dataset.exp = exp;
      cell.style.width = (f.hold || 1) * this.SLOT + 'px';
      const img = document.createElement('img');
      img.src = f.thumb;
      img.draggable = false;
      cell.appendChild(img);
      // koma separator ticks inside held cells
      if ((f.hold || 1) > 1) {
        const slots = document.createElement('div');
        slots.className = 'slots';
        cell.appendChild(slots);
      }
      const idx = document.createElement('span');
      idx.className = 'idx';
      idx.textContent = i + 1;
      cell.appendChild(idx);
      const hold = document.createElement('span');
      hold.className = 'hold';
      hold.textContent = '×' + (f.hold || 1);
      if ((f.hold || 1) <= 1) hold.style.display = 'none';
      cell.appendChild(hold);
      if (f.raw) {
        const raw = document.createElement('span');
        raw.className = 'rawb';
        raw.textContent = 'RAW';
        raw.title = f.raw;
        cell.appendChild(raw);
      }
      if (f.passes && f.passes.length) {
        const pass = document.createElement('span');
        pass.className = 'passb';
        pass.textContent = `P×${f.passes.length}`;
        pass.title = f.passes.map((p) => `${p.name}: ${(p.files || []).join(', ')}`).join('\n');
        cell.appendChild(pass);
      }
      if (f.note) {
        const note = document.createElement('span');
        note.className = 'note';
        note.textContent = f.note;
        cell.appendChild(note);
      }
      const grip = document.createElement('div');
      grip.className = 'grip';
      grip.title = 'Drag to add/remove koma (hold)';
      grip.addEventListener('pointerdown', (e) => this._gripDown(e, cell, i));
      cell.appendChild(grip);

      cell.addEventListener('pointerdown', (e) => this._pointerDown(e, cell, i));
      cell.addEventListener('contextmenu', (e) => { e.preventDefault(); this._ctxMenu(e, i); });
      reel.appendChild(cell);
      exp += f.hold || 1;
    });

    // live slot at the end (the koma you are about to shoot)
    const live = document.createElement('div');
    live.className = 'cell livecell';
    live.style.width = this.SLOT + 'px';
    live.textContent = '⦿';
    live.title = 'Live view — the next koma';
    live.addEventListener('click', () => { K.playback.stop(); K.viewport.setMode('live'); });
    reel.appendChild(live);

    // per-koma selection cursor
    this.cursor = document.createElement('div');
    this.cursor.id = 'expCursor';
    reel.appendChild(this.cursor);

    this._renderRuler(exp + 1, fps);
    this.updateSelection();
  },

  _renderRuler(totalSlots, fps) {
    const r = this.ruler;
    r.innerHTML = '';
    r.style.width = totalSlots * this.SLOT + 'px';
    for (let s = 0; s * fps < totalSlots; s++) {
      const tick = document.createElement('span');
      tick.className = 'sec';
      tick.style.left = s * fps * this.SLOT + 'px';
      tick.textContent = s + 's';
      r.appendChild(tick);
    }
  },

  updateSelection() {
    const vp = K.viewport;
    for (const c of this.reel.querySelectorAll('.cell')) c.classList.remove('sel');
    if (vp.mode === 'live' && !K.playback.playing) {
      const live = this.reel.querySelector('.livecell');
      if (live) {
        live.classList.add('sel');
        this._moveCursor(K.frames.totalExposures());
        live.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    } else {
      const cell = this.reel.querySelector(`.cell[data-idx="${vp.reviewIdx}"]`);
      if (cell) {
        cell.classList.add('sel');
        this._moveCursor(vp.reviewExp);
        cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }
  },

  _moveCursor(exposure, follow = false) {
    if (!this.cursor) return;
    this.cursor.style.transform = `translateX(${exposure * this.SLOT}px)`;
    if (follow) {
      const tl = K.$('#timeline');
      const x = exposure * this.SLOT;
      if (x < tl.scrollLeft || x + this.SLOT > tl.scrollLeft + tl.clientWidth) {
        tl.scrollLeft = x - tl.clientWidth / 2;
      }
    }
  },

  scrollToEnd() {
    K.$('#timeline').scrollLeft = this.reel.scrollWidth;
  },

  /* --- right-edge grip: add/remove koma, snapped to the slot grid --- */
  _gripDown(e, cell, idx) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const f = K.frames.list[idx];
    const orig = f.hold || 1;
    let cur = orig;
    const startX = e.clientX;
    const badge = cell.querySelector('.hold');
    cell.classList.add('holding');

    const move = (ev) => {
      cur = K.clamp(orig + Math.round((ev.clientX - startX) / this.SLOT), 1, 99);
      cell.style.width = cur * this.SLOT + 'px';
      badge.textContent = '×' + cur;
      badge.style.display = '';
      K.status(`${cur} koma  (${(cur / K.project.current.fps).toFixed(2)}s)`);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      cell.classList.remove('holding');
      K.status('');
      if (cur !== orig) K.frames.setHold(idx, cur);   // one snapshot → one Ctrl+Z
      else this.render();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  },

  /* --- pointer: click selects the exact koma, drag reorders the frame --- */
  _pointerDown(e, cell, idx) {
    if (e.button !== 0) return;
    const startX = e.clientX, startY = e.clientY;
    let dragging = false;
    let marker = null;
    let target = idx;

    const move = (ev) => {
      if (!dragging && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 7) {
        dragging = true;
        cell.classList.add('dragging');
        marker = document.createElement('div');
        marker.className = 'drop-marker';
      }
      if (!dragging) return;
      const cells = Array.from(this.reel.querySelectorAll('.cell:not(.livecell)'));
      target = cells.length;
      for (let i = 0; i < cells.length; i++) {
        const r = cells[i].getBoundingClientRect();
        if (ev.clientX < r.left + r.width / 2) { target = i; break; }
      }
      const ref = cells[target] || this.reel.querySelector('.livecell');
      this.reel.insertBefore(marker, ref);
      const tl = K.$('#timeline');
      const tr = tl.getBoundingClientRect();
      if (ev.clientX > tr.right - 40) tl.scrollLeft += 14;
      else if (ev.clientX < tr.left + 40) tl.scrollLeft -= 14;
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (dragging) {
        cell.classList.remove('dragging');
        if (marker) marker.remove();
        let to = target;
        if (to > idx) to -= 1;
        if (to !== idx) K.frames.move(idx, to);
        else this.render();
      } else {
        // click: select the precise koma under the pointer
        K.playback.stop();
        const rect = cell.getBoundingClientRect();
        const slotInCell = K.clamp(Math.floor((ev.clientX - rect.left) / this.SLOT), 0, (K.frames.list[idx].hold || 1) - 1);
        const exposure = parseInt(cell.dataset.exp, 10) + slotInCell;
        K.viewport.setExposure(exposure);
        K.audio.playSlice(exposure, K.project.current.fps);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  },

  _ctxMenu(e, idx) {
    const menu = K.$('#ctxMenu');
    const f = K.frames.list[idx];
    menu.innerHTML = '';
    const add = (label, fn) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', (ev) => { ev.stopPropagation(); menu.classList.add('hidden'); fn(); });
      menu.appendChild(b);
    };
    const hr = () => menu.appendChild(document.createElement('hr'));

    add(`Frame ${idx + 1} — ${f.hold} koma${f.raw ? ' · RAW: ' + f.raw : ''}`, () => {});
    hr();
    add('Duplicate reference (D)', () => K.frames.duplicate(idx));
    add('Hold +1 koma (+)', () => K.frames.setHold(idx, f.hold + 1));
    add('Hold −1 koma (−)', () => K.frames.setHold(idx, f.hold - 1));
    add('Set hold…', () => {
      const v = parseInt(prompt('Hold (koma):', f.hold), 10);
      if (v > 0) K.frames.setHold(idx, v);
    });
    hr();
    add('Insert black frame after', () => K.frames.addBlack(idx + 1));
    add('Save frame as JPEG…', async () => {
      const blob = await K.frames.getBlob(f.id);
      K.downloadBlob(K.seqName(idx), blob);
    });
    hr();
    add('Remove from edit (capture kept) (Del)', () => this.deleteFrame(idx));
    hr();
    add('Undo (Ctrl+Z)', () => K.frames.undo());
    add('Reset this edit to as-shot…', () => {
      if (confirm('Rebuild this edit exactly as shot (all captures, capture order, shot holds)?')) {
        K.frames.resetAsShot();
      }
    });
    add('New alt edit from current', () => K.ui.newAltEdit());

    menu.style.left = Math.min(e.clientX, innerWidth - 220) + 'px';
    menu.classList.remove('hidden');
    menu.style.top = Math.max(8, Math.min(e.clientY, innerHeight - menu.offsetHeight - 8)) + 'px';
  },

  deleteFrame(idx) {
    const fs = K.frames;
    if (!fs.list[idx]) return;
    fs.remove(idx);
    if (fs.count() === 0) K.viewport.setMode('live');
    else if (K.viewport.mode === 'review') {
      K.viewport.setMode('review', Math.min(idx, fs.count() - 1));
    }
  },
};
