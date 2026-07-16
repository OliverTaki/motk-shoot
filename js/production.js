/* MOTK Shoot — production layer: productions, shots, takes, sheet sync,
 * disk mirroring, and session reporting. Production state is local metadata;
 * a take remains a normal MOTK Shoot project with three optional tag fields. */
'use strict';
K.production = {
  META_KEY: 'productionStateV1',
  state: { version: 1, activeId: '', productions: [] },
  _reporting: false,
  _autoTimer: null,

  async init() {
    const saved = await K.db.getMeta(this.META_KEY);
    if (saved && saved.version === 1) this.state = saved;
    this.state.productions = (this.state.productions || []).map((p) => this._normalizeProduction(p));
    if (!this.state.productions.some((p) => p.id === this.state.activeId)) {
      this.state.activeId = this.state.productions[0]?.id || '';
    }
    K.bus.on('project:opened', () => {
      this._restartAutoReport();
      if (K.ui?.renderProduction) K.ui.renderProduction();
    });
    K.bus.on('frame:captured', (data) => this.mirrorCapture(data).catch((e) => {
      console.warn('Production frame mirror:', e.message);
    }));
    this._restartAutoReport();
  },

  _normalizeProduction(p) {
    return {
      id: String(p.id || ('prod_' + Date.now().toString(36))),
      name: String(p.name || 'Production'),
      sheetRef: String(p.sheetRef || ''),
      contextUrl: String(p.contextUrl || p.sheetRef || ''),
      gasUrl: String(p.gasUrl || ''),
      writeBack: p.writeBack === true,
      root: String(p.root || ''),
      namingPattern: String(p.namingPattern || '{scene}_{shot}_T{take:2}'),
      autoReportMinutes: K.clamp(parseInt(p.autoReportMinutes, 10) || 5, 1, 1440),
      shots: (p.shots || []).map((s) => this._normalizeShot(s)),
      pending: Array.isArray(p.pending) ? p.pending : [],
      createdAt: p.createdAt || Date.now(),
      updatedAt: p.updatedAt || Date.now(),
      lastSyncAt: p.lastSyncAt || 0,
    };
  },

  _normalizeShot(s) {
    return {
      shotId: String(s.shotId || '').trim(),
      scene: String(s.scene || '').trim(),
      name: String(s.name || '').trim(),
      plannedFrames: Math.max(0, parseInt(s.plannedFrames, 10) || 0),
      fps: K.clamp(parseInt(s.fps, 10) || 12, 1, 60),
      status: String(s.status || 'planned').trim() || 'planned',
      notes: String(s.notes || ''),
      handover: String(s.handover || ''),
      bestTake: Math.max(0, parseInt(s.bestTake, 10) || 0),
      source: String(s.source || 'local'),
      dirty: !!s.dirty,
      updatedAt: s.updatedAt || Date.now(),
    };
  },

  active() { return this.state.productions.find((p) => p.id === this.state.activeId) || null; },
  shot(shotId) { return this.active()?.shots.find((s) => s.shotId === shotId) || null; },
  currentShot() {
    const p = K.project.current;
    return p?.productionId === this.state.activeId ? this.shot(p.shotId) : null;
  },
  currentContext() {
    const project = K.project.current;
    const production = this.active();
    if (!production || project?.productionId !== production.id || !project.shotId || !project.take) return null;
    const shot = this.shot(project.shotId);
    if (!shot) return null;
    return {
      productionId: production.id,
      production: production.name,
      productionRoot: production.root,
      shotId: shot.shotId,
      scene: shot.scene,
      take: project.take,
      projectId: project.id,
    };
  },

  async save() {
    const p = this.active();
    if (p) p.updatedAt = Date.now();
    await K.db.setMeta(this.META_KEY, this.state);
    K.bus.emit('production:changed', { activeId: this.state.activeId });
  },

  async createProduction(data = {}) {
    const name = String(data.name || 'New Production').trim() || 'New Production';
    const production = this._normalizeProduction({
      id: 'prod_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      name,
      sheetRef: data.sheetRef,
      contextUrl: data.contextUrl,
      gasUrl: data.gasUrl,
      writeBack: data.writeBack === true,
      root: data.root,
      namingPattern: data.namingPattern,
      shots: [], pending: [], createdAt: Date.now(), updatedAt: Date.now(),
    });
    this.state.productions.push(production);
    this.state.activeId = production.id;
    await this.save();
    this._restartAutoReport();
    return production;
  },

  async selectProduction(id) {
    if (!this.state.productions.some((p) => p.id === id)) return;
    this.state.activeId = id;
    await this.save();
    this._restartAutoReport();
  },

  async updateProduction(patch) {
    const production = this.active();
    if (!production) return;
    for (const key of ['name', 'sheetRef', 'contextUrl', 'gasUrl', 'root', 'namingPattern']) {
      if (patch[key] !== undefined) production[key] = String(patch[key]).trim();
    }
    if (patch.autoReportMinutes !== undefined) {
      production.autoReportMinutes = K.clamp(parseInt(patch.autoReportMinutes, 10) || 5, 1, 1440);
    }
    await this.save();
    this._restartAutoReport();
  },

  validateShotId(value) {
    const id = String(value || '').trim();
    if (!id) throw new Error('Shot ID is required');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) {
      throw new Error('Shot ID may use letters, numbers, dot, underscore, and hyphen');
    }
    return id;
  },

  async addShot(data) {
    const production = this.active();
    if (!production) throw new Error('Create a production first');
    const shotId = this.validateShotId(data.shotId);
    if (production.shots.some((s) => s.shotId === shotId)) throw new Error('Shot ID already exists');
    const shot = this._normalizeShot({ ...data, shotId, source: 'local', dirty: true, updatedAt: Date.now() });
    production.shots.push(shot);
    await this.save();
    await this._queue('note', {
      shot_id: shot.shotId, scene: shot.scene, name: shot.name, status: shot.status,
      planned_frames: shot.plannedFrames, fps: shot.fps, notes: shot.notes,
      handover: shot.handover, create: true,
    });
    return shot;
  },

  async updateShot(shotId, patch, { queue = true } = {}) {
    const shot = this.shot(shotId);
    if (!shot) throw new Error('Shot not found');
    for (const key of ['scene', 'name', 'status', 'notes', 'handover']) {
      if (patch[key] !== undefined) shot[key] = String(patch[key]);
    }
    if (patch.plannedFrames !== undefined) shot.plannedFrames = Math.max(0, parseInt(patch.plannedFrames, 10) || 0);
    if (patch.fps !== undefined) shot.fps = K.clamp(parseInt(patch.fps, 10) || 12, 1, 60);
    if (patch.bestTake !== undefined) shot.bestTake = Math.max(0, parseInt(patch.bestTake, 10) || 0);
    shot.dirty = true;
    shot.updatedAt = Date.now();
    await this.save();
    if (queue) await this._queue('note', {
      shot_id: shot.shotId, status: shot.status, planned_frames: shot.plannedFrames,
      fps: shot.fps, notes: shot.notes, handover: shot.handover,
    });
    return shot;
  },

  formatTakeName(shot, take, pattern = this.active()?.namingPattern) {
    const shortShot = shot.scene && shot.shotId.startsWith(shot.scene + '_')
      ? shot.shotId.slice(shot.scene.length + 1) : shot.shotId;
    const values = {
      scene: shot.scene || 'SCENE', shot: shortShot, shotId: shot.shotId,
      name: shot.name || shot.shotId, take: String(take),
    };
    const out = String(pattern || '{scene}_{shot}_T{take:2}').replace(/\{(scene|shot|shotId|name|take)(?::(\d+))?\}/g,
      (_, key, width) => String(values[key] ?? '').padStart(parseInt(width, 10) || 0, '0'));
    return out.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 120) || `Take_${take}`;
  },

  async nextTakeNumber(shotId) {
    const production = this.active();
    const projects = await K.project.listAll();
    return 1 + projects.reduce((max, p) => p.productionId === production?.id && p.shotId === shotId
      ? Math.max(max, parseInt(p.take, 10) || 0) : max, 0);
  },

  async newTake(shotId) {
    const production = this.active();
    const shot = this.shot(shotId);
    if (!production || !shot) throw new Error('Shot not found');
    const take = await this.nextTakeNumber(shotId);
    const name = this.formatTakeName(shot, take);
    const project = await K.project.create(name, { productionId: production.id, shotId, take });
    project.fps = shot.fps;
    project.sessionStartedAt = Date.now();
    await K.project.save();
    await this.writeFolderMeta().catch((e) => console.warn('Initial folder metadata:', e.message));
    K.toast(`Take ${take} ready: ${name}`, 'ok');
    return project;
  },

  parseCsv(text) {
    const rows = [];
    let row = [], field = '', quoted = false;
    const src = String(text || '').replace(/^\uFEFF/, '');
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (quoted) {
        if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') quoted = false;
        else field += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
      else field += ch;
    }
    if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
    const header = (rows.shift() || []).map((h) => h.trim().toLowerCase());
    return rows.filter((r) => r.some((v) => String(v).trim())).map((values) => {
      const obj = {};
      header.forEach((h, i) => { if (h) obj[h] = values[i] ?? ''; });
      return obj;
    });
  },

  _shotFromRow(row) {
    return this._normalizeShot({
      shotId: row.shot_id || row.shotId || row.shotid || row.id,
      scene: row.scene,
      name: row.name || row.shot_name || row.shotName,
      plannedFrames: row.planned_frames || row.plannedFrames || row.plannedframes,
      fps: row.fps,
      status: row.status,
      notes: row.notes,
      handover: row.handover,
      bestTake: row.best_take || row.bestTake,
      source: row.source || 'context', dirty: false, updatedAt: Date.now(),
    });
  },

  async _ensureContextProduction({ name = 'Imported production', id = '', contextUrl = '' } = {}) {
    let production = id ? this.state.productions.find((item) => item.id === id) : null;
    if (!production && name) production = this.state.productions.find((item) => item.name === name);
    if (!production) {
      production = this._normalizeProduction({
        id: id || ('prod_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)),
        name, contextUrl, sheetRef: contextUrl, shots: [], pending: [], createdAt: Date.now(), updatedAt: Date.now(),
      });
      this.state.productions.push(production);
    }
    if (contextUrl) { production.contextUrl = contextUrl; production.sheetRef = contextUrl; }
    this.state.activeId = production.id;
    await this.save();
    return production;
  },

  async importContext(data, { name = 'Imported production', url = '' } = {}) {
    const source = Array.isArray(data) ? { shots: data } : (data || {});
    const meta = source.production && typeof source.production === 'object' ? source.production : source;
    const shots = Array.isArray(source.shots) ? source.shots : (Array.isArray(meta.shots) ? meta.shots : []);
    const production = await this._ensureContextProduction({
      id: String(meta.id || meta.productionId || '').trim(),
      name: String(meta.name || meta.productionName || name || 'Imported production').trim(),
      contextUrl: url,
    });
    if (meta.namingPattern) production.namingPattern = String(meta.namingPattern);
    if (meta.root) production.root = String(meta.root);
    const result = await this.mergeRows(shots);
    production.lastSyncAt = Date.now();
    await this.save();
    return { ...result, productionId: production.id, shots: production.shots.length };
  },

  async importContextText(text, { name = 'Imported production', url = '' } = {}) {
    const src = String(text || '').replace(/^\uFEFF/, '').trim();
    if (!src) throw new Error('The context file is empty');
    if (src.startsWith('{') || src.startsWith('[')) {
      return this.importContext(JSON.parse(src), { name, url });
    }
    await this._ensureContextProduction({ name, contextUrl: url });
    const result = await this.mergeRows(this.parseCsv(src));
    return { ...result, productionId: this.active().id, shots: this.active().shots.length };
  },

  async pullContext(url = this.active()?.contextUrl) {
    if (!url) throw new Error('Context URL is required');
    let text;
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      text = await response.text();
    } catch (directError) {
      if (!K.tether.connected) throw new Error(`Context fetch failed (${directError.message})`);
      text = await K.tether.fetchSheet(url);
    }
    const result = await this.importContextText(text, { name: this.active()?.name || 'Imported production', url });
    K.toast(`Context refreshed: ${result.shots} shots`, 'ok');
    return result;
  },

  async mergeRows(rows) {
    const production = this.active();
    if (!production) throw new Error('Create a production first');
    let added = 0, updated = 0;
    for (const row of rows) {
      let incoming;
      try { incoming = this._shotFromRow(row); incoming.shotId = this.validateShotId(incoming.shotId); }
      catch { continue; }
      const existing = production.shots.find((s) => s.shotId === incoming.shotId);
      if (!existing) { production.shots.push(incoming); added++; continue; }
      for (const key of ['scene', 'name', 'plannedFrames', 'fps', 'status', 'bestTake']) existing[key] = incoming[key];
      if (!existing.dirty || incoming.notes) existing.notes = incoming.notes;
      if (!existing.dirty || incoming.handover) existing.handover = incoming.handover;
      existing.source = 'sheet'; existing.updatedAt = Date.now(); updated++;
    }
    production.lastSyncAt = Date.now();
    await this.save();
    return { added, updated };
  },

  async pullPublishedCsv(url = this.active()?.sheetRef) {
    const production = this.active();
    if (!production) throw new Error('Create a production first');
    if (!url) throw new Error('Published CSV URL is required');
    let text;
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      text = await response.text();
    } catch (directError) {
      if (!K.tether.connected) throw new Error(`CSV fetch failed (${directError.message}); connect the local agent for the CORS fallback`);
      text = await K.tether.fetchSheet(url);
    }
    const result = await this.mergeRows(this.parseCsv(text));
    K.toast(`Sheet: ${result.added} added, ${result.updated} updated`, 'ok');
    return result;
  },

  _gasUrl(action) {
    const base = this.active()?.gasUrl;
    if (!base) throw new Error('MOTK GAS URL is not configured');
    const url = new URL(base);
    url.searchParams.set('action', action);
    return url.toString();
  },

  async pullGas() {
    const response = await fetch(this._gasUrl('shots'), { cache: 'no-store' });
    if (!response.ok) throw new Error(`GAS HTTP ${response.status}`);
    const data = await response.json();
    const rows = Array.isArray(data) ? data : data.shots;
    if (!Array.isArray(rows)) throw new Error('GAS response has no shots array');
    const result = await this.mergeRows(rows);
    await this.flushPending();
    K.toast(`Live sync: ${result.added} added, ${result.updated} updated`, 'ok');
    return result;
  },

  async _postGas(action, payload) {
    const response = await fetch(this._gasUrl(action), {
      method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, ...payload }), redirect: 'follow',
    });
    if (!response.ok) throw new Error(`GAS HTTP ${response.status}`);
    const text = await response.text();
    if (text) {
      try { const data = JSON.parse(text); if (data.ok === false) throw new Error(data.error || 'GAS rejected update'); } catch (e) {
        if (e instanceof SyntaxError) return text;
        throw e;
      }
    }
    return text;
  },

  async _queue(action, payload) {
    const production = this.active();
    if (!production) return;
    production.pending.push({ id: 'q_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), action, payload, at: Date.now() });
    if (production.pending.length > 500) production.pending.splice(0, production.pending.length - 500);
    await this.save();
  },

  async flushPending() {
    const production = this.active();
    if (!production?.gasUrl || !production.pending.length) return { sent: 0, remaining: production?.pending.length || 0 };
    let sent = 0;
    while (production.pending.length) {
      const item = production.pending[0];
      try { await this._postGas(item.action, item.payload); }
      catch { break; }
      production.pending.shift(); sent++;
    }
    await this.save();
    return { sent, remaining: production.pending.length };
  },

  async reportRows() {
    const production = this.active();
    if (!production) return [];
    const projects = await K.project.listAll();
    return production.shots.map((shot) => {
      const takes = projects.filter((p) => p.productionId === production.id && p.shotId === shot.shotId)
        .sort((a, b) => (a.take || 0) - (b.take || 0));
      const latest = takes[takes.length - 1];
      const current = latest?.id === K.project.current?.id ? this.takeResult() : latest?.lastReport;
      return {
        shot_id: shot.shotId, scene: shot.scene, name: shot.name, status: shot.status,
        planned_frames: shot.plannedFrames, fps: shot.fps, takes: takes.length,
        best_take: shot.bestTake || '', frames: current?.frames || 0,
        duration_s: current?.duration_s || 0, raw_count: current?.raw_count || 0,
        notes: shot.notes, handover: shot.handover,
        folder: `${production.name}/${shot.shotId}`, updated_at: new Date(shot.updatedAt).toISOString(),
      };
    });
  },

  _csvEscape(value) { return '"' + String(value ?? '').replace(/"/g, '""') + '"'; },
  async reportCsv() {
    const columns = ['shot_id', 'scene', 'name', 'status', 'planned_frames', 'fps', 'takes', 'best_take', 'frames', 'duration_s', 'raw_count', 'notes', 'handover', 'folder', 'updated_at'];
    const rows = await this.reportRows();
    return columns.join(',') + '\r\n' + rows.map((row) => columns.map((c) => this._csvEscape(row[c])).join(',')).join('\r\n') + '\r\n';
  },

  takeResult() {
    const project = K.project.current;
    const context = this.currentContext();
    if (!context) return null;
    const raw = new Set(K.frames.captures.flatMap((c) => String(c.raw || '').split(';').filter(Boolean)));
    return {
      production_id: context.productionId, shot_id: context.shotId, take: context.take,
      project_id: project.id, project_name: project.name, fps: project.fps,
      frames: K.frames.count(), exposures: K.frames.totalExposures(),
      duration_s: +(K.frames.totalExposures() / project.fps).toFixed(4),
      raw_count: raw.size, captures: K.frames.captures.length,
      folder: `${this.active().name}/${context.shotId}`,
      started_at: new Date(project.sessionStartedAt || project.createdAt).toISOString(),
      updated_at: new Date().toISOString(),
    };
  },

  sessionResult() {
    const linked = this.takeResult();
    if (linked) return linked;
    const project = K.project.current;
    const raw = new Set(K.frames.captures.flatMap((capture) => String(capture.raw || '').split(';').filter(Boolean)));
    return {
      production_id: '', shot_id: '', take: project.take || '',
      project_id: project.id, project_name: project.name, fps: project.fps,
      frames: K.frames.count(), exposures: K.frames.totalExposures(),
      duration_s: +(K.frames.totalExposures() / project.fps).toFixed(4),
      raw_count: raw.size, captures: K.frames.captures.length,
      started_at: new Date(project.sessionStartedAt || project.createdAt).toISOString(),
      updated_at: new Date().toISOString(),
    };
  },

  shotMeta() {
    const production = this.active(), shot = this.currentShot();
    if (!production || !shot) return null;
    return { ...shot, productionId: production.id, productionName: production.name, sheetRef: production.sheetRef, lastSyncAt: production.lastSyncAt };
  },

  takeMeta() {
    const result = this.takeResult();
    if (!result) return null;
    return {
      ...result,
      holds: K.frames.activeEdit().items.map((it) => ({ id: it.id, hold: it.hold })),
      edits: JSON.parse(JSON.stringify(K.frames.edits)),
      activeEditId: K.frames.activeEditId,
      cameraConfigs: (K.tether.configs || []).map((c) => ({ path: c.path, label: c.label, current: c.current })),
    };
  },

  async mirrorCapture({ id }) {
    const context = this.currentContext();
    if (!context || !K.tether.connected) return;
    const blob = await K.frames.getBlob(id);
    if (!blob) return;
    const captureNumber = K.frames.captures.findIndex((capture) => capture.id === id) + 1;
    await K.tether.folderMirrorFrame(context, Math.max(1, captureNumber), id, blob);
  },

  async writeFolderMeta() {
    const context = this.currentContext();
    if (!context || !K.tether.connected) return false;
    await K.tether.folderWriteMeta(context, this.shotMeta(), this.takeMeta());
    return true;
  },

  async _mirrorAudio() {
    const context = this.currentContext();
    if (!context || !K.tether.connected || !K.audio.hasAudio()) return;
    const rec = await K.db.get('audio', K.project.current.id);
    if (rec?.tracks?.length) {
      for (const track of rec.tracks) await K.tether.folderAudio(context, track.name || `${track.id}.bin`, track.blob);
    } else if (rec?.blob) await K.tether.folderAudio(context, rec.name || 'track.bin', rec.blob);
  },

  async endSession({ backup = true, downloadReport = false, quiet = false } = {}) {
    if (this._reporting) return;
    const context = this.currentContext();
    this._reporting = true;
    try {
      K.status('Ending production session…');
      const result = this.sessionResult();
      K.project.current.lastReport = result;
      await K.project.save();
      if (context) await this.writeFolderMeta();
      if (context) await this._mirrorAudio();
      const csv = await this.reportCsv();
      if (context && K.tether.connected) await K.tether.folderReport(context, csv);
      if (K.localFolder) await K.localFolder.writeSession(result, csv).catch((e) => console.warn('Local session record:', e.message));
      if (downloadReport) K.downloadBlob('production_report.csv', new Blob([csv], { type: 'text/csv' }));
      if (backup && context && K.tether.connected) {
        const zip = await K.exporter.buildProjectBackup();
        await K.tether.folderBackup(context, zip);
      }
      const production = this.active();
      if (production?.writeBack && production?.gasUrl) {
        try { await this._postGas('take-results', result); }
        catch { await this._queue('take-results', result); }
        await this.flushPending();
      }
      if (!quiet) K.toast(context
        ? 'Session result, metadata, and backup written'
        : 'Session result saved', 'ok', 4000);
    } finally {
      K.status('');
      this._reporting = false;
    }
  },

  async downloadReport() {
    const csv = await this.reportCsv();
    K.downloadBlob('production_report.csv', new Blob([csv], { type: 'text/csv' }));
  },

  _restartAutoReport() {
    if (this._autoTimer) clearInterval(this._autoTimer);
    this._autoTimer = null;
    const production = this.active();
    if (!production) return;
    this._autoTimer = setInterval(() => this.endSession({ backup: false, quiet: true }).catch((e) => {
      console.warn('Auto-report:', e.message);
    }), production.autoReportMinutes * 60000);
  },
};
