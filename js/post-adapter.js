/* MOTK Shoot - shared non-destructive post-production exchange boundary. */
'use strict';
K.postAdapter = {
  create(config) {
    return {
      ...config,
      exchangeHandle: null,
      permission: 'none',
      _seenReturns: new Set(),
      _watchTimer: null,

      supported() { return typeof window.showDirectoryPicker === 'function'; },
      _safe(value, fallback = 'MOTK') {
        return String(value || fallback).normalize('NFKC').trim()
          .replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/\s+/g, '_').slice(0, 80) || fallback;
      },
      _stamp() { return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14); },
      _enc(value) { return new TextEncoder().encode(String(value)); },
      _json(value) { return this._enc(JSON.stringify(value, null, 2) + '\n'); },
      _ext(name, type = '') {
        const match = String(name || '').match(/\.([A-Za-z0-9]{1,8})$/);
        if (match) return match[1].toLowerCase();
        if (type.includes('jpeg')) return 'jpg';
        if (type.includes('png')) return 'png';
        if (type.includes('webm')) return 'webm';
        if (type.includes('mp4')) return 'mp4';
        if (type.includes('quicktime')) return 'mov';
        return 'bin';
      },
      _mediaKind(file) {
        const type = String(file?.type || '').toLowerCase();
        const ext = this._ext(file?.name || '', type);
        if (type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'gif', 'tif', 'tiff', 'exr'].includes(ext)) return 'image';
        if (type.startsWith('video/') || ['mov', 'mp4', 'm4v', 'webm', 'avi', 'mxf'].includes(ext)) return 'video';
        return '';
      },
      _state() {
        const project = K.project.current;
        if (!project) return {};
        project.settings ||= {};
        project.settings[this.stateKey] ||= { packages: 0, returns: [], activeReturnId: '', plannedFrames: 120 };
        return project.settings[this.stateKey];
      },
      _key() { return `${this.stateKey}ExchangeFolder:${K.project.current?.id || 'none'}`; },
      _projectKey() {
        const p = K.project.current || {};
        return this._safe(p.shotId || p.name || p.id, 'MOTK_SHOT');
      },

      async init() {
        K.bus.on('project:opened', () => this.restore().catch(() => this._emit()));
        await this.restore();
      },
      async restore() {
        this.stopWatching();
        this.exchangeHandle = null;
        this.permission = this.supported() ? 'none' : 'unsupported';
        this._seenReturns = new Set(this._state().returns || []);
        if (!this.supported() || !K.project.current) return this._emit();
        const handle = await K.db.getMeta(this._key()).catch(() => null);
        if (!handle || handle.kind !== 'directory') return this._emit();
        this.exchangeHandle = handle;
        this.permission = await handle.queryPermission({ mode: 'readwrite' }).catch(() => 'prompt');
        this._emit();
      },
      async chooseFolder() {
        if (!this.supported()) throw new Error('Shared-folder exchange is unavailable in this browser. Download a package instead.');
        const handle = await window.showDirectoryPicker({ id: this.pickerId, mode: 'readwrite' });
        const permission = await handle.requestPermission({ mode: 'readwrite' });
        if (permission !== 'granted') throw new Error('Folder access was not granted');
        this.exchangeHandle = handle;
        this.permission = permission;
        await K.db.setMeta(this._key(), handle);
        await this._projectRoot(true);
        this._emit();
        return handle.name;
      },
      async reconnect() {
        if (!this.exchangeHandle) return this.chooseFolder();
        const permission = await this.exchangeHandle.requestPermission({ mode: 'readwrite' });
        if (permission !== 'granted') throw new Error('Folder access was not granted');
        this.permission = permission;
        await this._projectRoot(true);
        this._emit();
        return this.exchangeHandle.name;
      },
      async _projectRoot(create = false) {
        if (!this.exchangeHandle || this.permission !== 'granted') return null;
        const motk = await this.exchangeHandle.getDirectoryHandle(this.rootName, { create });
        return motk.getDirectoryHandle(this._projectKey(), { create });
      },
      async _writeFile(root, relativePath, data) {
        const parts = relativePath.split('/').filter(Boolean);
        const name = parts.pop();
        let dir = root;
        for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
        try {
          await dir.getFileHandle(name);
          throw new Error(`Refusing to overwrite existing exchange file: ${relativePath}`);
        } catch (error) { if (error?.name !== 'NotFoundError') throw error; }
        const file = await dir.getFileHandle(name, { create: true });
        const writer = await file.createWritable({ keepExistingData: false });
        try { await writer.write(data); await writer.close(); }
        catch (error) { await writer.abort().catch(() => {}); throw error; }
      },
      async _writePackage(pack) {
        const root = await this._projectRoot(true);
        if (!root) throw new Error(`Choose or reconnect the ${this.label} exchange folder first`);
        await this._writeFile(root, this.marker, this._enc(`${this.schema}\n${this._projectKey()}\n`)).catch((error) => {
          if (!String(error.message).includes('Refusing to overwrite')) throw error;
        });
        for (const file of pack.files.filter((entry) => !entry.ready)) await this._writeFile(root, file.name, file.data);
        const ready = pack.files.find((entry) => entry.ready);
        if (ready) await this._writeFile(root, ready.name, ready.data);
        return `${this.exchangeHandle.name}/${this.rootName}/${this._projectKey()}/${pack.versionDir}`;
      },
      async collectMedia({ includeCaptured = true } = {}) {
        const files = [];
        const references = [];
        for (const layer of K.layers.list) {
          if (!['image', 'video'].includes(layer.type) || !layer.assetId || String(layer.role || '').endsWith('-return')) continue;
          const rec = await K.db.get('assets', layer.assetId);
          if (!rec?.blob) continue;
          const ext = this._ext(layer.sourceName || layer.name, rec.blob.type);
          const media = `media/references/${this._safe(layer.name, layer.id)}_${layer.assetId}.${ext}`;
          references.push({ id: layer.id, name: layer.name, role: layer.role || 'reference', media, type: rec.blob.type || 'application/octet-stream', transform: { x: layer.x || 0, y: layer.y || 0, scale: layer.scale || 100, rotation: layer.rot || 0, opacity: layer.opacity ?? 1 } });
          files.push({ name: media, data: new Uint8Array(await rec.blob.arrayBuffer()) });
        }
        const editorial = await K.editorial.model();
        const sources = new Map();
        const events = [];
        if (includeCaptured) {
          for (const event of editorial.events) {
            let source = sources.get(event.captureId);
            if (!source) {
              const blob = await K.frames.getBlob(event.captureId);
              if (!blob) continue;
              const ext = this._ext(blob.name, blob.type || 'image/jpeg');
              const media = `media/captures/${this._safe(event.captureId)}.${ext}`;
              source = { media, type: blob.type || 'image/jpeg' };
              sources.set(event.captureId, source);
              files.push({ name: media, data: new Uint8Array(await blob.arrayBuffer()) });
            }
            events.push({ stableId: `${event.captureId}:${event.recordIn}:${event.duration}`, captureId: event.captureId, media: source.media, recordIn: event.recordIn, durationFrames: event.duration, rawFiles: event.rawFiles, note: event.note || '' });
          }
        }
        return { editorial, references, events, files };
      },
      manifest(kind, id, media, plannedFrames) {
        const p = K.project.current;
        const size = K.frames.size?.() || {};
        const preset = String(p.settings?.resPreset || '1920x1080').split('x').map(Number);
        const durationFrames = Math.max(media.editorial.totalFrames || 0, parseInt(plannedFrames, 10) || (p.fps || 12) * 10);
        return {
          schema: this.schema, kind, id, projectKey: this._projectKey(), projectId: p.id,
          projectName: p.name, shotId: p.shotId || '', take: p.take || 0,
          fps: K.clamp(parseInt(p.fps, 10) || 12, 1, 60), width: size.w || preset[0] || 1920, height: size.h || preset[1] || 1080,
          sequence: { mode: media.events.length ? 'capture-first' : 'previs-first', durationFrames, events: media.events, references: media.references },
          generatedAt: new Date().toISOString(),
          invariants: { originalsImmutable: true, packageImmutable: true, relativePathsOnly: true, returnedMediaIsReferenceOnly: true, readyWrittenLast: true },
        };
      },
      async publish(pack, { folder = false } = {}) {
        let destination;
        if (folder) destination = await this._writePackage(pack);
        else {
          const prefix = `${this._projectKey()}_${this.shortName}/`;
          const zip = K.exporter.zipStore(pack.files.map((file) => ({ name: prefix + file.name, data: file.data })));
          K.downloadBlob(`${this._projectKey()}_${pack.id}.zip`, zip);
          destination = 'download';
        }
        const state = this._state();
        state.packages = Math.max(state.packages || 0, pack.number);
        state.lastPublished = { id: pack.id, destination, at: new Date().toISOString() };
        await K.project.save();
        this._emit();
        return destination;
      },
      async attachReturn(file, meta = {}) {
        const kind = this._mediaKind(file);
        if (!kind) throw new Error(`Choose a ${this.label} return image or movie`);
        const returnId = meta.id || `manual_${this._stamp()}`;
        for (const layer of K.layers.list) if (layer.role === this.returnRole) layer.visible = false;
        const options = { name: `${this.label.toUpperCase()} RETURN - ${meta.label || file.name.replace(/\.[^.]+$/, '')}`, role: this.returnRole, returnId, sourceName: file.name, behind: true, opacity: 1 };
        const layer = kind === 'video' ? await K.layers.addVideo(file, options) : await K.layers.addImage(file, options);
        const state = this._state();
        state.returns = [...new Set([...(state.returns || []), returnId])];
        state.activeReturnId = returnId;
        this._seenReturns.add(returnId);
        await K.project.save();
        this._emit();
        return layer;
      },
      async scanReturns() {
        const root = await this._projectRoot(false);
        if (!root) throw new Error(`Reconnect the ${this.label} exchange folder first`);
        let returns;
        try { returns = await root.getDirectoryHandle('returns'); }
        catch (error) { if (error?.name === 'NotFoundError') return 0; throw error; }
        let count = 0;
        for await (const entry of returns.values()) {
          if (entry.kind !== 'directory' || this._seenReturns.has(entry.name)) continue;
          try {
            await entry.getFileHandle('READY');
            const manifest = JSON.parse(await (await entry.getFileHandle('return.json')).getFile().then((file) => file.text()));
            if (manifest.schema !== this.schema || manifest.kind !== 'return') continue;
            const mediaName = String(manifest.media || '').replace(/^\.\//, '');
            if (!mediaName || mediaName.includes('/') || mediaName.includes('\\')) continue;
            const media = await (await entry.getFileHandle(mediaName)).getFile();
            await this.attachReturn(media, { id: manifest.id || entry.name, label: manifest.label || entry.name });
            count++;
          } catch (error) { console.warn(`${this.label} return not ready:`, entry.name, error.message); }
        }
        return count;
      },
      startWatching() { if (!this._watchTimer) this._watchTimer = setInterval(() => this.scanReturns().catch(() => {}), 5000); this.scanReturns().catch(() => {}); this._emit(); },
      stopWatching() { if (this._watchTimer) clearInterval(this._watchTimer); this._watchTimer = null; this._emit(); },
      state() {
        const state = this._state();
        return { supported: this.supported(), connected: this.permission === 'granted' && !!this.exchangeHandle, permission: this.permission, folderName: this.exchangeHandle?.name || '', watching: !!this._watchTimer, packages: state.packages || 0, activeReturnId: state.activeReturnId || '' };
      },
      _emit() { K.bus.emit(`${this.eventName}:changed`, this.state()); },
    };
  },
};
