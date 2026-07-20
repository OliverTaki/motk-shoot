/* MOTK Shoot - DaVinci Resolve exchange: FCPXML, OTIO, and official API helper. */
'use strict';
K.resolveRoundtrip = K.postAdapter.create({
  stateKey: 'resolveRoundtrip', eventName: 'resolve', label: 'Resolve', shortName: 'RESOLVE',
  pickerId: 'motk-resolve-exchange', rootName: 'MOTK_RESOLVE_EXCHANGE', marker: '.motk-resolve-root',
  schema: 'motk-resolve-roundtrip/1', returnRole: 'resolve-return',

  _xml(value) { return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); },
  _fcpxml(manifest) {
    const rate = manifest.fps;
    const events = manifest.sequence.events;
    const resources = events.map((event, index) => `    <asset id="r${index + 2}" name="${this._xml(event.captureId)}" start="0s" duration="86400s" hasVideo="1" format="r1"><media-rep kind="original-media" src="file:///MOTK_PACKAGE/${this._xml(event.media)}"/></asset>`).join('\n');
    const clips = events.map((event, index) => `              <asset-clip ref="r${index + 2}" name="${this._xml(event.captureId)}" offset="${event.recordIn}/${rate}s" start="0s" duration="${event.durationFrames}/${rate}s"><note>${this._xml(event.note || event.rawFiles.join(' ; '))}</note></asset-clip>`).join('\n');
    const body = clips || `              <gap name="MOTK PREVIS TIMING" offset="0s" duration="${manifest.sequence.durationFrames}/${rate}s"/>`;
    return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n<fcpxml version="1.10">\n  <resources>\n    <format id="r1" name="MOTK ${rate}fps" frameDuration="1/${rate}s" width="${manifest.width}" height="${manifest.height}"/>\n${resources}\n  </resources>\n  <library><event name="MOTK Shoot"><project name="${this._xml(manifest.projectKey)}"><sequence format="r1" duration="${manifest.sequence.durationFrames}/${rate}s" tcStart="0s" tcFormat="NDF"><spine>\n${body}\n            </spine><metadata><md key="com.motkshoot.exchange" value="${manifest.id}"/></metadata></sequence></project></event></library>\n</fcpxml>\n`;
  },
  _otioTime(value, rate) { return { OTIO_SCHEMA: 'RationalTime.1', value, rate }; },
  _otioRange(start, duration, rate) { return { OTIO_SCHEMA: 'TimeRange.1', start_time: this._otioTime(start, rate), duration: this._otioTime(duration, rate) }; },
  _otio(manifest) {
    const rate = manifest.fps;
    const children = manifest.sequence.events.map((event) => ({
      OTIO_SCHEMA: 'Clip.2', name: event.captureId,
      metadata: { motk: { stableId: event.stableId, rawFiles: event.rawFiles, note: event.note } },
      source_range: this._otioRange(0, event.durationFrames, rate),
      media_references: { DEFAULT_MEDIA: { OTIO_SCHEMA: 'ExternalReference.1', name: event.captureId, target_url: event.media, available_range: this._otioRange(0, Math.max(1, event.durationFrames), rate), available_image_bounds: null, metadata: {} } },
      active_media_reference_key: 'DEFAULT_MEDIA',
      effects: [], markers: [], enabled: true, color: null,
    }));
    if (!children.length) children.push({ OTIO_SCHEMA: 'Gap.1', name: 'MOTK PREVIS TIMING', source_range: this._otioRange(0, manifest.sequence.durationFrames, rate), effects: [], markers: [], enabled: true, color: null, metadata: {} });
    return JSON.stringify({
      OTIO_SCHEMA: 'Timeline.1', name: manifest.projectKey,
      global_start_time: this._otioTime(0, rate), metadata: { motk: { schema: manifest.schema, packageId: manifest.id, mode: manifest.sequence.mode } },
      tracks: { OTIO_SCHEMA: 'Stack.1', name: 'tracks', source_range: null, effects: [], markers: [], enabled: true, color: null, metadata: {}, children: [{ OTIO_SCHEMA: 'Track.1', name: 'V1 Photography', kind: 'Video', source_range: null, effects: [], markers: [], enabled: true, color: null, metadata: {}, children }] },
    }, null, 2) + '\n';
  },
  _importScript() {
    return `#!/usr/bin/env python3\n\"\"\"Run from Resolve Workspace > Scripts after opening the destination project.\"\"\"\nfrom pathlib import Path\nimport json\nimport tempfile\n\nbase = Path(__file__).resolve().parent.parent\nmanifest = json.loads((base / 'resolve-package.json').read_text(encoding='utf-8'))\ntry:\n    resolve\nexcept NameError:\n    import DaVinciResolveScript as dvr\n    resolve = dvr.scriptapp('Resolve')\nif not resolve:\n    raise RuntimeError('DaVinci Resolve scripting connection is unavailable')\npm = resolve.GetProjectManager()\nproject = pm.GetCurrentProject()\nif not project:\n    raise RuntimeError('Open or create the destination Resolve project first')\nmedia_pool = project.GetMediaPool()\nname = manifest['projectKey'] + '_' + manifest['id']\nfor index in range(1, project.GetTimelineCount() + 1):\n    if project.GetTimelineByIndex(index).GetName() == name:\n        raise RuntimeError('Refusing to replace existing timeline: ' + name)\nroot = media_pool.GetRootFolder()\nfolder = media_pool.AddSubFolder(root, 'MOTK ' + manifest['id'])\nif folder:\n    media_pool.SetCurrentFolder(folder)\npaths = [str(base / item['media']) for item in manifest['sequence']['references']]\nif paths:\n    media_pool.ImportMedia(paths)\noptions = {'timelineName': name, 'importSourceClips': True, 'sourceClipsPath': str(base / 'media' / 'captures')}\nxml_text = (base / 'timeline.fcpxml').read_text(encoding='utf-8').replace('file:///MOTK_PACKAGE/', base.as_uri().rstrip('/') + '/')\nresolved_xml = None\nresolved_otio = None\ntry:\n    with tempfile.NamedTemporaryFile('w', suffix='.fcpxml', delete=False, encoding='utf-8') as handle:\n        handle.write(xml_text)\n        resolved_xml = Path(handle.name)\n    timeline = media_pool.ImportTimelineFromFile(str(resolved_xml), options)\n    if not timeline:\n        otio = json.loads((base / 'timeline.otio').read_text(encoding='utf-8'))\n        def resolve_urls(value):\n            if isinstance(value, dict):\n                for key, item in value.items():\n                    if key == 'target_url' and isinstance(item, str) and '://' not in item:\n                        value[key] = (base / item).resolve().as_uri()\n                    else:\n                        resolve_urls(item)\n            elif isinstance(value, list):\n                for item in value:\n                    resolve_urls(item)\n        resolve_urls(otio)\n        with tempfile.NamedTemporaryFile('w', suffix='.otio', delete=False, encoding='utf-8') as handle:\n            json.dump(otio, handle, indent=2)\n            handle.write('\\n')\n            resolved_otio = Path(handle.name)\n        timeline = media_pool.ImportTimelineFromFile(str(resolved_otio), options)\nfinally:\n    if resolved_xml:\n        resolved_xml.unlink(missing_ok=True)\n    if resolved_otio:\n        resolved_otio.unlink(missing_ok=True)\nif not timeline:\n    raise RuntimeError('Resolve could not import timeline.fcpxml or timeline.otio')\nproject.SetCurrentTimeline(timeline)\npm.SaveProject()\nprint('MOTK Resolve timeline imported:', timeline.GetName())\n`;
  },
  _returnScript() {
    return `#!/usr/bin/env python3\n\"\"\"Copy one rendered preview into an append-only MOTK return folder.\"\"\"\nfrom pathlib import Path\nimport json, shutil, tkinter as tk\nfrom tkinter import filedialog\nbase = Path(__file__).resolve().parent.parent\nmanifest = json.loads((base / 'resolve-package.json').read_text(encoding='utf-8'))\nroot = base.parent.parent\nui = tk.Tk(); ui.withdraw()\nselected = filedialog.askopenfilename(title='Choose the rendered Resolve preview')\nui.destroy()\nif not selected:\n    raise SystemExit(0)\nreturns = root / 'returns'; returns.mkdir(exist_ok=True)\nnumber = 1\nwhile (returns / ('return_%04d' % number)).exists(): number += 1\nout = returns / ('return_%04d' % number); out.mkdir()\nsource = Path(selected); media = 'preview' + source.suffix.lower()\nshutil.copy2(source, out / media)\nrecord = {'schema': manifest['schema'], 'kind': 'return', 'id': out.name, 'label': 'Resolve ' + out.name, 'media': media}\n(out / 'return.json').write_text(json.dumps(record, indent=2) + '\\n', encoding='utf-8')\n(out / 'READY').write_text(out.name + '\\n', encoding='utf-8')\nprint('MOTK Resolve return published:', out)\n`;
  },
  _readme(id) {
    return [`MOTK Shoot -> DaVinci Resolve (${id})`, '', '1. Keep this package together; every path is relative.', '2. Open or create the destination Resolve project.', '3. Run scripts/IMPORT_MOTK_RESOLVE.py from Workspace > Scripts, or import timeline.fcpxml / timeline.otio manually.', '4. The helper refuses to replace a timeline with the same package name.', '5. Work and render normally. Never rename or delete package media.', '6. Run scripts/PUBLISH_RETURN.py or import a rendered preview manually in MOTK Shoot.', '', 'Previs-first packages contain blank timing plus reference materials. Photography-first packages contain the active edit and exact frame holds.'].join('\r\n');
  },
  async buildPackage({ includeCaptured = true } = {}) {
    const state = this._state();
    const number = Math.max(1, (state.packages || 0) + 1);
    const id = `package_${String(number).padStart(4, '0')}`;
    const base = `packages/${id}`;
    const media = await this.collectMedia({ includeCaptured });
    const manifest = this.manifest('package', id, media, state.plannedFrames);
    const files = media.files.map((file) => ({ name: `${base}/${file.name}`, data: file.data }));
    files.push(
      { name: `${base}/resolve-package.json`, data: this._json(manifest) },
      { name: `${base}/timeline.fcpxml`, data: this._enc(this._fcpxml(manifest)) },
      { name: `${base}/timeline.otio`, data: this._enc(this._otio(manifest)) },
      { name: `${base}/scripts/IMPORT_MOTK_RESOLVE.py`, data: this._enc(this._importScript()) },
      { name: `${base}/scripts/PUBLISH_RETURN.py`, data: this._enc(this._returnScript()) },
      { name: `${base}/README.txt`, data: this._enc(this._readme(id)) },
      { name: `${base}/READY`, data: this._enc(`${id}\n`), ready: true },
    );
    return { id, number, versionDir: base, manifest, files };
  },
});
