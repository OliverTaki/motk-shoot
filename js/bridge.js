/* MOTK Shoot — external integration bridge.
 * No DMX / motion control is built in. Instead:
 *  1. WebSocket client: connects to an external bridge server (your rig controller)
 *     and mirrors every app event; accepts remote commands.
 *  2. window.motkshoot: JS API for scripts / embedding.
 * Protocol: docs/BRIDGE_PROTOCOL.md
 */
'use strict';
K.bridge = {
  ws: null,
  url: 'ws://localhost:8790',
  auto: false,
  connected: false,
  _retryTimer: null,

  /* events forwarded to the socket */
  _forward: new Set([
    'frame:captured', 'test:captured', 'frames:changed', 'captures:changed',
    'playback:started', 'playback:stopped',
    'playback:frame', 'project:opened', 'camera:started', 'camera:stopped',
    'mode:changed', 'audio:loaded',
  ]),

  init() {
    /* public JS API */
    window.motkshoot = {
      version: 1,
      capture: () => K.ui.capture(),
      testCapture: () => K.ui.capture({ test: true }),
      play: (opts) => K.playback.play(opts || {}),
      stop: () => K.playback.stop(),
      goToFrame: (i) => { K.playback.stop(); K.viewport.setMode('review', i); },
      live: () => { K.playback.stop(); K.viewport.setMode('live'); },
      deleteLast: () => K.timeline.deleteFrame(K.frames.count() - 1),
      setOnion: (opts) => { Object.assign(K.viewport.onion, opts); K.viewport._refreshAsync(); },
      frameCount: () => K.frames.count(),
      state: () => ({
        project: K.project.current ? { name: K.project.current.name, fps: K.project.current.fps } : null,
        frames: K.frames.count(),
        captures: K.frames.captures.length,
        exposures: K.frames.totalExposures(),
        mode: K.viewport.mode,
        playing: K.playback.playing,
        cameraRunning: K.camera.running,
      }),
      on: (type, fn) => K.bus.on(type, fn),
    };
  },

  onBusEvent(type, detail) {
    if (!this.connected || !this._forward.has(type)) return;
    this.send({ type: 'event', event: type, data: this._safe(detail) });
  },

  _safe(obj) {
    try { return JSON.parse(JSON.stringify(obj || {})); } catch { return {}; }
  },

  connect(url) {
    this.disconnect();
    this.url = url || this.url;
    this._log('connecting ' + this.url);
    try {
      this.ws = new WebSocket(this.url);
    } catch (e) {
      this._log('error: ' + e.message);
      this._setStatus(false);
      return;
    }
    this.ws.onopen = () => {
      this.connected = true;
      this._setStatus(true);
      this._log('connected');
      this.send({ type: 'hello', app: 'motkshoot', version: 1, state: window.motkshoot.state() });
    };
    this.ws.onclose = () => {
      const was = this.connected;
      this.connected = false;
      this._setStatus(false);
      if (was) this._log('disconnected');
      if (this.auto) {
        clearTimeout(this._retryTimer);
        this._retryTimer = setTimeout(() => this.connect(), 3000);
      }
    };
    this.ws.onerror = () => { this._log('socket error'); };
    this.ws.onmessage = (e) => this._onMessage(e.data);
  },

  disconnect() {
    clearTimeout(this._retryTimer);
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this._setStatus(false);
  },

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  },

  async _onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { this._log('bad json in'); return; }
    this._log('← ' + (msg.cmd || msg.type || '?'));
    const reply = (data) => this.send({ type: 'reply', id: msg.id, ...data });
    try {
      switch (msg.cmd) {
        case 'capture': await K.ui.capture(); reply({ ok: true, frames: K.frames.count() }); break;
        case 'testCapture': {
          const test = await K.ui.capture({ test: true });
          reply({ ok: true, captureId: test ? test.id : null, frames: K.frames.count(), captures: K.frames.captures.length });
          break;
        }
        case 'play': K.playback.play(msg.opts || {}); reply({ ok: true }); break;
        case 'stop': K.playback.stop(); reply({ ok: true }); break;
        case 'live': K.playback.stop(); K.viewport.setMode('live'); reply({ ok: true }); break;
        case 'goto': K.playback.stop(); K.viewport.setMode('review', msg.frame | 0); reply({ ok: true }); break;
        case 'deleteLast': await K.timeline.deleteFrame(K.frames.count() - 1); reply({ ok: true }); break;
        case 'state': reply({ ok: true, state: window.motkshoot.state() }); break;
        case 'setOnion': Object.assign(K.viewport.onion, msg.opts || {}); K.viewport._refreshAsync(); reply({ ok: true }); break;
        default:
          if (msg.type !== 'reply' && msg.type !== 'hello') reply({ ok: false, error: 'unknown cmd' });
      }
    } catch (e) {
      reply({ ok: false, error: String(e.message || e) });
    }
  },

  _setStatus(on) {
    const el = K.$('#bridgeStatus');
    el.textContent = on ? 'connected' : 'offline';
    el.style.color = on ? 'var(--ok)' : '';
    K.$('#btnBridge').textContent = on ? 'Disconnect' : 'Connect';
  },

  _log(line) {
    const el = K.$('#bridgeLog');
    const time = new Date().toTimeString().slice(0, 8);
    el.textContent += `[${time}] ${line}\n`;
    el.scrollTop = el.scrollHeight;
  },
};
