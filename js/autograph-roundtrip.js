/* MOTK Shoot - Maxon Autograph material/template exchange without fabricating .agp. */
'use strict';
K.autographRoundtrip = K.postAdapter.create({
  stateKey: 'autographRoundtrip', eventName: 'autograph', label: 'Autograph', shortName: 'AUTOGRAPH',
  pickerId: 'motk-autograph-exchange', rootName: 'MOTK_AUTOGRAPH_EXCHANGE', marker: '.motk-autograph-root',
  schema: 'motk-autograph-roundtrip/1', returnRole: 'autograph-return',

  _csv(value) { const text = String(value ?? ''); return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; },
  _importList(manifest) {
    const rows = [['order', 'role', 'name', 'relative_path', 'record_in', 'duration_frames', 'stable_id']];
    manifest.sequence.references.forEach((item, index) => rows.push([index + 1, item.role || 'reference', item.name, item.media, 0, manifest.sequence.durationFrames, item.id]));
    manifest.sequence.events.forEach((item, index) => rows.push([index + 1, 'photography', item.captureId, item.media, item.recordIn, item.durationFrames, item.stableId]));
    return rows.map((row) => row.map((cell) => this._csv(cell)).join(',')).join('\r\n') + '\r\n';
  },
  _template(manifest) {
    return JSON.stringify({
      schema: 'motk-autograph-shot-template/1',
      note: 'Neutral MOTK template description, not an Autograph .agp file or clipboard payload.',
      composition: { name: manifest.projectKey, width: manifest.width, height: manifest.height, fps: manifest.fps, durationFrames: manifest.sequence.durationFrames },
      recommendedStacks: [
        { name: 'MOTK_RETURN', purpose: 'Rendered comp returned to the camera room; keep the source package immutable.' },
        { name: 'PHOTOGRAPHY', purpose: 'Connect media/captures in import-list.csv order and apply record-in/hold timing.' },
        { name: 'PREVIS_REFERENCE', purpose: 'Connect media/references as non-destructive reference layers.' },
      ],
      packageId: manifest.id,
    }, null, 2) + '\n';
  },
  _returnScript() {
    return `#!/usr/bin/env python3\n\"\"\"Copy one Autograph render into an append-only MOTK return folder.\"\"\"\nfrom pathlib import Path\nimport json, shutil, tkinter as tk\nfrom tkinter import filedialog\nbase = Path(__file__).resolve().parent.parent\nmanifest = json.loads((base / 'autograph-package.json').read_text(encoding='utf-8'))\nroot = base.parent.parent\nui = tk.Tk(); ui.withdraw()\nselected = filedialog.askopenfilename(title='Choose the rendered Autograph preview')\nui.destroy()\nif not selected: raise SystemExit(0)\nreturns = root / 'returns'; returns.mkdir(exist_ok=True)\nnumber = 1\nwhile (returns / ('return_%04d' % number)).exists(): number += 1\nout = returns / ('return_%04d' % number); out.mkdir()\nsource = Path(selected); media = 'preview' + source.suffix.lower()\nshutil.copy2(source, out / media)\nrecord = {'schema': manifest['schema'], 'kind': 'return', 'id': out.name, 'label': 'Autograph ' + out.name, 'media': media}\n(out / 'return.json').write_text(json.dumps(record, indent=2) + '\\n', encoding='utf-8')\n(out / 'READY').write_text(out.name + '\\n', encoding='utf-8')\nprint('MOTK Autograph return published:', out)\n`;
  },
  _readme(id, hasTemplate) {
    return [`MOTK Shoot -> Maxon Autograph (${id})`, '', '1. Keep this package together; every media path is relative.', hasTemplate ? '2. Open template/WORKING_TEMPLATE.agp. It is an unchanged copy of the template you selected in MOTK Shoot.' : '2. Create a new Autograph project with the raster, fps, and duration in shot-template.json.', '3. In the Project Panel use Ctrl/Cmd+I (or Import Files) and connect the files listed in import-list.csv.', '4. Build the PHOTOGRAPHY and PREVIS_REFERENCE stacks from shot-template.json. Existing Autograph work remains compositor-owned.', '5. Use File > Collect Files from Project with COPY enabled before handing the project to another machine.', '6. Render a preview, then run helpers/PUBLISH_RETURN.py or import that preview manually in MOTK Shoot.', '', 'MOTK does not generate or rewrite .agp files. Automatic .agp/clipboard generation remains disabled until its exact Autograph schema is proven.'].join('\r\n');
  },
  async buildPackage({ includeCaptured = true, templateFile = null } = {}) {
    const state = this._state();
    const number = Math.max(1, (state.packages || 0) + 1);
    const id = `package_${String(number).padStart(4, '0')}`;
    const base = `packages/${id}`;
    const media = await this.collectMedia({ includeCaptured });
    const manifest = this.manifest('package', id, media, state.plannedFrames);
    manifest.autograph = { projectGenerated: false, suppliedTemplateIncluded: !!templateFile, importMode: 'connect-external-media', collectFilesMode: 'copy' };
    const files = media.files.map((file) => ({ name: `${base}/${file.name}`, data: file.data }));
    if (templateFile) files.push({ name: `${base}/template/WORKING_TEMPLATE.agp`, data: new Uint8Array(await templateFile.arrayBuffer()) });
    files.push(
      { name: `${base}/autograph-package.json`, data: this._json(manifest) },
      { name: `${base}/import-list.csv`, data: this._enc(this._importList(manifest)) },
      { name: `${base}/shot-template.json`, data: this._enc(this._template(manifest)) },
      { name: `${base}/helpers/PUBLISH_RETURN.py`, data: this._enc(this._returnScript()) },
      { name: `${base}/README.txt`, data: this._enc(this._readme(id, !!templateFile)) },
      { name: `${base}/READY`, data: this._enc(`${id}\n`), ready: true },
    );
    return { id, number, versionDir: base, manifest, files };
  },
});
