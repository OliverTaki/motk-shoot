/* MOTK Shoot — export: JPEG sequence ZIP (store, no deps), movie via MediaRecorder, project backup */
'use strict';
K.exporter = {
  busy: false,

  /* ---------- ZIP (store-only) ---------- */
  _crcTable: (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })(),

  crc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = this._crcTable[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  },

  _dosDateTime(d = new Date()) {
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = (((d.getFullYear() - 1980) & 0x7F) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time, date };
  },

  /* files: [{name, data: Uint8Array}] -> Blob(zip). Stored (no compression) — JPEGs don't compress. */
  zipStore(files) {
    const enc = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;
    const { time, date } = this._dosDateTime();

    for (const f of files) {
      const nameB = enc.encode(f.name);
      const crc = this.crc32(f.data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);          // version needed
      lh.setUint16(6, 0x0800, true);      // UTF-8 names
      lh.setUint16(8, 0, true);           // store
      lh.setUint16(10, time, true);
      lh.setUint16(12, date, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, f.data.length, true);
      lh.setUint32(22, f.data.length, true);
      lh.setUint16(26, nameB.length, true);
      lh.setUint16(28, 0, true);
      chunks.push(new Uint8Array(lh.buffer), nameB, f.data);

      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true);
      ch.setUint16(12, time, true);
      ch.setUint16(14, date, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, f.data.length, true);
      ch.setUint32(24, f.data.length, true);
      ch.setUint16(28, nameB.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), nameB);
      offset += 30 + nameB.length + f.data.length;
    }

    let cdSize = 0;
    for (const c of central) cdSize += c.length;
    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(8, files.length, true);
    eocd.setUint16(10, files.length, true);
    eocd.setUint32(12, cdSize, true);
    eocd.setUint32(16, offset, true);
    return new Blob([...chunks, ...central, new Uint8Array(eocd.buffer)], { type: 'application/zip' });
  },

  /* minimal ZIP reader for our own store-only archives */
  async unzipStore(blob) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    const dv = new DataView(buf.buffer);
    const dec = new TextDecoder();
    const files = {};
    let p = 0;
    while (p + 4 <= buf.length && dv.getUint32(p, true) === 0x04034b50) {
      const method = dv.getUint16(p + 8, true);
      const csize = dv.getUint32(p + 18, true);
      const nameLen = dv.getUint16(p + 26, true);
      const extraLen = dv.getUint16(p + 28, true);
      const name = dec.decode(buf.subarray(p + 30, p + 30 + nameLen));
      const dataStart = p + 30 + nameLen + extraLen;
      let data = buf.subarray(dataStart, dataStart + csize);
      if (method === 8) { // deflate — decompress via DecompressionStream
        const ds = new DecompressionStream('deflate-raw');
        const stream = new Blob([data]).stream().pipeThrough(ds);
        data = new Uint8Array(await new Response(stream).arrayBuffer());
      } else if (method !== 0) {
        throw new Error('Unsupported ZIP compression method: ' + method);
      }
      files[name] = data;
      p = dataStart + csize;
    }
    return files;
  },

  /* ---------- image sequence ---------- */
  async exportSequence({ expandHolds = true } = {}) {
    const fs = K.frames;
    if (!fs.count()) { K.toast('No frames to export'); return; }
    K.status('Building ZIP…');
    const files = [];
    let n = 0;
    if (expandHolds) {
      for (const frameIdx of fs.expanded()) {
        const f = fs.list[frameIdx];
        const blob = await fs.getBlob(f.id);
        files.push({ name: K.seqName(n++), data: new Uint8Array(await blob.arrayBuffer()) });
      }
    } else {
      for (const f of fs.list) {
        const blob = await fs.getBlob(f.id);
        files.push({ name: K.seqName(n++), data: new Uint8Array(await blob.arrayBuffer()) });
      }
    }
    const zip = this.zipStore(files);
    K.downloadBlob(this._fileBase() + '_seq.zip', zip);
    K.status('');
    K.toast(`Exported ${files.length} frames`, 'ok');
  },

  /* ---------- movie ---------- */
  supportedMimes() {
    const candidates = [
      ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'MP4 (H.264)'],
      ['video/mp4', 'MP4'],
      ['video/webm;codecs=vp9,opus', 'WebM (VP9)'],
      ['video/webm;codecs=vp8,opus', 'WebM (VP8)'],
      ['video/webm', 'WebM'],
    ];
    return candidates.filter(([m]) => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
  },

  async exportVideo({ mime, bitrate = 16000000, withAudio = true, onProgress } = {}) {
    const fs = K.frames;
    if (!fs.count()) { K.toast('No frames to export'); return; }
    if (this.busy) { K.toast('Export already running'); return; }
    this.busy = true;
    try {
      const fps = K.project.current.fps;
      const { w, h } = fs.size();
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      const stream = canvas.captureStream(0);
      const vTrack = stream.getVideoTracks()[0];

      // audio
      let audioNodes = null;
      if (withAudio && K.audio.hasAudio() && K.audio.ctx) {
        const actx = K.audio.ctx;
        if (actx.state === 'suspended') await actx.resume();
        const dest = actx.createMediaStreamDestination();
        stream.addTrack(dest.stream.getAudioTracks()[0]);
        audioNodes = { sources: [], dest, actx };
      }

      const rec = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: bitrate,
      });
      const parts = [];
      rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
      const done = new Promise((res) => { rec.onstop = res; });

      const expanded = fs.expanded();
      const total = expanded.length;
      rec.start(500);

      // schedule audio start relative to offset
      if (audioNodes) {
        audioNodes.sources = K.audio.connectExport(audioNodes.dest, fps, audioNodes.actx.currentTime);
      }

      // real-time paced rendering (MediaRecorder timestamps on wall clock)
      const t0 = performance.now();
      let lastFrameIdx = -1;
      for (let e = 0; e < total; e++) {
        const frameIdx = expanded[e];
        if (frameIdx !== lastFrameIdx) {
          const bmp = await fs.getBitmap(fs.list[frameIdx].id);
          ctx.drawImage(bmp, 0, 0, w, h);
          lastFrameIdx = frameIdx;
        }
        if (vTrack.requestFrame) vTrack.requestFrame();
        else canvas.getContext('2d').fillRect(0, 0, 0, 0); // force paint for captureStream(auto)
        if (onProgress) onProgress(e + 1, total);
        const target = t0 + ((e + 1) * 1000) / fps;
        const wait = target - performance.now();
        if (wait > 0) await K.sleep(wait);
      }
      await K.sleep(250); // flush last frame
      if (audioNodes) audioNodes.sources.forEach((source) => { try { source.stop(); } catch {} });
      rec.stop();
      await done;

      const ext = mime.includes('mp4') ? 'mp4' : 'webm';
      const blob = new Blob(parts, { type: mime.split(';')[0] });
      K.downloadBlob(this._fileBase() + '.' + ext, blob);
      K.toast('Movie exported', 'ok');
    } finally {
      this.busy = false;
      if (onProgress) onProgress(0, 0);
    }
  },

  /* ---------- edit list CSV (conform RAW originals in post) ---------- */
  exportEditListCsv() {
    const fs = K.frames;
    if (!fs.count()) { K.toast('No frames in this edit'); return; }
    const fps = K.project.current.fps;
    const esc = (s) => '"' + String(s || '').replace(/"/g, '""') + '"';
    let csv = 'frame,exposure_start,hold,seconds,capture_id,raw_files,note\r\n';
    let exp = 0;
    fs.list.forEach((f, i) => {
      csv += [i + 1, exp + 1, f.hold, (f.hold / fps).toFixed(4), f.id, esc(f.raw), esc(f.note)].join(',') + '\r\n';
      exp += f.hold;
    });
    K.downloadBlob(this._fileBase() + '_editlist.csv', new Blob([csv], { type: 'text/csv' }));
  },

  /* ---------- project backup / restore ----------
   * v6 format: v5 plus multi-track audio and typed layer assets.
   */
  async buildProjectBackup() {
    const fs = K.frames;
    const p = K.project.current;
    const files = [];
    const manifest = {
      motkshoot: 6,
      name: p.name,
      fps: p.fps,
      settings: p.settings,
      audioOffset: K.audio.offsetFrames,
      audioName: K.audio.name || '',
      captures: [],
      edits: JSON.parse(JSON.stringify(fs.edits)),
      activeEditId: fs.activeEditId,
      layers: K.layers.serialize(),
      assets: [], audioTracks: [],
      production: p.productionId ? { productionId: p.productionId, shotId: p.shotId, take: p.take } : null,
    };
    for (const l of manifest.layers) {
      if ((l.type === 'image' || l.type === 'video') && l.assetId) {
        const rec = await K.db.get('assets', l.assetId);
        if (rec) {
          const file = `assets/${l.assetId}.bin`;
          files.push({ name: file, data: new Uint8Array(await rec.blob.arrayBuffer()) });
          manifest.assets.push({ id: l.assetId, file, type: rec.blob.type || 'application/octet-stream' });
        }
      }
    }
    for (const assetId of Object.values(p.settings?.faces?.assets || {})) {
      if (manifest.assets.some((asset) => asset.id === assetId)) continue;
      const rec = await K.db.get('assets', assetId);
      if (rec) {
        const file = `assets/${assetId}.bin`;
        files.push({ name: file, data: new Uint8Array(await rec.blob.arrayBuffer()) });
        manifest.assets.push({ id: assetId, file, type: rec.blob.type || 'application/octet-stream' });
      }
    }
    for (let i = 0; i < fs.captures.length; i++) {
      const c = fs.captures[i];
      const blob = await fs.getBlob(c.id);
      if (!blob) continue;
      const name = `captures/${K.seqName(i)}`;
      files.push({ name, data: new Uint8Array(await blob.arrayBuffer()) });
      manifest.captures.push({
        id: c.id, file: name, w: c.w, h: c.h, note: c.note || '',
        raw: c.raw || '', passes: c.passes || [], shotHold: c.shotHold || 1, isTest: !!c.isTest,
        capturedAt: c.capturedAt,
      });
    }
    if (K.audio.hasAudio()) {
      const rec = await K.db.get('audio', p.id);
      for (const track of rec?.tracks || []) {
        const ext = (track.name.match(/\.(\w+)$/) || [, 'bin'])[1];
        const file = `audio/${track.id}.${ext}`;
        files.push({ name: file, data: new Uint8Array(await track.blob.arrayBuffer()) });
        manifest.audioTracks.push({ id: track.id, name: track.name, file, type: track.blob.type || 'application/octet-stream', offsetFrames: track.offsetFrames, volume: track.volume, muted: track.muted });
      }
    }
    files.unshift({ name: 'project.json', data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) });
    return this.zipStore(files);
  },

  async exportProject() {
    K.status('Packing project…');
    const zip = await this.buildProjectBackup();
    K.downloadBlob(this._fileBase() + '_project.zip', zip);
    K.status('');
    K.toast('Project backed up', 'ok');
  },

  async importProject(fileBlob) {
    K.status('Reading project…');
    const files = await this.unzipStore(fileBlob);
    const manifestRaw = files['project.json'];
    if (!manifestRaw) throw new Error('Not a MOTK Shoot project (project.json missing)');
    const manifest = JSON.parse(new TextDecoder().decode(manifestRaw));
    const proj = await K.project.create(manifest.name ? manifest.name + ' (imported)' : 'Imported');
    proj.fps = manifest.fps || 12;
    if (manifest.settings) proj.settings = manifest.settings;
    if (manifest.production) {
      proj.productionId = manifest.production.productionId || '';
      proj.shotId = manifest.production.shotId || '';
      proj.take = Math.max(0, parseInt(manifest.production.take, 10) || 0);
    }

    let nCaptures = 0;
    if ((manifest.motkshoot >= 2 || manifest.komadori >= 2) && manifest.captures) {
      // v2: restore the full bin + all edits, keeping original capture ids
      const captures = [];
      for (const cm of manifest.captures) {
        const data = files[cm.file];
        if (!data) continue;
        const blob = new Blob([data], { type: 'image/jpeg' });
        const thumb = await K.frames._makeThumb(blob, cm.w, cm.h);
        await K.db.put('frames', {
          id: cm.id, projectId: proj.id, blob, thumb, w: cm.w, h: cm.h,
          shotHold: cm.shotHold || 1, note: cm.note || '', raw: cm.raw || '', passes: cm.passes || [],
          isTest: !!cm.isTest,
          capturedAt: cm.capturedAt || Date.now(),
        });
        captures.push({
          id: cm.id, w: cm.w, h: cm.h, thumb, note: cm.note || '',
          raw: cm.raw || '', passes: cm.passes || [], shotHold: cm.shotHold || 1, isTest: !!cm.isTest,
          capturedAt: cm.capturedAt || 0,
        });
        nCaptures++;
      }
      const have = new Set(captures.map((c) => c.id));
      const edits = (manifest.edits || []).map((ed) => ({
        id: ed.id, name: ed.name,
        items: (ed.items || []).filter((it) => have.has(it.id)),
      }));
      proj.edits = edits.length ? edits : [{ id: 'e1', name: 'Edit 1', items: [] }];
      proj.activeEditId = manifest.activeEditId && edits.some((e) => e.id === manifest.activeEditId)
        ? manifest.activeEditId : proj.edits[0].id;
      K.frames.reset({ captures, edits: proj.edits, activeEditId: proj.activeEditId });
    } else {
      // v1: linear frame list
      for (const fm of manifest.frames || []) {
        const data = files[fm.file];
        if (!data) continue;
        const blob = new Blob([data], { type: 'image/jpeg' });
        await K.frames.add({ blob, w: fm.w, h: fm.h }, { hold: fm.hold || 1, note: fm.note || '' });
        nCaptures++;
      }
    }
    if (manifest.audioTracks?.length) {
      for (const track of manifest.audioTracks) if (files[track.file]) {
        await K.audio.load(new Blob([files[track.file]], { type: track.type || '' }), track.name, track);
      }
    } else if (manifest.audioFile && files[manifest.audioFile]) {
      const audioBlob = new Blob([files[manifest.audioFile]]);
      await K.audio.load(audioBlob, manifest.audioName || manifest.audioFile);
      K.audio.offsetFrames = manifest.audioOffset || 0;
    }
    if (manifest.assets?.length) {
      for (const asset of manifest.assets) if (files[asset.file]) {
        await K.db.put('assets', { id: asset.id, projectId: proj.id, blob: new Blob([files[asset.file]], { type: asset.type || '' }) });
      }
    }
    if (manifest.layers && manifest.layers.length) {
      for (const l of manifest.layers) {
        const meta = manifest.assets?.find((asset) => asset.id === l.assetId);
        const file = meta?.file || `assets/${l.assetId}.bin`;
        if (!manifest.assets?.length && (l.type === 'image' || l.type === 'video') && l.assetId && files[file]) {
          await K.db.put('assets', {
            id: l.assetId, projectId: proj.id,
            blob: new Blob([files[file]], { type: meta?.type || '' }),
          });
        }
      }
      proj.layers = manifest.layers;
      await K.layers.reset(proj.layers);
    }
    await K.project.save();
    K.bus.emit('project:opened', { id: proj.id });
    K.status('');
    K.toast(`Imported "${proj.name}" (${nCaptures} captures)`, 'ok');
  },

  _fileBase() {
    return (K.project.current.name || 'motkshoot').replace(/[^\w\-]+/g, '_');
  },
};
