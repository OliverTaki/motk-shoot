/* MOTK Shoot — camera: getUserMedia stream, device management, capture, manual controls */
'use strict';
K.camera = {
  stream: null,
  track: null,
  video: document.createElement('video'),
  source: 'media',       // 'media' (getUserMedia) | 'tether' (agent preview)
  tetherBitmap: null,
  devices: [],
  running: false,
  photoMode: false,      // use ImageCapture.takePhoto for full sensor resolution
  jpegQuality: 0.92,
  mirrorH: false,
  mirrorV: false,
  rot180: false,
  _captureCanvas: document.createElement('canvas'),
  _imageCapture: null,
  _photoCapabilities: null,
  _lastCaptureInfo: null,
  _releasedForVisibility: false,

  init() {
    this.video.muted = true;
    this.video.playsInline = true;
    document.addEventListener('visibilitychange', () => this._handleVisibility(document.hidden));
    window.addEventListener('pagehide', () => this.stop());
  },

  _handleVisibility(hidden) {
    if (hidden && this.source === 'media' && this.running) {
      this._releasedForVisibility = true;
      this.stop();
    } else if (!hidden && this._releasedForVisibility) {
      this._releasedForVisibility = false;
      K.toast('Camera was released for Windows Hello / background use. Press Restart when ready to shoot.');
    }
  },

  async listDevices() {
    const all = await navigator.mediaDevices.enumerateDevices();
    // Composite Windows Hello webcams expose a separate IR/authentication
    // interface. Keep that interface available to Windows while the shooting
    // app uses only the normal RGB/UVC interface.
    const faceAuth = /face authentication|windows hello/i;
    this.devices = all.filter((d) => d.kind === 'videoinput' && !faceAuth.test(d.label || ''));
    return this.devices;
  },

  isAppleMobile() {
    const ua = navigator.userAgent || '';
    return /iPhone|iPad|iPod/i.test(ua)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  },

  /* Keep every physical lens in Settings, but make the phone CAM sheet a
     short logical rear/front choice instead of an implementation-detail list. */
  compactDevices(devices = this.devices, { appleMobile = this.isAppleMobile() } = {}) {
    if (!appleMobile || devices.length < 3) return devices.slice();
    const normalized = (device) => (device.label || '').toLowerCase();
    const front = devices.filter((device) => /front|user|facetime|truedepth/.test(normalized(device)));
    const rear = devices.filter((device) => /back|rear|environment|wide|telephoto|ultra/.test(normalized(device)) && !front.includes(device));
    const other = devices.filter((device) => !front.includes(device) && !rear.includes(device));
    const choose = (items, scores) => items.slice().sort((a, b) => {
      const score = (device) => scores.reduce((total, [pattern, value]) => total + (pattern.test(normalized(device)) ? value : 0), 0);
      return score(b) - score(a);
    })[0];
    const rearChoice = choose(rear, [[/triple/, 80], [/dual wide/, 70], [/dual/, 60], [/back camera$/, 50], [/wide/, 20], [/ultra|telephoto/, -20]]);
    const frontChoice = choose(front, [[/front camera$/, 60], [/front/, 40], [/facetime/, 20], [/truedepth/, 10]]);
    const compact = [];
    if (rearChoice) compact.push({ ...rearChoice, label: 'Back camera' });
    if (frontChoice) compact.push({ ...frontChoice, label: 'Front camera' });
    compact.push(...other);
    return compact.length ? compact : devices.slice(0, 2);
  },

  async _refreshPhotoCapabilities() {
    this._photoCapabilities = null;
    if (!this._imageCapture || !this._imageCapture.getPhotoCapabilities) return null;
    try { this._photoCapabilities = await this._imageCapture.getPhotoCapabilities(); }
    catch (error) { console.warn('Photo capabilities unavailable', error); }
    return this._photoCapabilities;
  },

  photoStatus() {
    const settings = this.settings() || {};
    const caps = this._photoCapabilities || {};
    return {
      supported: !!(this._imageCapture && this._imageCapture.takePhoto),
      enabled: !!this.photoMode,
      streamWidth: settings.width || 0,
      streamHeight: settings.height || 0,
      maxPhotoWidth: caps.imageWidth?.max || 0,
      maxPhotoHeight: caps.imageHeight?.max || 0,
      last: this._lastCaptureInfo,
    };
  },

  async start(deviceId, resPreset) {
    const leavingTether = this.source === 'tether';
    this.stop();
    // Switching away from tether must fully stop the stream before the webcam
    // opens, or late tether frames stomp the new source.
    if (leavingTether && K.tether) { try { await K.tether.stopLiveView(); } catch {} }
    if (deviceId === '__tether__') {
      if (!K.tether.connected) {
        const ok = K.tether.ensureCompanion ? await K.tether.ensureCompanion() : false;
        if (!ok) throw new Error('Companion is not running or not paired - open the CAMERA panel to connect');
      }
      this.source = 'tether';
      await K.tether.startLiveView();
      return;
    }
    this.source = 'media';
    this._lastMediaId = deviceId || this._lastMediaId || '';
    const [w, h] = (resPreset || '1920x1080').split('x').map(Number);
    const constraints = {
      audio: false,
      video: {
        width: { ideal: w },
        height: { ideal: h },
        frameRate: { ideal: 30 },
      },
    };
    if (deviceId) constraints.video.deviceId = { exact: deviceId };
    else if (this.isAppleMobile()) constraints.video.facingMode = { ideal: 'environment' };
    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      // Turn getUserMedia's terse errors into something the user can act on.
      const name = err && err.name;
      if (name === 'NotReadableError' || name === 'TrackStartError')
        throw new Error('Camera is busy — it is already open in another app or browser tab. Close that and press Start camera.');
      if (name === 'NotAllowedError' || name === 'SecurityError')
        throw new Error('Camera permission is blocked for this page. Allow camera access, then press Start camera.');
      if (name === 'NotFoundError')
        throw new Error('No camera found. A DSLR/mirrorless (e.g. SIGMA fp) must be in webcam/UVC USB mode to appear here.');
      if (name === 'OverconstrainedError')
        throw new Error('This camera does not support the chosen resolution — pick a lower one in the CAM panel.');
      throw err;
    }
    this.track = this.stream.getVideoTracks()[0];
    this.video.srcObject = this.stream;
    await this.video.play();
    this._imageCapture = (window.ImageCapture && this.track)
      ? new ImageCapture(this.track) : null;
    await this._refreshPhotoCapabilities();
    this.running = true;
    this.track.addEventListener('ended', () => {
      this.running = false;
      K.bus.emit('camera:stopped', {});
    });
    K.bus.emit('camera:started', { settings: this.track.getSettings() });
  },

  stop() {
    const wasTether = this.source === 'tether';
    if (wasTether && K.tether) K.tether.stopLiveView().catch(() => {});
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
      this.track = null;
      this._imageCapture = null;
      this._photoCapabilities = null;
    }
    if (this.tetherBitmap) {
      this.tetherBitmap.close();
      this.tetherBitmap = null;
    }
    if (this.running) {
      this.running = false;
      K.bus.emit('camera:stopped', {});
    }
  },

  settings() {
    if (this.source === 'tether' && this.tetherBitmap) {
      return { width: this.tetherBitmap.width, height: this.tetherBitmap.height, deviceId: '__tether__' };
    }
    return this.track ? this.track.getSettings() : null;
  },

  capabilities() {
    if (!this.track || !this.track.getCapabilities) return {};
    try { return this.track.getCapabilities(); } catch { return {}; }
  },

  async applyAdvanced(obj) {
    if (!this.track) return;
    await this.track.applyConstraints({ advanced: [obj] });
  },

  async resetAuto() {
    if (!this.track) return;
    const caps = this.capabilities();
    const adv = {};
    if (caps.focusMode && caps.focusMode.includes('continuous')) adv.focusMode = 'continuous';
    if (caps.exposureMode && caps.exposureMode.includes('continuous')) adv.exposureMode = 'continuous';
    if (caps.whiteBalanceMode && caps.whiteBalanceMode.includes('continuous')) adv.whiteBalanceMode = 'continuous';
    if (caps.zoom) adv.zoom = caps.zoom.min;
    try { await this.track.applyConstraints({ advanced: [adv] }); } catch (e) { console.warn(e); }
  },

  hasTransform() { return this.mirrorH || this.mirrorV || this.rot180; },

  acceptTetherFrame(bitmap) {
    if (this.source !== 'tether') { bitmap.close(); return; }
    if (this.tetherBitmap) this.tetherBitmap.close();
    this.tetherBitmap = bitmap;
    if (!this.running) {
      this.running = true;
      K.bus.emit('camera:started', { settings: this.settings() });
    }
    K.viewport.invalidate();
  },

  tetherStopped() {
    if (this.source !== 'tether') return;
    if (this.tetherBitmap) { this.tetherBitmap.close(); this.tetherBitmap = null; }
    if (this.running) {
      this.running = false;
      K.bus.emit('camera:stopped', {});
    }
  },

  /* Capture one frame -> {blob, w, h}. Applies mirror/rotate baked into the file. */
  async capture() {
    if (!this.running) throw new Error('Camera is not running');
    let source = null; // ImageBitmap or video element
    let sw, sh;

    if (this.photoMode && this._imageCapture && this._imageCapture.takePhoto) {
      try {
        const caps = this._photoCapabilities || {};
        const photoSettings = {};
        if (caps.imageWidth?.max) photoSettings.imageWidth = caps.imageWidth.max;
        if (caps.imageHeight?.max) photoSettings.imageHeight = caps.imageHeight.max;
        let photoBlob;
        try { photoBlob = await this._imageCapture.takePhoto(photoSettings); }
        catch (firstError) {
          if (!Object.keys(photoSettings).length) throw firstError;
          photoBlob = await this._imageCapture.takePhoto();
        }
        if (!this.hasTransform()) {
          const bmp = await createImageBitmap(photoBlob);
          const out = { blob: photoBlob, w: bmp.width, h: bmp.height };
          this._lastCaptureInfo = { method: 'device-photo', width: bmp.width, height: bmp.height, mime: photoBlob.type || '' };
          bmp.close();
          return out;
        }
        source = await createImageBitmap(photoBlob);
        sw = source.width; sh = source.height;
        this._lastCaptureInfo = { method: 'device-photo', width: sw, height: sh, mime: photoBlob.type || '' };
      } catch (e) {
        console.warn('takePhoto failed, falling back to video frame', e);
      }
    }
    if (!source) {
      if (this.source === 'tether') {
        source = this.tetherBitmap;
        if (!source) throw new Error('Tether live view has no frames yet');
        sw = source.width; sh = source.height;
        this._lastCaptureInfo = { method: 'tether-preview', width: sw, height: sh, mime: 'image/jpeg' };
      } else {
        source = this.video;
        sw = this.video.videoWidth; sh = this.video.videoHeight;
        if (!sw || !sh) throw new Error('Video stream has no frames yet');
        this._lastCaptureInfo = { method: 'live-view-frame', width: sw, height: sh, mime: 'image/jpeg' };
      }
    }

    const c = this._captureCanvas;
    c.width = sw; c.height = sh;
    const ctx = c.getContext('2d');
    ctx.save();
    ctx.translate(sw / 2, sh / 2);
    if (this.rot180) ctx.rotate(Math.PI);
    ctx.scale(this.mirrorH ? -1 : 1, this.mirrorV ? -1 : 1);
    ctx.drawImage(source, -sw / 2, -sh / 2, sw, sh);
    ctx.restore();
    if (source instanceof ImageBitmap && source !== this.tetherBitmap) source.close();

    const blob = await K.canvasToBlob(c, 'image/jpeg', this.jpegQuality);
    if (!blob) throw new Error('JPEG encoding failed');
    return { blob, w: sw, h: sh };
  },
};
