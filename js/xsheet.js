/* MOTK Shoot — X-Sheet: exposure table with per-frame dialogue/phoneme notes */
'use strict';
K.xsheet = {
  open: false,

  init() {
    K.$('#btnXsheet').addEventListener('click', () => this.toggle());
    K.$('#btnPrintXsheet').addEventListener('click', () => window.print());
    K.bus.on('frames:changed', () => { if (this.open) this.render(); });
    K.bus.on('mode:changed', () => { if (this.open) this.highlight(); });
  },

  toggle() {
    this.open = !this.open;
    if (this.open) {
      this.render();
      K.ui.showModal('xsheetModal');
    } else {
      K.ui.hideModals();
    }
  },

  render() {
    const fps = K.project.current.fps;
    const table = K.$('#xsheetTable');
    table.innerHTML = '<caption></caption><tr><th>#</th><th>sec</th><th>frame</th><th>hold</th><th>dialogue / phoneme</th></tr>';
    table.querySelector('caption').textContent = `${K.project.current.name} · ${fps} fps`;
    const fs = K.frames;
    let exp = 0;
    fs.list.forEach((f, i) => {
      for (let k = 0; k < (f.hold || 1); k++) {
        const tr = document.createElement('tr');
        tr.dataset.frame = i;
        tr.dataset.exp = exp;
        const isFirst = k === 0;
        tr.innerHTML = `
          <td class="mono">${exp + 1}</td>
          <td class="sec">${exp % fps === 0 ? (exp / fps).toFixed(0) + 's' : ''}</td>
          <td>${isFirst ? `<img src="${f.thumb}" alt="">` : '<span class="dim">│</span>'}</td>
          <td class="mono dim">${isFirst ? (i + 1) + (f.hold > 1 ? ' ×' + f.hold : '') : ''}</td>
          <td></td>`;
        if (isFirst) {
          const inp = document.createElement('input');
          inp.type = 'text';
          inp.value = f.note || '';
          inp.placeholder = '…';
          inp.addEventListener('change', () => K.frames.setNote(i, inp.value.trim()));
          inp.addEventListener('click', (e) => e.stopPropagation());
          tr.lastElementChild.appendChild(inp);
        }
        tr.addEventListener('click', () => {
          K.playback.stop();
          K.viewport.setMode('review', i);
          K.audio.playSlice(parseInt(tr.dataset.exp, 10), fps);
          this.highlight();
        });
        table.appendChild(tr);
        exp++;
      }
    });
    this.highlight();
  },

  highlight() {
    const rows = K.$$('#xsheetTable tr[data-frame]');
    const cur = K.viewport.mode === 'review' ? K.viewport.reviewIdx : -1;
    let scrolled = false;
    rows.forEach((r) => {
      const on = parseInt(r.dataset.frame, 10) === cur;
      r.classList.toggle('cur', on);
      if (on && !scrolled) { r.scrollIntoView({ block: 'nearest' }); scrolled = true; }
    });
  },
};
