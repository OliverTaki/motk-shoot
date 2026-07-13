/* MOTK Shoot — remappable keyboard shortcuts and optional read-only WebHID input. */
'use strict';
K.shortcuts = {
  storageKey: 'motkshoot-shortcuts-v1',
  bindings: {},
  devices: new Map(),
  _learnKeyboard: '',
  _learnHid: '',
  _heldAction: '',
  _heldCode: '',
  _lastHid: { signature: '', at: 0 },

  actions: {
    capture: { label: 'Capture frame', defaults: ['Enter'], run: () => K.ui.capture() },
    play: { label: 'Play / stop', defaults: ['Space'], run: () => K.playback.toggle({ fromStart: K.viewport.mode === 'live' }) },
    stepBack: { label: 'Step back', defaults: ['Digit1', 'ArrowLeft'], repeat: true, run: () => K.ui.step(-1) },
    stepForward: { label: 'Step forward', defaults: ['Digit2', 'ArrowRight'], repeat: true, run: () => K.ui.step(1) },
    toggleLive: { label: 'Toggle live view', defaults: ['Digit3'], run: () => K.ui.toggleLive() },
    shortPlay: { label: 'Short play', defaults: ['Digit4'], run: () => K.playback.play({ short: true }) },
    first: { label: 'First frame', defaults: ['Home'], run: () => K.ui.goFirst() },
    last: { label: 'Last frame', defaults: ['End'], run: () => K.ui.goLast() },
    remove: { label: 'Remove from edit', defaults: ['Delete', 'Backspace'], run: () => K.ui.deleteCurrent() },
    onion: { label: 'Toggle onion skin', defaults: ['KeyO'], run: () => K.ui.toggleOnion() },
    loop: { label: 'Toggle loop', defaults: ['KeyL'], run: () => K.ui.toggleLoop() },
    grid: { label: 'Cycle grid', defaults: ['KeyG'], run: () => K.ui.cycleGrid() },
    mute: { label: 'Mute audio', defaults: ['KeyM'], run: () => K.ui.toggleMute() },
    duplicate: { label: 'Duplicate frame', defaults: ['KeyD'], run: () => { if (K.viewport.mode === 'review') K.frames.duplicate(K.viewport.reviewIdx); } },
    holdMore: { label: 'Increase hold', defaults: ['Equal', 'NumpadAdd'], repeat: true, run: () => K.ui.holdDelta(1) },
    holdLess: { label: 'Decrease hold', defaults: ['Minus', 'NumpadSubtract'], repeat: true, run: () => K.ui.holdDelta(-1) },
    xsheet: { label: 'X-Sheet', defaults: ['KeyX'], run: () => K.xsheet.toggle() },
    popThrough: { label: 'Hold pop-through', defaults: ['KeyP'], hold: true, run: () => K.viewport.setPopThrough(true), release: () => K.viewport.setPopThrough(false) },
    projects: { label: 'Projects', defaults: ['Mod+KeyO'], run: () => K.ui.openProjectModal() },
    undo: { label: 'Undo', defaults: ['Mod+KeyZ'], run: () => K.frames.undo() },
    redo: { label: 'Redo', defaults: ['Mod+Shift+KeyZ', 'Mod+KeyY'], run: () => K.frames.redo() },
    help: { label: 'Shortcut help', defaults: ['Shift+Slash'], run: () => K.ui.showModal('helpModal') },
  },

  init() {
    this._load();
    document.addEventListener('keydown', (event) => this._keydown(event));
    document.addEventListener('keyup', (event) => this._keyup(event));
    window.addEventListener('blur', () => this._releaseHeld());
    K.$('#btnShortcutSettings')?.addEventListener('click', () => { this.render(); K.ui.showModal('shortcutModal'); });
    K.$('#btnShortcutBack')?.addEventListener('click', () => K.ui.showModal('helpModal'));
    K.$('#btnShortcutReset')?.addEventListener('click', () => this.reset());
    K.$('#btnHidConnect')?.addEventListener('click', () => this.connectHid(true).catch((e) => {
      if (e.name !== 'NotFoundError') K.toast('WebHID: ' + e.message, 'err', 5000);
      this._renderStatus();
    }));
    if (navigator.hid) {
      navigator.hid.addEventListener('disconnect', (event) => { this.devices.delete(this._deviceKey(event.device)); this._renderStatus(); });
      this.connectHid(false).catch(() => {});
    }
  },

  _load() {
    try {
      const stored = JSON.parse(localStorage.getItem(this.storageKey) || '{}');
      for (const id of Object.keys(this.actions)) {
        const item = stored[id];
        if (item && typeof item === 'object') this.bindings[id] = { keyboard: String(item.keyboard || ''), hid: String(item.hid || '') };
      }
    } catch { this.bindings = {}; }
  },

  _save() {
    try { localStorage.setItem(this.storageKey, JSON.stringify(this.bindings)); } catch {}
  },

  _keys(id) {
    const custom = this.bindings[id]?.keyboard;
    return custom ? [custom] : this.actions[id].defaults;
  },

  _combo(event) {
    const parts = [];
    if (event.ctrlKey || event.metaKey) parts.push('Mod');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey && event.code !== 'ShiftLeft' && event.code !== 'ShiftRight') parts.push('Shift');
    parts.push(event.code || event.key);
    return parts.join('+');
  },

  _keydown(event) {
    if (this._learnKeyboard) {
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'Escape') { this._learnKeyboard = ''; this.render(); return; }
      if (/^(Shift|Control|Alt|Meta)(Left|Right)$/.test(event.code)) return;
      this._assignKeyboard(this._learnKeyboard, this._combo(event));
      this._learnKeyboard = ''; this.render(); return;
    }
    const tag = (event.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || event.target.isContentEditable) {
      if (event.key === 'Escape') event.target.blur();
      return;
    }
    if (event.key === 'Escape') { K.ui.hideModals(); K.playback.stop(); this._releaseHeld(); return; }
    const combo = this._combo(event);
    const id = Object.keys(this.actions).find((actionId) => this._keys(actionId).includes(combo));
    if (!id) return;
    const action = this.actions[id];
    if (event.repeat && !action.repeat) { event.preventDefault(); return; }
    event.preventDefault();
    action.run();
    if (action.hold) { this._heldAction = id; this._heldCode = event.code; }
  },

  _keyup(event) {
    if (this._heldAction && event.code === this._heldCode) { event.preventDefault(); this._releaseHeld(); }
  },

  _releaseHeld() {
    if (this._heldAction) this.actions[this._heldAction]?.release?.();
    this._heldAction = ''; this._heldCode = '';
  },

  _assignKeyboard(id, combo) {
    const conflict = Object.keys(this.actions).find((other) => other !== id && this._keys(other).includes(combo));
    if (conflict) { K.toast(`${this._display(combo)} is already assigned to ${this.actions[conflict].label}`, 'err', 5000); return false; }
    this.bindings[id] = { ...(this.bindings[id] || {}), keyboard: combo };
    this._save(); K.toast(`${this.actions[id].label}: ${this._display(combo)}`, 'ok'); return true;
  },

  reset() {
    this.bindings = {}; this._learnKeyboard = ''; this._learnHid = '';
    try { localStorage.removeItem(this.storageKey); } catch {}
    this.render(); K.toast('Shortcut defaults restored', 'ok');
  },

  _display(combo) {
    return String(combo).replace(/Mod\+/g, navigator.platform.includes('Mac') ? '⌘+' : 'Ctrl+')
      .replace(/Key([A-Z])/g, '$1').replace(/Digit([0-9])/g, '$1').replace('Space', 'Spacebar')
      .replace('Equal', '+').replace('Minus', '−').replace('Shift+Slash', '?');
  },

  render() {
    const list = K.$('#shortcutList'); if (!list) return;
    list.innerHTML = '';
    for (const [id, action] of Object.entries(this.actions)) {
      const row = document.createElement('div'); row.className = 'shortcut-row';
      const label = document.createElement('span'); label.textContent = action.label;
      const keyboard = document.createElement('button'); keyboard.className = 'btn shortcut-key';
      keyboard.dataset.shortcutAction = id;
      keyboard.textContent = this._learnKeyboard === id ? 'Press a key…' : this._keys(id).map((key) => this._display(key)).join(' / ');
      keyboard.addEventListener('click', () => { this._learnKeyboard = id; this._learnHid = ''; this.render(); });
      const hid = document.createElement('button'); hid.className = 'btn shortcut-hid';
      hid.dataset.hidAction = id;
      hid.textContent = this._learnHid === id ? 'Press keypad…' : (this.bindings[id]?.hid ? 'HID assigned' : 'Learn HID');
      hid.disabled = !navigator.hid;
      hid.addEventListener('click', () => {
        this._learnHid = id; this._learnKeyboard = ''; this.render();
        if (!this.devices.size) this.connectHid(true).catch((e) => {
          if (e.name !== 'NotFoundError') K.toast('WebHID: ' + e.message, 'err', 5000);
          this._learnHid = ''; this.render();
        });
      });
      row.append(label, keyboard, hid); list.appendChild(row);
    }
    this._renderStatus();
  },

  _deviceKey(device) { return `${device.vendorId}:${device.productId}:${device.productName || ''}`; },

  async connectHid(requestPermission) {
    if (!navigator.hid) { this._renderStatus('WebHID is not supported in this browser.'); return; }
    const devices = requestPermission ? await navigator.hid.requestDevice({ filters: [] }) : await navigator.hid.getDevices();
    for (const device of devices) {
      if (!device.opened) await device.open();
      device.oninputreport = (event) => this._hidReport(event);
      this.devices.set(this._deviceKey(device), device);
    }
    this._renderStatus();
  },

  _hidReport(event) {
    const bytes = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
    if (!bytes.length || bytes.every((value) => value === 0)) return;
    const signature = `${event.device.vendorId}:${event.device.productId}:r${event.reportId}:${[...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
    const now = Date.now();
    if (signature === this._lastHid.signature && now - this._lastHid.at < 120) return;
    this._lastHid = { signature, at: now };
    if (this._learnHid) {
      const id = this._learnHid;
      const conflict = Object.keys(this.actions).find((other) => other !== id && this.bindings[other]?.hid === signature);
      if (conflict) K.toast(`That HID input is already assigned to ${this.actions[conflict].label}`, 'err', 5000);
      else {
        this.bindings[id] = { ...(this.bindings[id] || {}), hid: signature };
        this._save(); K.toast(`HID input assigned to ${this.actions[id].label}`, 'ok');
      }
      this._learnHid = ''; this.render(); return;
    }
    const id = Object.keys(this.actions).find((actionId) => this.bindings[actionId]?.hid === signature);
    if (id) this.actions[id].run();
  },

  _renderStatus(message) {
    const status = K.$('#hidStatus'); if (!status) return;
    status.textContent = message || (!navigator.hid ? 'WebHID unavailable.' : `${this.devices.size} HID keypad${this.devices.size === 1 ? '' : 's'} connected. Input reports are read only.`);
  },
};
