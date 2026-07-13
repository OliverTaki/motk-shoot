/* MOTK Shoot — project lifecycle: create/open/save/rename/delete, autosave */
'use strict';
K.project = {
  current: null,

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
    };
  },

  async init() {
    const lastId = await K.db.getMeta('lastProjectId');
    if (lastId) {
      const p = await K.db.get('projects', lastId);
      if (p) { await this.open(p.id); return; }
    }
    const all = await K.db.getAll('projects');
    if (all.length) { await this.open(all.sort((a, b) => b.updatedAt - a.updatedAt)[0].id); return; }
    await this.create('Untitled');
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
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await K.db.put('projects', p);
    await K.db.setMeta('lastProjectId', p.id);
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
    await K.db.setMeta('lastProjectId', id);

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
      const all = await K.db.getAll('projects');
      if (all.length) await this.open(all.sort((a, b) => b.updatedAt - a.updatedAt)[0].id);
      else await this.create('Untitled');
    }
  },

  async listAll() {
    const all = await K.db.getAll('projects');
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  },
};
K.project.saveSoon = K.debounce(() => K.project.save(), 400);
