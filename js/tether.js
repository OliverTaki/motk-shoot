/* MOTK Shoot — tether: drive the camera's OWN shutter through a local agent.
 *
 * The browser's MediaStream can't set shutter speed or save RAW. The tether
 * agent (bridge/camera-agent.mjs) runs next to the camera, speaks gphoto2 /
 * digiCamControl, and on every MOTK Shoot capture:
 *   - fires the real shutter (camera-body exposure settings apply),
 *   - saves RAW/JPEG originals to a folder on disk,
 *   - reports the file names back (recorded per frame, exported in CSV/backup),
 *   - optionally returns the camera JPEG, which replaces the live-view grab
 *     as the frame image.
 */
'use strict';
K.tether = {
  ws: null,
  connected: false,
  connecting: false,
  url: 'ws://localhost:8793',
  token: '',
  claims: [],
  trigger: true,      // fire camera shutter on every capture
  useJpeg: true,      // swap in the camera JPEG as the frame image
  backend: '',
  dir: '',
  productionRoot: '',
  configs: [],
  passesEnabled: false,
  passPresets: [],
  liveViewActive: false,
  liveViewSeq: 0,
  _liveWaiter: null,
  _frameDecoding: false,
  _queuedFrame: null,
  _pending: new Map(),
  _seq: 0,
  _connectTimer: null,

  armed() { return this.connected && this.trigger; },

  restorePairingToken() {
    try { this.token = sessionStorage.getItem('motkshoot.companionPairingKey') || ''; } catch { this.token = ''; }
    return this.token;
  },

  setPairingToken(token) {
    this.token = String(token || '').trim();
    try {
      if (this.token) sessionStorage.setItem('motkshoot.companionPairingKey', this.token);
      else sessionStorage.removeItem('motkshoot.companionPairingKey');
    } catch { /* Private/session storage can be unavailable; keep memory-only. */ }
    const input = K.$('#inTetherToken');
    if (input && input.value !== this.token) input.value = this.token;
  },

  async localNetworkPermissionState() {
    if (!globalThis.isSecureContext || !navigator.permissions?.query) return 'not-required';
    try { return (await navigator.permissions.query({ name: 'local-network-access' })).state; }
    catch { return 'unsupported'; }
  },

  async connect(url, token) {
    this.disconnect();
    this.url = url || this.url;
    this.setPairingToken(token === undefined ? this.token : token);
    const permission = await this.localNetworkPermissionState();
    if (permission === 'denied') {
      K.toast('Allow Local network access for this site in browser settings, then connect again.', 'err', 7000);
      return;
    }
    this.connecting = true;
    this._setStatus();
    const info = K.$('#tetherInfo');
    if (info && permission === 'prompt') info.textContent = 'Your browser will ask for Local network access. Choose Allow to reach Companion on this PC.';
    let endpoint;
    try {
      endpoint = new URL(this.url, location.href);
      if (!['ws:', 'wss:'].includes(endpoint.protocol)) throw new Error('Agent URL must use ws:// or wss://');
      if (this.token) endpoint.searchParams.set('token', this.token);
      this.ws = new WebSocket(endpoint.href);
      this._connectTimer = setTimeout(() => {
        if (this.connected || !this.connecting) return;
        this.ws?.close();
        this.connecting = false;
        this._setStatus();
        K.toast('Companion connection timed out. Check the pairing key and allow Local network access in the browser.', 'err', 8000);
      }, 30000);
    } catch (e) {
      this.connecting = false;
      this._setStatus();
      K.toast('Tether: ' + e.message, 'err');
      return;
    }
    this.ws.onopen = () => { /* wait for hello */ };
    this.ws.onclose = () => {
      clearTimeout(this._connectTimer);
      this._connectTimer = null;
      const was = this.connected;
      this.connecting = false;
      this.connected = false;
      this.liveViewActive = false;
      if (this._liveWaiter) this._liveWaiter.reject(new Error('tether disconnected'));
      this._liveWaiter = null;
      if (K.camera) K.camera.tetherStopped();
      this._setStatus();
      if (was) K.toast('Tether agent disconnected', 'err');
      for (const [, p] of this._pending) p.reject(new Error('tether disconnected'));
      this._pending.clear();
    };
    this.ws.onerror = () => {
      if (!this.connected) K.toast('Tether: could not reach agent at ' + this.url, 'err', 4000);
    };
    this.ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === 'tether.hello') {
        clearTimeout(this._connectTimer);
        this._connectTimer = null;
        this.connecting = false;
        this.connected = true;
        this.claims = Array.isArray(msg.auth?.claims) ? msg.auth.claims.slice() : [];
        this.backend = msg.backend || '?';
        this.dir = msg.dir || '';
        this.productionRoot = msg.productionRoot || '';
        this._setStatus();
        K.toast(`Companion connected (${this.backend})`, 'ok');
        this.refreshConfigs();
      } else if (msg.type === 'tether.result') {
        const p = this._pending.get(msg.id);
        if (p) { this._pending.delete(msg.id); p.resolve(msg); }
      } else if (msg.type === 'tether.liveview.frame') {
        this._consumeLiveFrame(msg);
      } else if (msg.type === 'tether.liveview.error') {
        this.liveViewActive = false;
        if (this._liveWaiter) this._liveWaiter.reject(new Error(msg.error || 'live view failed'));
        this._liveWaiter = null;
        if (K.camera) K.camera.tetherStopped();
        K.toast('Tether live view: ' + (msg.error || 'stopped'), 'err', 5000);
      }
    };
  },

  disconnect() {
    clearTimeout(this._connectTimer);
    this._connectTimer = null;
    this.connecting = false;
    this.liveViewActive = false;
    if (this._liveWaiter) this._liveWaiter.reject(new Error('tether disconnected'));
    this._liveWaiter = null;
    if (K.camera) K.camera.tetherStopped();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.claims = [];
    this.configs = [];
    for (const [, p] of this._pending) p.reject(new Error('tether disconnected'));
    this._pending.clear();
    this._setStatus();
    this._renderConfigs();
  },

  async startLiveView(fps = 10) {
    if (!this.connected) throw new Error('Connect the tether agent first');
    this.liveViewActive = true;
    this.liveViewSeq = 0;
    const firstFrame = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this._liveWaiter) {
          this._liveWaiter = null;
          reject(new Error('tether live view produced no frame'));
        }
      }, 15000);
      this._liveWaiter = {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      };
    });
    const res = await this._request('tether.liveview.start', { fps });
    if (!res.ok) {
      this.liveViewActive = false;
      if (this._liveWaiter) this._liveWaiter.reject(new Error(res.error || 'live view unavailable'));
      this._liveWaiter = null;
      throw new Error(res.error || 'live view unavailable');
    }
    K.status('Tether live view: waiting for camera\u2026');
    const dimensions = await firstFrame;
    K.status('');
    return dimensions;
  },

  async stopLiveView() {
    const wasActive = this.liveViewActive;
    this.liveViewActive = false;
    this._queuedFrame = null;
    if (this._liveWaiter) this._liveWaiter.reject(new Error('live view stopped'));
    this._liveWaiter = null;
    if (!wasActive || !this.connected) return;
    const res = await this._request('tether.liveview.stop', null, 5000);
    if (!res.ok) throw new Error(res.error || 'could not stop live view');
  },

  async _consumeLiveFrame(msg) {
    if (!this.liveViewActive || !msg.jpeg) return;
    if (this._frameDecoding) {
      this._queuedFrame = msg;
      return;
    }
    this._frameDecoding = true;
    try {
      const bin = atob(msg.jpeg);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const bitmap = await createImageBitmap(new Blob([u8], { type: 'image/jpeg' }));
      if (!this.liveViewActive) bitmap.close();
      else {
        this.liveViewSeq = Number(msg.seq) || this.liveViewSeq + 1;
        K.camera.acceptTetherFrame(bitmap);
        if (this._liveWaiter) {
          this._liveWaiter.resolve({ width: bitmap.width, height: bitmap.height });
          this._liveWaiter = null;
        }
      }
    } catch (e) {
      if (this._liveWaiter) {
        this._liveWaiter.reject(e);
        this._liveWaiter = null;
      }
    } finally {
      this._frameDecoding = false;
      const next = this._queuedFrame;
      this._queuedFrame = null;
      if (next) this._consumeLiveFrame(next);
    }
  },

  _request(type, payload, timeoutMs = 15000) {
    if (!this.connected || !this.ws) return Promise.reject(new Error('tether disconnected'));
    const id = 't' + (++this._seq);
    const req = new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this._pending.has(id)) {
          this._pending.delete(id);
          reject(new Error('tether request timed out'));
        }
      }, timeoutMs);
    });
    this.ws.send(JSON.stringify({ type, id, ...(payload || {}) }));
    return req;
  },

  async refreshConfigs() {
    const box = K.$('#tetherConfigs');
    if (box) box.innerHTML = '<div class="dim small">Reading camera settings\u2026</div>';
    try {
      const res = await this._request('tether.config.list');
      if (!res.ok) throw new Error(res.error || 'camera settings unavailable');
      this.configs = res.configs || [];
      this._renderConfigs();
      this.renderPassControls();
      this.renderFocusControls();
      if (K.ui && K.ui.renderLapseRampControls) K.ui.renderLapseRampControls();
    } catch (e) {
      this.configs = [];
      if (box) {
        box.innerHTML = '';
        const message = document.createElement('div');
        message.className = 'dim small';
        message.textContent = e.message;
        box.appendChild(message);
      }
    }
  },

  async setConfig(path, value, select) {
    if (select) select.disabled = true;
    try {
      const res = await this._request('tether.config.set', { path, value });
      if (!res.ok) throw new Error(res.error || 'setting rejected');
      const i = this.configs.findIndex((c) => c.path === path);
      if (i >= 0 && res.config) this.configs[i] = res.config;
      K.toast(`${res.config?.label || 'Camera setting'}: ${res.config?.current || value}`, 'ok');
      this._renderConfigs();
      this.renderPassControls();
      this.renderFocusControls();
      if (K.ui && K.ui.renderLapseRampControls) K.ui.renderLapseRampControls();
    } catch (e) {
      K.toast('Camera setting: ' + e.message, 'err', 4000);
      if (select) select.disabled = false;
    }
  },

  async setConfigQuiet(path, value) {
    const res = await this._request('tether.config.set', { path, value });
    if (!res.ok) throw new Error(res.error || 'setting rejected');
    const i = this.configs.findIndex((c) => c.path === path);
    if (i >= 0 && res.config) this.configs[i] = res.config;
    return res.config;
  },

  _renderConfigs() {
    const box = K.$('#tetherConfigs');
    if (!box) return;
    box.innerHTML = '';
    if (!this.connected) {
      box.innerHTML = '<div class="dim small">Connect to see camera settings.</div>';
      return;
    }
    if (!this.configs.length) {
      box.innerHTML = '<div class="dim small">This tether backend exposes no adjustable camera settings.</div>';
      return;
    }
    box.className = 'tether-configs';
    for (const config of this.configs) {
      const row = document.createElement('label');
      row.className = 'row';
      const label = document.createElement('span');
      label.textContent = config.label || config.path.split('/').pop();
      label.title = config.path;
      const select = document.createElement('select');
      const choices = config.choices && config.choices.length ? config.choices : [config.current];
      for (const value of choices) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        select.appendChild(option);
      }
      select.value = config.current;
      select.disabled = !!config.readonly;
      select.addEventListener('change', () => this.setConfig(config.path, select.value, select));
      row.append(label, select);
      box.appendChild(row);
    }
  },

  renderPassControls() {
    const box = K.$('#tetherPassPresets');
    if (!box) return;
    box.innerHTML = '';
    if (!this.passPresets.length) {
      box.innerHTML = '<div class="dim small">Add a pass, then choose only the settings it should override.</div>';
      return;
    }
    const configs = this.configs.filter((c) => c.choices?.length && !c.readonly && !/manualfocusdrive$/i.test(c.path));
    this.passPresets.forEach((preset, index) => {
      const card = document.createElement('div');
      card.className = 'pass-card';
      const head = document.createElement('div');
      head.className = 'pass-card-head';
      const name = document.createElement('input');
      name.type = 'text'; name.value = preset.name || `Pass ${index + 1}`; name.maxLength = 64;
      name.addEventListener('change', () => { preset.name = name.value.trim() || `Pass ${index + 1}`; K.ui.persistSettings(); });
      const remove = document.createElement('button');
      remove.className = 'btn danger'; remove.textContent = '×'; remove.title = 'Remove pass';
      remove.addEventListener('click', () => { this.passPresets.splice(index, 1); this.renderPassControls(); K.ui.persistSettings(); });
      head.append(name, remove); card.appendChild(head);
      if (!configs.length) {
        const hint = document.createElement('div'); hint.className = 'dim small';
        hint.textContent = this.connected ? 'This backend exposes no pass-adjustable settings.' : 'Connect to choose camera overrides.';
        card.appendChild(hint);
      }
      for (const config of configs) {
        const row = document.createElement('label'); row.className = 'row';
        const label = document.createElement('span'); label.textContent = config.label || config.path.split('/').pop();
        const select = document.createElement('select');
        const keep = document.createElement('option'); keep.value = ''; keep.textContent = '(keep current)'; select.appendChild(keep);
        for (const value of config.choices) {
          const option = document.createElement('option'); option.value = value; option.textContent = value; select.appendChild(option);
        }
        select.value = preset.overrides?.[config.path] || '';
        select.addEventListener('change', () => {
          preset.overrides = preset.overrides || {};
          if (select.value) preset.overrides[config.path] = select.value;
          else delete preset.overrides[config.path];
          K.ui.persistSettings();
        });
        row.append(label, select); card.appendChild(row);
      }
      box.appendChild(card);
    });
  },

  addPass(name = '') {
    this.passPresets.push({ name: name || `Pass ${this.passPresets.length + 1}`, overrides: {} });
    this.renderPassControls();
    K.ui.persistSettings();
  },

  makeBracket() {
    const config = this.configs.find((c) => /shutterspeed$/i.test(c.path) && c.choices?.length > 1);
    if (!config) { K.toast('No adjustable shutter-speed setting is available', 'err'); return; }
    const at = Math.max(0, config.choices.indexOf(config.current));
    const values = [config.choices[Math.max(0, at - 1)], config.choices[at], config.choices[Math.min(config.choices.length - 1, at + 1)]];
    this.passPresets = ['Bracket -', 'Bracket 0', 'Bracket +'].map((name, i) => ({ name, overrides: { [config.path]: values[i] } }));
    this.passesEnabled = true;
    K.$('#chkTetherPasses').checked = true;
    this.renderPassControls();
    K.ui.persistSettings();
  },

  renderFocusControls() {
    const box = K.$('#tetherFocus');
    if (!box) return;
    box.innerHTML = '';
    const config = this.configs.find((c) => /manualfocusdrive$/i.test(c.path) && c.choices?.length && !c.readonly);
    if (!config) { box.innerHTML = '<div class="dim small">This camera does not expose manual focus drive.</div>'; return; }
    const buttons = document.createElement('div'); buttons.className = 'focus-buttons';
    for (const value of config.choices) {
      const button = document.createElement('button'); button.className = 'btn'; button.textContent = value;
      button.addEventListener('click', () => this.setConfig(config.path, value, button));
      buttons.appendChild(button);
    }
    box.appendChild(buttons);
  },

  /* Fire the camera for capture `captureId`. Resolves when files are on disk. */
  async shoot(captureId) {
    if (!this.connected) return;
    K.status('Tether: firing camera…');
    try {
      const res = await this._request('tether.shoot', { captureId, context: K.production?.currentContext() }, 45000);
      K.status('');
      if (!res.ok) {
        K.toast('Tether capture failed: ' + (res.error || '?'), 'err', 4000);
        return;
      }
      if (res.files && res.files.length) {
        await K.frames.setRaw(captureId, res.files.join(';'));
      }
      if (this.useJpeg && res.jpeg) {
        const bin = atob(res.jpeg);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        await K.frames.updateCaptureBlob(captureId, new Blob([u8], { type: 'image/jpeg' }));
      }
    } catch (e) {
      K.status('');
      K.toast('Tether: ' + e.message, 'err', 4000);
    }
  },

  async shootPasses(captureId, presets = this.passPresets) {
    if (!this.connected || !presets.length) return;
    K.status(`Tether: capturing ${presets.length} passes…`);
    try {
      const res = await this._request('tether.shoot.passes', { captureId, passes: presets, context: K.production?.currentContext() }, Math.max(45000, presets.length * 45000));
      if (res.passes?.length) await K.frames.setPasses(captureId, res.passes);
      if (!res.ok) {
        K.toast('Pass capture failed: ' + (res.error || '?'), 'err', 5000);
        return res;
      }
      const jpeg = res.passes?.find((pass) => pass.jpeg)?.jpeg;
      if (this.useJpeg && jpeg) {
        const bin = atob(jpeg); const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        await K.frames.updateCaptureBlob(captureId, new Blob([u8], { type: 'image/jpeg' }));
      }
      K.toast(`${res.passes.length} exposure passes captured`, 'ok');
      return res;
    } catch (e) {
      K.toast('Tether passes: ' + e.message, 'err', 5000);
    } finally {
      K.status('');
    }
  },

  async _blobBase64(blob) {
    const url = await K.blobToDataURL(blob);
    return String(url).slice(String(url).indexOf(',') + 1);
  },

  async _folderRequest(type, payload, timeout = 120000) {
    if (!this.connected) throw new Error('Connect the local agent first');
    const res = await this._request(type, payload, timeout);
    if (!res.ok) throw new Error(res.error || `${type} failed`);
    return res;
  },

  async folderMirrorFrame(context, frame, captureId, blob) {
    return this._folderRequest('folder.mirrorFrame', {
      context, frame, captureId, data: await this._blobBase64(blob),
    });
  },

  folderWriteMeta(context, shot, takeMeta) {
    return this._folderRequest('folder.writeMeta', { context, shot, takeMeta });
  },

  async folderBackup(context, blob) {
    return this._folderRequest('folder.backup', { context, data: await this._blobBase64(blob) }, 300000);
  },

  async folderAudio(context, name, blob) {
    return this._folderRequest('folder.audio', { context, name, data: await this._blobBase64(blob) }, 300000);
  },

  folderReport(context, csv) {
    return this._folderRequest('folder.report', { context, csv });
  },

  folderEditorial(context, files) {
    return this._folderRequest('folder.editorial', { context, files });
  },

  publishObserver(jpeg, state) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'observer.publish', jpeg, state }));
  },

  async fetchSheet(url) {
    const res = await this._folderRequest('sheet.fetch', { url }, 30000);
    return res.text || '';
  },

  _setStatus() {
    const el = K.$('#tetherStatus');
    if (!el) return;
    el.textContent = this.connected ? `connected · ${this.backend}` : 'offline';
    el.style.color = this.connected ? 'var(--ok)' : '';
    K.$('#btnTether').textContent = this.connected ? 'Disconnect' : 'Connect';
    if (this.connecting) {
      el.textContent = 'connecting…';
      K.$('#btnTether').textContent = 'Cancel';
    }
    K.$('#tetherInfo').textContent = this.connected
      ? `Originals: ${this.dir}${this.productionRoot ? ` · Productions: ${this.productionRoot}` : ''}` : '';
  },
};
