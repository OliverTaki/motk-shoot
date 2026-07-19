/* MOTK Shoot — project lifecycle: create/open/save/rename/delete, autosave */
'use strict';
K.project = {
  current: null,
  SESSION_KEY: 'motkShootActiveProjectId',
  START_MODE_KEY: 'motkShootProjectStartMode',
  LAST_PROJECT_KEY: 'motkShootLastProjectId',

  startMode() {
    try {
      return localStorage.getItem(this.START_MODE_KEY) === 'resume-last' ? 'resume-last' : 'new-session';
    } catch { return 'new-session'; }
  },

  setStartMode(mode) {
    const value = mode === 'resume-last' ? 'resume-last' : 'new-session';
    try { localStorage.setItem(this.START_MODE_KEY, value); }
    catch {}
    return value;
  },

  _lastProjectId() {
    try { return localStorage.getItem(this.LAST_PROJECT_KEY) || ''; }
    catch { return ''; }
  },

  _sessionId() {
    try { return sessionStorage.getItem(this.SESSION_KEY) || ''; }
    catch { return ''; }
  },

  _rememberForThisTab(id) {
    try { sessionStorage.setItem(this.SESSION_KEY, id); }
    catch {}
    try { localStorage.setItem(this.LAST_PROJECT_KEY, id); }
    catch {}
  },

  _freshSessionName() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `Shoot ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}`;
  },

  _defaultSettings() {
    return {
      onion: { on: true, frames: 1, alpha: 0.35, mode: 'normal', next: false, offsetX: 0, offsetY: 0 },
      guides: { grid: 'off', cross: false, safe: false, mask: 'off', maskAlpha: 0.7 },
      captureHold: 1,
      jpegQuality: 0.92,
      resPreset: '1920x1080',
      cameraId: '',
      mirrorH: false, mirrorV: false, rot180: false, photoMode: false,
      loop: false,
      tetherPasses: { enabled: false, presets: [] },
      lapseRamp: { enabled: false, path: '', endValue: '', shots: 24 },
      audio: { enabled: true, scrub: true, volume: 1 },
      aeRoundtrip: { initial: 0, delivery: 0, returns: [], activeReturnId: '', plannedFrames: 120 },
    };
  },

  async init() {
    // A reload in this tab resumes the active shoot. A new browser tab/session
    // starts clean: older captures stay stored but are never shown until the
    // operator explicitly opens their project.
    const candidateId = this._sessionId() || (this.startMode() === 'resume-last' ? this._lastProjectId() : '');
    if (candidateId) {
      const p = await K.db.get('projects', candidateId);
      if (p) { await this.open(p.id); return; }
    }
    await this.create(this._freshSessionName(), { freshSession: true });
  },

  async create(name, tags = {}) {
    const p = {
      id: 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name || 'Untitled',
      fps: 12,
      edits: [{ id: 'e1', name: 'Edit 1', items: [] }],
      activeEditId: 'e1',
      layers: [],
      settings: this._defaultSettings(),
      audioName: '',
      audioOffset: 0,
      productionId: tags.productionId || '',
      shotId: tags.shotId || '',
      take: Math.max(0, parseInt(tags.take, 10) || 0),
      freshSession: tags.freshSession === true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await K.db.put('projects', p);
    this._rememberForThisTab(p.id);
    this.current = p;
    K.frames.reset({ captures: [], edits: p.edits, activeEditId: p.activeEditId });
    await K.layers.reset([]);
    K.audio.clear(false);
    K.audio.offsetFrames = 0;
    K.bus.emit('project:opened', { id: p.id });
    return p;
  },

  async open(id) {
    const p = await K.db.get('projects', id);
    if (!p) { K.toast('Project not found', 'err'); return; }
    if (!p.settings) p.settings = this._defaultSettings();
    this.current = p;
    this._rememberForThisTab(id);

    // captures bin: every stored frame, chronological (= "as shot")
    const recs = await K.db.framesOfProject(id);
    recs.sort((a, b) => (a.capturedAt || 0) - (b.capturedAt || 0));
    const captures = recs.map((r) => ({
      id: r.id, w: r.w, h: r.h, thumb: r.thumb, note: r.note || '',
      raw: r.raw || '', passes: r.passes || [], shotHold: r.shotHold || r.hold || 1,
      isTest: !!r.isTest, capturedAt: r.capturedAt || 0,
    }));
    // migrate v1 projects (frameOrder + per-record hold) to the edits model
    let edits = p.edits;
    if (!edits || !edits.length) {
      const byId = new Map(recs.map((r) => [r.id, r]));
      const order = (p.frameOrder || []).filter((fid) => byId.has(fid));
      const inOrder = new Set(order);
      const orphans = recs.filter((r) => !inOrder.has(r.id)).map((r) => r.id);
      edits = [{
        id: 'e1', name: 'Edit 1',
        items: [...order, ...orphans].map((fid) => {
          const r = byId.get(fid);
          return { id: fid, hold: (r && (r.hold || r.shotHold)) || 1 };
        }),
      }];
      p.edits = edits;
      p.activeEditId = 'e1';
    }
    K.frames.reset({ captures, edits, activeEditId: p.activeEditId });
    await K.layers.reset(p.layers || []);

    K.audio.clear(false);
    K.audio.offsetFrames = p.audioOffset || 0;
    await K.audio.restore(id).catch(() => {});

    K.bus.emit('project:opened', { id });
  },

  async save() {
    const p = this.current;
    if (!p) return;
    p.edits = K.frames.edits;
    p.activeEditId = K.frames.activeEditId;
    p.layers = K.layers.serialize();
    delete p.frameOrder; // v1 field
    p.audioOffset = K.audio.offsetFrames;
    p.updatedAt = Date.now();
    await K.db.put('projects', p);
  },

  saveSoon: null, // debounced, assigned below

  async rename(id, name) {
    const p = id === this.current.id ? this.current : await K.db.get('projects', id);
    if (!p) return;
    p.name = name;
    p.updatedAt = Date.now();
    await K.db.put('projects', p);
    if (p.id === this.current.id) K.bus.emit('project:renamed', { name });
  },

  async remove(id) {
    await K.db.deleteProjectData(id);
    if (this.current && this.current.id === id) {
      await this.create(this._freshSessionName(), { freshSession: true });
    }
  },

  async listAll() {
    const all = await K.db.getAll('projects');
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  },
};
K.project.saveSoon = K.debounce(() => K.project.save(), 400);
