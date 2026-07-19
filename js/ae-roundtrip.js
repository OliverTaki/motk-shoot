/* MOTK Shoot — non-destructive After Effects round-trip.
 *
 * Shoot owns capture and timing. AE owns compositing. This module only creates
 * immutable, versioned exchange packages and loads returned previews as guide
 * layers. It never renames source media and never creates a replacement edit.
 */
'use strict';
K.aeRoundtrip = {
  SCHEMA: 'motk-ae-roundtrip/1',
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
  _state() {
    const project = K.project.current;
    if (!project) return {};
    project.settings ||= {};
    project.settings.aeRoundtrip ||= { initial: 0, delivery: 0, returns: [], activeReturnId: '' };
    return project.settings.aeRoundtrip;
  },
  _key() { return `aeExchangeFolder:${K.project.current?.id || 'none'}`; },
  _projectKey() {
    const p = K.project.current || {};
    return this._safe(p.shotId || p.name || p.id, 'MOTK_SHOT');
  },
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
    const handle = await window.showDirectoryPicker({ id: 'motk-ae-exchange', mode: 'readwrite' });
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

  async forgetFolder() {
    if (K.project.current) await K.db.del('meta', this._key()).catch(() => {});
    this.stopWatching();
    this.exchangeHandle = null;
    this.permission = this.supported() ? 'none' : 'unsupported';
    this._emit();
  },

  async _projectRoot(create = false) {
    if (!this.exchangeHandle || this.permission !== 'granted') return null;
    const motk = await this.exchangeHandle.getDirectoryHandle('MOTK_AE_EXCHANGE', { create });
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
    } catch (error) {
      if (error?.name !== 'NotFoundError') throw error;
    }
    const file = await dir.getFileHandle(name, { create: true });
    const writer = await file.createWritable({ keepExistingData: false });
    try { await writer.write(data); await writer.close(); }
    catch (error) { await writer.abort().catch(() => {}); throw error; }
  },

  async _writePackage(pack) {
    const root = await this._projectRoot(true);
    if (!root) throw new Error('Choose or reconnect the AE exchange folder first');
    await this._writeFile(root, '.motk-ae-root', this._enc(`${this.SCHEMA}\n${this._projectKey()}\n`)).catch((error) => {
      if (!String(error.message).includes('Refusing to overwrite')) throw error;
    });
    for (const file of pack.files.filter((entry) => !entry.ready)) await this._writeFile(root, file.name, file.data);
    const ready = pack.files.find((entry) => entry.ready);
    if (ready) await this._writeFile(root, ready.name, ready.data); // commit marker is always last
    return `${this.exchangeHandle.name}/MOTK_AE_EXCHANGE/${this._projectKey()}/${pack.versionDir}`;
  },

  async _assetFiles(roleFilter = null) {
    const assets = [];
    for (const layer of K.layers.list) {
      if (!['image', 'video'].includes(layer.type) || !layer.assetId || layer.role === 'ae-return') continue;
      const role = layer.role === 'previs' ? 'previs' : 'reference';
      if (roleFilter && role !== roleFilter) continue;
      const rec = await K.db.get('assets', layer.assetId);
      if (!rec?.blob) continue;
      const ext = this._ext(layer.sourceName || layer.name, rec.blob.type);
      assets.push({
        id: layer.id, assetId: layer.assetId, name: layer.name, role,
        media: `media/${role}/${this._safe(layer.name, layer.id)}_${layer.assetId}.${ext}`,
        type: rec.blob.type || 'application/octet-stream', blob: rec.blob,
        transform: { x: layer.x || 0, y: layer.y || 0, scale: layer.scale || 100, rotation: layer.rot || 0, opacity: layer.opacity ?? 1 },
      });
    }
    return assets;
  },

  async _captureLayer(name) {
    const model = await K.editorial.model();
    const sources = new Map();
    for (const event of model.events) {
      if (sources.has(event.captureId)) continue;
      const capture = K.frames.captures.find((item) => item.id === event.captureId);
      const blob = await K.frames.getBlob(event.captureId);
      if (!blob) continue;
      const ext = this._ext(blob.name, blob.type || 'image/jpeg');
      sources.set(event.captureId, {
        id: event.captureId, media: `media/captures/${this._safe(event.captureId)}.${ext}`,
        type: blob.type || 'image/jpeg', blob, rawFiles: event.rawFiles,
        width: capture?.w || 0, height: capture?.h || 0,
      });
    }
    return {
      id: `layer_${this._stamp()}_${Math.random().toString(36).slice(2, 6)}`,
      name: String(name || 'Captured layer').trim() || 'Captured layer',
      role: 'capture', events: model.events.map((event) => ({
        stableId: `${event.captureId}:${event.recordIn}:${event.duration}`,
        captureId: event.captureId, media: sources.get(event.captureId)?.media || '',
        recordIn: event.recordIn, durationFrames: event.duration, rawFiles: event.rawFiles,
      })).filter((event) => event.media), sources: [...sources.values()],
      durationFrames: model.totalFrames,
    };
  },

  _dimensions() {
    const size = K.frames.size?.() || {};
    const preset = String(K.project.current?.settings?.resPreset || '1920x1080').split('x').map(Number);
    return { width: size.w || preset[0] || 1920, height: size.h || preset[1] || 1080 };
  },

  _baseManifest(kind, id, sequence) {
    const p = K.project.current;
    const dims = this._dimensions();
    return {
      schema: this.SCHEMA, kind, id, projectKey: this._projectKey(), projectId: p.id,
      projectName: p.name, shotId: p.shotId || '', take: p.take || 0,
      fps: K.clamp(parseInt(p.fps, 10) || 12, 1, 60), width: dims.width, height: dims.height,
      sequence, generatedAt: new Date().toISOString(),
      invariants: {
        originalsImmutable: true, packageImmutable: true, relativePathsOnly: true,
        aeProjectCreatedOnce: true, deliveriesAppendOnly: true, returnedMediaIsReferenceOnly: true,
      },
    };
  },

  async buildInitial({ includeCaptured = true } = {}) {
    const state = this._state();
    const number = Math.max(1, (state.initial || 0) + 1);
    const id = `initial_${String(number).padStart(4, '0')}`;
    const base = `initials/${id}`;
    const assets = await this._assetFiles();
    const captureLayer = includeCaptured && K.frames.count() ? await this._captureLayer('Initial captured layer') : null;
    const planned = Math.max(1, parseInt(K.project.current?.settings?.aeRoundtrip?.plannedFrames, 10) || (K.project.current.fps || 12) * 10);
    const duration = Math.max(captureLayer?.durationFrames || 0, planned);
    const layers = [
      ...assets.map((asset) => ({ stableId: asset.id, name: asset.name, role: asset.role, media: asset.media, recordIn: 0, durationFrames: duration, transform: asset.transform })),
      ...(captureLayer ? captureLayer.events.map((event) => ({ ...event, name: captureLayer.name, role: 'capture', layerId: captureLayer.id })) : []),
    ];
    const manifest = this._baseManifest('initial', id, {
      mode: captureLayer ? 'capture-first' : 'previs-first', durationFrames: duration,
      layers, sourceLayers: captureLayer ? [{ id: captureLayer.id, name: captureLayer.name }] : [],
    });
    const files = [];
    for (const asset of assets) files.push({ name: `${base}/${asset.media}`, data: new Uint8Array(await asset.blob.arrayBuffer()) });
    for (const source of captureLayer?.sources || []) files.push({ name: `${base}/${source.media}`, data: new Uint8Array(await source.blob.arrayBuffer()) });
    files.push(
      { name: `${base}/handoff.json`, data: this._json(manifest) },
      { name: `${base}/scripts/BUILD_MOTK_AE_PROJECT.jsx`, data: this._enc(this._builderJsx()) },
      { name: `${base}/scripts/PUBLISH_RETURN.jsx`, data: this._enc(this._returnJsx()) },
      { name: `${base}/README.txt`, data: this._enc(this._readme('initial', id)) },
      { name: `${base}/READY`, data: this._enc(`${id}\n`), ready: true },
    );
    return { kind: 'initial', id, number, versionDir: base, manifest, files };
  },

  async buildDelivery(layerName) {
    if (!K.frames.count()) throw new Error('Capture at least one frame before publishing a shooting layer');
    const state = this._state();
    const number = Math.max(1, (state.delivery || 0) + 1);
    const id = `delivery_${String(number).padStart(4, '0')}`;
    const base = `deliveries/${id}`;
    const captureLayer = await this._captureLayer(layerName);
    const manifest = this._baseManifest('delivery', id, {
      durationFrames: captureLayer.durationFrames,
      sourceLayer: { id: captureLayer.id, name: captureLayer.name }, layers: captureLayer.events,
    });
    const files = [];
    for (const source of captureLayer.sources) files.push({ name: `${base}/${source.media}`, data: new Uint8Array(await source.blob.arrayBuffer()) });
    files.push(
      { name: `${base}/delivery.json`, data: this._json(manifest) },
      { name: `${base}/scripts/IMPORT_MOTK_DELIVERY.jsx`, data: this._enc(this._deliveryJsx()) },
      { name: `${base}/README.txt`, data: this._enc(this._readme('delivery', id)) },
      { name: `${base}/READY`, data: this._enc(`${id}\n`), ready: true },
    );
    return { kind: 'delivery', id, number, versionDir: base, manifest, files };
  },

  async publish(pack, { folder = false } = {}) {
    let destination = '';
    if (folder) destination = await this._writePackage(pack);
    else {
      const prefix = `${this._projectKey()}_AE/`;
      const zip = K.exporter.zipStore(pack.files.map((file) => ({ name: prefix + file.name, data: file.data })));
      K.downloadBlob(`${this._projectKey()}_${pack.id}.zip`, zip);
      destination = 'download';
    }
    const state = this._state();
    state[pack.kind] = Math.max(state[pack.kind] || 0, pack.number);
    state.lastPublished = { kind: pack.kind, id: pack.id, destination, at: new Date().toISOString() };
    await K.project.save();
    this._emit();
    return destination;
  },

  async addPrevis(file) {
    const kind = this._mediaKind(file);
    if (!kind) throw new Error('Choose an image or video previs file');
    const options = { name: `PREVIS — ${file.name.replace(/\.[^.]+$/, '')}`, role: 'previs', sourceName: file.name, behind: true, opacity: 0.65 };
    const layer = kind === 'video' ? await K.layers.addVideo(file, options) : await K.layers.addImage(file, options);
    this._emit();
    return layer;
  },

  async attachReturn(file, meta = {}) {
    const kind = this._mediaKind(file);
    if (!kind) throw new Error('Choose an AE return image or movie');
    const returnId = meta.id || `manual_${this._stamp()}`;
    for (const layer of K.layers.list) if (layer.role === 'ae-return') layer.visible = false;
    const options = {
      name: `AE RETURN — ${meta.label || file.name.replace(/\.[^.]+$/, '')}`,
      role: 'ae-return', returnId, sourceName: file.name, behind: true, opacity: 1,
    };
    const layer = kind === 'video' ? await K.layers.addVideo(file, options) : await K.layers.addImage(file, options);
    const state = this._state();
    state.returns = [...new Set([...(state.returns || []), returnId])];
    state.activeReturnId = returnId;
    state.lastReturnAt = new Date().toISOString();
    this._seenReturns.add(returnId);
    await K.project.save();
    K.bus.emit('ae:return-attached', { id: returnId, layerId: layer.id });
    this._emit();
    return layer;
  },

  async _readText(dir, name) {
    const handle = await dir.getFileHandle(name);
    return (await handle.getFile()).text();
  },

  async scanReturns() {
    const root = await this._projectRoot(false);
    if (!root) throw new Error('Reconnect the AE exchange folder first');
    let returns;
    try { returns = await root.getDirectoryHandle('returns'); }
    catch (error) { if (error?.name === 'NotFoundError') return 0; throw error; }
    let count = 0;
    for await (const entry of returns.values()) {
      if (entry.kind !== 'directory' || this._seenReturns.has(entry.name)) continue;
      try {
        await entry.getFileHandle('READY');
        const manifest = JSON.parse(await this._readText(entry, 'return.json'));
        if (manifest.schema !== this.SCHEMA || manifest.kind !== 'return') continue;
        const mediaName = String(manifest.media || '').replace(/^\.\//, '');
        if (!mediaName || mediaName.includes('/') || mediaName.includes('\\')) continue;
        const media = await (await entry.getFileHandle(mediaName)).getFile();
        await this.attachReturn(media, { id: manifest.id || entry.name, label: manifest.label || entry.name });
        count++;
      } catch (error) { console.warn('AE return not ready:', entry.name, error.message); }
    }
    return count;
  },

  startWatching() {
    if (this._watchTimer) return;
    this._watchTimer = setInterval(() => this.scanReturns().catch(() => {}), 5000);
    this.scanReturns().catch(() => {});
    this._emit();
  },
  stopWatching() { if (this._watchTimer) clearInterval(this._watchTimer); this._watchTimer = null; this._emit(); },

  state() {
    const projectState = this._state();
    return {
      supported: this.supported(), connected: this.permission === 'granted' && !!this.exchangeHandle,
      permission: this.permission, folderName: this.exchangeHandle?.name || '', watching: !!this._watchTimer,
      previsCount: K.layers?.list?.filter((layer) => layer.role === 'previs').length || 0,
      initial: projectState.initial || 0, delivery: projectState.delivery || 0,
      activeReturnId: projectState.activeReturnId || '',
    };
  },
  _emit() { K.bus.emit('ae:changed', this.state()); },

  _readme(kind, id) {
    if (kind === 'initial') return [
      'MOTK Shoot → After Effects', '',
      '1. Keep this whole MOTK_AE project folder together.',
      `2. In After Effects: File > Scripts > Run Script File… > ${id}/scripts/BUILD_MOTK_AE_PROJECT.jsx`,
      '3. The script creates a new .aep only when no file with that name exists.',
      '4. Work normally. Source media and MOTK packages are never renamed or deleted.',
      '5. Render a preview, then run scripts/PUBLISH_RETURN.jsx and choose that rendered file.',
      '6. MOTK Shoot can watch the shared returns folder or import the returned preview manually.', '',
      'Previs-first is supported: this package may contain previs and a blank timing comp before any photography.',
    ].join('\r\n');
    return [
      'MOTK Shoot incremental AE delivery', '',
      '1. Copy/merge this deliveries folder into the existing MOTK_AE project folder.',
      `2. Open the existing working .aep. Do not rebuild it.`,
      `3. Run ${id}/scripts/IMPORT_MOTK_DELIVERY.jsx.`,
      '4. Existing AE layers, effects, keyframes, and comps are preserved. Re-running the same delivery is deduplicated.',
    ].join('\r\n');
  },

  _jsxHelpers() {
    return String.raw`function motkReadJson(file){file.encoding='UTF-8';if(!file.open('r'))throw new Error('Cannot open '+file.fsName);var text=file.read();file.close();return eval('('+text+')');}
function motkRoot(start){var d=start;while(d&&d.exists){if(new File(d.fsName+'/.motk-ae-root').exists)return d;d=d.parent;}return start;}
function motkItemByName(name,kind){for(var i=1;i<=app.project.numItems;i++){var x=app.project.item(i);if(x.name===name&&(!kind||(kind==='comp'&&x instanceof CompItem)||(kind==='folder'&&x instanceof FolderItem)))return x;}return null;}
function motkFolder(name){var x=motkItemByName(name,'folder');return x||app.project.items.addFolder(name);}
function motkImport(file,parent){if(!file.exists)throw new Error('Missing media: '+file.fsName);var io=new ImportOptions(file);var item=app.project.importFile(io);item.parentFolder=parent;return item;}
function motkTagged(comp,tag){for(var i=1;i<=comp.numLayers;i++)if(comp.layer(i).comment===tag)return true;return false;}
function motkAdd(comp,item,entry,fps,tag){if(motkTagged(comp,tag))return null;var layer=comp.layers.add(item);layer.name=entry.name||entry.captureId||entry.stableId;layer.comment=tag;layer.startTime=(entry.recordIn||0)/fps;layer.inPoint=(entry.recordIn||0)/fps;layer.outPoint=((entry.recordIn||0)+(entry.durationFrames||1))/fps;if(entry.role==='previs'||entry.role==='reference'){layer.guideLayer=true;layer.moveToEnd();}if(entry.transform){var tr=layer.property('ADBE Transform Group');tr.property('ADBE Position').setValue([comp.width/2+(entry.transform.x||0),comp.height/2+(entry.transform.y||0)]);tr.property('ADBE Scale').setValue([entry.transform.scale||100,entry.transform.scale||100]);tr.property('ADBE Rotate Z').setValue(entry.transform.rotation||0);tr.property('ADBE Opacity').setValue((entry.transform.opacity===undefined?1:entry.transform.opacity)*100);}return layer;}`;
  },

  _builderJsx() {
    return `#target aftereffects\n(function(){app.beginUndoGroup('Build MOTK AE project');try{\n${this._jsxHelpers()}\nvar script=new File($.fileName),base=script.parent.parent,root=motkRoot(base),m=motkReadJson(new File(base.fsName+'/handoff.json'));if(!app.project)app.newProject();var compName=m.projectKey+'_MOTK_COMP';var comp=motkItemByName(compName,'comp');if(!comp)comp=app.project.items.addComp(compName,m.width,m.height,1,Math.max(1,m.sequence.durationFrames)/m.fps,m.fps);var footage=motkFolder('MOTK SOURCE');var cache={};for(var i=0;i<m.sequence.layers.length;i++){var e=m.sequence.layers[i];if(!e.media)continue;var key=e.media;if(!cache[key])cache[key]=motkImport(new File(base.fsName+'/'+e.media),footage);motkAdd(comp,cache[key],e,m.fps,'MOTK_INITIAL:'+m.id+':'+e.stableId);}var target=new File(root.fsName+'/'+m.projectKey+'_MOTK_WORKING.aep');if(target.exists)throw new Error('Working project already exists. Open it and import a delivery instead: '+target.fsName);app.project.save(target);comp.openInViewer();alert('MOTK AE project created. Original media was not changed.');}catch(err){alert('MOTK AE build failed: '+err.toString());}finally{app.endUndoGroup();}})();\n`;
  },

  _deliveryJsx() {
    return `#target aftereffects\n(function(){app.beginUndoGroup('Import MOTK delivery');try{\n${this._jsxHelpers()}\nif(!app.project||!app.project.file)throw new Error('Open and save the receiving .aep first.');var script=new File($.fileName),base=script.parent.parent,m=motkReadJson(new File(base.fsName+'/delivery.json'));var comp=motkItemByName(m.projectKey+'_MOTK_COMP','comp');if(!comp&&app.project.activeItem instanceof CompItem)comp=app.project.activeItem;if(!comp)throw new Error('Open the receiving composition, or run BUILD_MOTK_AE_PROJECT.jsx first.');var folder=motkFolder('MOTK '+m.id);var cache={};var added=0;for(var i=0;i<m.sequence.layers.length;i++){var e=m.sequence.layers[i];var tag='MOTK_DELIVERY:'+m.id+':'+e.stableId;if(motkTagged(comp,tag))continue;if(!cache[e.media])cache[e.media]=motkImport(new File(base.fsName+'/'+e.media),folder);e.name=m.sequence.sourceLayer.name;motkAdd(comp,cache[e.media],e,m.fps,tag);added++;}var need=Math.max(comp.duration,m.sequence.durationFrames/m.fps);comp.duration=need;app.project.save();comp.openInViewer();alert('Imported '+added+' MOTK layers. Existing AE work was preserved.');}catch(err){alert('MOTK delivery failed: '+err.toString());}finally{app.endUndoGroup();}})();\n`;
  },

  _returnJsx() {
    return `#target aftereffects\n(function(){try{\n${this._jsxHelpers()}\nif(!app.project||!app.project.file)throw new Error('Save the working AE project first.');var rendered=File.openDialog('Choose the rendered preview to return to MOTK Shoot');if(!rendered)return;var script=new File($.fileName),root=motkRoot(script.parent.parent);var returns=new Folder(root.fsName+'/returns');if(!returns.exists)returns.create();var n=1,dir;do{dir=new Folder(returns.fsName+'/return_'+('0000'+n).slice(-4));n++;}while(dir.exists);if(!dir.create())throw new Error('Cannot create return folder');var ext=rendered.name.lastIndexOf('.')>=0?rendered.name.substring(rendered.name.lastIndexOf('.')):'';var media='preview'+ext;var copy=new File(dir.fsName+'/'+media);if(!rendered.copy(copy.fsName))throw new Error('Could not copy rendered preview');var id=dir.name;var manifest=new File(dir.fsName+'/return.json');manifest.encoding='UTF-8';manifest.open('w');manifest.write('{\\n  "schema": "${this.SCHEMA}",\\n  "kind": "return",\\n  "id": "'+id+'",\\n  "label": "AE '+id+'",\\n  "media": "'+media.replace(/"/g,'_')+'"\\n}\\n');manifest.close();var ready=new File(dir.fsName+'/READY');ready.open('w');ready.write(id+'\\n');ready.close();alert('Return published: '+dir.fsName+'\\nMOTK Shoot will keep older returns and show this one as a reference layer.');}catch(err){alert('MOTK return failed: '+err.toString());}})();\n`;
  },
};
