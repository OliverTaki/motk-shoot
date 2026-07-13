/* MOTK Shoot — editorial hand-off: CMX3600, FCPXML, AAF-lite, and conform recipes. */
'use strict';
K.editorial = {
  _base() { return (K.project.current?.name || 'motkshoot').replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 80); },
  _xml(value) { return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); },
  _tc(frames, fps) {
    const value = Math.max(0, Math.round(frames));
    const ff = value % fps, seconds = Math.floor(value / fps);
    const ss = seconds % 60, minutes = Math.floor(seconds / 60), mm = minutes % 60, hh = Math.floor(minutes / 60);
    return [hh, mm, ss, ff].map((part) => String(part).padStart(2, '0')).join(':');
  },
  _safeAudioName(name, fallback) {
    const clean = String(name || '').normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+|\.+$/g, '').trim().slice(0, 80);
    return clean || fallback;
  },

  async model() {
    const project = K.project.current;
    if (!project) throw new Error('Open a project first');
    const fps = K.clamp(parseInt(project.fps, 10) || 12, 1, 60);
    const captures = K.frames.captures;
    let recordStart = 0;
    const events = K.frames.activeEdit().items.map((item, index) => {
      const capture = captures.find((value) => value.id === item.id);
      const captureNumber = Math.max(1, captures.findIndex((value) => value.id === item.id) + 1);
      const duration = Math.max(1, parseInt(item.hold, 10) || 1);
      const event = {
        event: index + 1, captureId: item.id, captureNumber, duration,
        sourceIn: 0, sourceOut: duration, recordIn: recordStart, recordOut: recordStart + duration,
        frameFile: `frames/frame_${String(captureNumber).padStart(5, '0')}.jpg`,
        rawFiles: String(capture?.raw || '').split(';').filter(Boolean), note: capture?.note || '',
      };
      recordStart += duration;
      return event;
    });
    const rec = await K.db.get('audio', project.id).catch(() => null);
    const audio = (rec?.tracks || []).map((track, index) => ({
      name: track.name, file: `audio/${this._safeAudioName(track.name, `track_${index + 1}.bin`)}`,
      offsetFrames: parseInt(track.offsetFrames, 10) || 0,
      volume: track.volume === undefined ? 1 : +track.volume, muted: !!track.muted,
    }));
    return {
      schema: 'motk-editorial/1', projectId: project.id, projectName: project.name,
      fps, totalFrames: recordStart, durationSeconds: +(recordStart / fps).toFixed(6),
      production: project.productionId ? { productionId: project.productionId, shotId: project.shotId, take: project.take } : null,
      desqueeze: K.cine?.settings?.desqueeze || 1, activeEditId: K.frames.activeEditId,
      activeEditName: K.frames.activeEdit().name, events, audio,
      generatedAt: new Date().toISOString(),
    };
  },

  edl(model) {
    const lines = [`TITLE: ${String(model.projectName).toUpperCase()}`, 'FCM: NON-DROP FRAME', ''];
    for (const event of model.events) {
      const reel = ('M' + String(event.captureNumber).padStart(7, '0')).slice(-8);
      lines.push(`${String(event.event).padStart(3, '0')}  ${reel} V     C        ${this._tc(event.sourceIn, model.fps)} ${this._tc(event.sourceOut, model.fps)} ${this._tc(event.recordIn, model.fps)} ${this._tc(event.recordOut, model.fps)}`);
      lines.push(`* FROM CLIP NAME: ${event.frameFile}`);
      lines.push(`* MOTK CAPTURE ID: ${event.captureId}`);
      if (event.rawFiles.length) lines.push(`* RAW: ${event.rawFiles.join(' ; ')}`);
      if (event.note) lines.push(`* NOTE: ${event.note.replace(/[\r\n]+/g, ' ')}`);
    }
    return lines.join('\r\n') + '\r\n';
  },

  fcpxml(model) {
    const rate = `${model.fps}`;
    const resources = model.events.map((event) => `    <asset id="r${event.event + 1}" name="${this._xml(event.captureId)}" start="0s" duration="86400s" hasVideo="1" format="r1"><media-rep kind="original-media" src="file:///MOTK_SHOT/${this._xml(event.frameFile)}"/></asset>`).join('\n');
    const clips = model.events.map((event) => `              <asset-clip ref="r${event.event + 1}" name="${this._xml(event.captureId)}" offset="${event.recordIn}/${rate}s" start="0s" duration="${event.duration}/${rate}s"><note>${this._xml(event.note || event.rawFiles.join(' ; '))}</note></asset-clip>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n<fcpxml version="1.10">\n  <resources>\n    <format id="r1" name="MOTK ${model.fps}fps" frameDuration="1/${rate}s" width="${K.frames.size()?.w || 1920}" height="${K.frames.size()?.h || 1080}"/>\n${resources}\n  </resources>\n  <library><event name="MOTK Shoot"><project name="${this._xml(model.projectName)}"><sequence format="r1" duration="${model.totalFrames}/${rate}s" tcStart="0s" tcFormat="NDF"><spine>\n${clips}\n            </spine><metadata><md key="com.motkshoot.activeEdit" value="${this._xml(model.activeEditName)}"/><md key="com.motkshoot.desqueeze" value="${model.desqueeze}"/></metadata></sequence></project></event></library>\n</fcpxml>\n`;
  },

  aafLite(model) {
    return JSON.stringify({
      schema: 'motk-aaf-lite/1', note: 'Portable JSON hand-off; convert to binary AAF in the destination editorial system.',
      composition: { name: model.projectName, editRate: model.fps, length: model.totalFrames, activeEdit: model.activeEditName },
      production: model.production, desqueeze: model.desqueeze,
      tracks: [{ kind: 'picture', id: 'V1', events: model.events.map((event) => ({
        event: event.event, sourceMobId: event.captureId, sourcePath: event.frameFile,
        sourceIn: event.sourceIn, sourceOut: event.sourceOut, recordIn: event.recordIn,
        recordOut: event.recordOut, rawFiles: event.rawFiles, comment: event.note,
      })) }, { kind: 'audio', id: 'A1+', clips: model.audio }], generatedAt: model.generatedAt,
    }, null, 2) + '\n';
  },

  concat(model) {
    const lines = ['ffconcat version 1.0'];
    for (const event of model.events) {
      lines.push(`file '${event.frameFile}'`);
      lines.push(`duration ${(event.duration / model.fps).toFixed(9)}`);
    }
    if (model.events.length) lines.push(`file '${model.events[model.events.length - 1].frameFile}'`);
    return lines.join('\n') + '\n';
  },

  recipe(model) {
    const audio = model.audio.filter((track) => !track.muted);
    const inputs = audio.map((track) => `-i "${track.file}"`).join(' ');
    const chains = audio.map((track, index) => {
      const offset = track.offsetFrames / model.fps;
      const timing = offset >= 0 ? `adelay=${Math.round(offset * 1000)}|${Math.round(offset * 1000)}` : `atrim=start=${(-offset).toFixed(6)},asetpts=PTS-STARTPTS`;
      return `[${index + 1}:a]${timing},volume=${track.volume}[a${index}]`;
    });
    const mix = audio.length ? `${chains.join(';')}\n${audio.map((_, i) => `[a${i}]`).join('')}amix=inputs=${audio.length}:normalize=0[aout]` : '';
    const audioArgs = audio.length ? `${inputs} -filter_complex "${mix.replace(/\n/g, ';')}" -map 0:v -map "[aout]"` : '-an';
    const header = [
      '# MOTK Shoot conform recipe', `# Project: ${model.projectName}`, `# Edit: ${model.activeEditName}`,
      `# Rate: ${model.fps} fps`, `# Frames: ${model.totalFrames}`, `# Monitor desqueeze: ${model.desqueeze}x`,
      '# Run these commands from the take folder. Keep backup.zip and raw/ unchanged.', '',
      '# ProRes 422 HQ master',
      `ffmpeg -safe 0 -f concat -i conform_active_edit.ffconcat ${audioArgs} -r ${model.fps} -c:v prores_ks -profile:v 3 -pix_fmt yuv422p10le -c:a pcm_s24le master_prores_422hq.mov`, '',
      '# DNxHR HQ master',
      `ffmpeg -safe 0 -f concat -i conform_active_edit.ffconcat ${audioArgs} -r ${model.fps} -c:v dnxhd -profile:v dnxhr_hq -pix_fmt yuv422p -c:a pcm_s24le master_dnxhr_hq.mov`, '',
      '# H.264 review file',
      `ffmpeg -safe 0 -f concat -i conform_active_edit.ffconcat ${audioArgs} -r ${model.fps} -c:v libx264 -crf 17 -pix_fmt yuv420p -c:a aac -b:a 320k review_h264.mp4`, '',
      '# RAW conform notes',
      '# The EDL, AAF-lite JSON, and editorial.json retain the original RAW file mapping.',
      '# Decode/develop camera RAW files in a color-managed application, then relink by capture ID/event.',
      '# Do not rename or delete raw/ originals. frames/ is the portable offline/reference source.',
    ];
    return header.join('\n') + '\n';
  },

  async package() {
    const model = await this.model();
    if (!model.events.length) throw new Error('The active edit has no frames');
    return {
      model,
      files: {
        'editorial.edl': this.edl(model), 'editorial.fcpxml': this.fcpxml(model),
        'editorial_aaf_lite.json': this.aafLite(model), 'editorial.json': JSON.stringify(model, null, 2) + '\n',
        'conform_active_edit.ffconcat': this.concat(model), 'conform_recipe.txt': this.recipe(model),
      },
    };
  },

  async download(kind) {
    const pack = await this.package();
    const map = { edl: 'editorial.edl', fcpxml: 'editorial.fcpxml', aaf: 'editorial_aaf_lite.json', recipe: 'conform_recipe.txt', concat: 'conform_active_edit.ffconcat' };
    const name = map[kind]; if (!name) throw new Error('Unknown editorial format');
    const mime = name.endsWith('.json') ? 'application/json' : name.endsWith('.fcpxml') ? 'application/xml' : 'text/plain';
    K.downloadBlob(`${this._base()}_${name}`, new Blob([pack.files[name]], { type: `${mime};charset=utf-8` }));
    K.toast(`${name} generated`, 'ok');
  },

  async writePackage({ quiet = false } = {}) {
    const context = K.production.currentContext();
    if (!context) throw new Error('Open a production take first');
    if (!K.tether.connected) throw new Error('Connect the production agent first');
    const pack = await this.package();
    await K.tether.folderEditorial(context, pack.files);
    if (!quiet) K.toast('Editorial hand-off package written to the take folder', 'ok', 4000);
    return pack;
  },
};
