import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const shared = fs.readFileSync(new URL('js/post-adapter.js', root), 'utf8');
const source = fs.readFileSync(new URL('js/resolve-roundtrip.js', root), 'utf8');
const html = fs.readFileSync(new URL('index.html', root), 'utf8');
const sw = fs.readFileSync(new URL('sw.js', root), 'utf8');
const capture = new Blob(['capture'], { type: 'image/jpeg' });
Object.defineProperty(capture, 'name', { value: 'capture.jpg' });
const project = { id: 'p1', name: 'Resolve Test', fps: 12, shotId: 'SH010', settings: { resPreset: '1920x1080', resolveRoundtrip: { packages: 0, returns: [], plannedFrames: 96 } } };
const K = {
  clamp: (n, min, max) => Math.max(min, Math.min(max, n)), bus: { on() {}, emit() {} },
  project: { current: project, async save() {}, saveSoon() {} }, layers: { list: [] },
  frames: { size: () => ({ w: 1920, h: 1080 }), getBlob: async () => capture },
  editorial: { model: async () => ({ totalFrames: 2, events: [{ captureId: 'f_001', recordIn: 0, duration: 2, rawFiles: ['raw/f_001.dng'], note: '' }] }) },
  db: { async get() { return null; } },
};
vm.runInContext(shared + '\n' + source, vm.createContext({ K, window: {}, TextEncoder, Uint8Array, Blob, console, setInterval, clearInterval }), { filename: 'resolve-roundtrip.js' });
const pack = await K.resolveRoundtrip.buildPackage({ includeCaptured: true });
assert.equal(pack.manifest.sequence.mode, 'capture-first');
assert.equal(pack.manifest.sequence.events[0].durationFrames, 2);
assert.equal(pack.files.at(-1).name, 'packages/package_0001/READY');
assert(pack.files.at(-1).ready, 'READY must be written last');
const text = (name) => new TextDecoder().decode(pack.files.find((file) => file.name.endsWith(name)).data);
assert.match(text('timeline.fcpxml'), /duration="2\/12s"/);
const otio = JSON.parse(text('timeline.otio'));
assert.equal(otio.OTIO_SCHEMA, 'Timeline.1');
const otioClip = otio.tracks.children[0].children[0];
assert.equal(otioClip.OTIO_SCHEMA, 'Clip.2');
assert.equal(otioClip.active_media_reference_key, 'DEFAULT_MEDIA');
assert.equal(otioClip.media_references.DEFAULT_MEDIA.target_url, 'media/captures/f_001.jpg');
assert.equal(otioClip.media_reference, undefined, 'Clip.2 must not use the removed Clip.1 media_reference field');
assert.match(text('IMPORT_MOTK_RESOLVE.py'), /ImportTimelineFromFile/);
assert.match(text('IMPORT_MOTK_RESOLVE.py'), /file:\/\/\/MOTK_PACKAGE/);
assert.match(text('IMPORT_MOTK_RESOLVE.py'), /base\.as_uri\(\)/);
assert.match(text('IMPORT_MOTK_RESOLVE.py'), /NamedTemporaryFile/);
assert.match(text('IMPORT_MOTK_RESOLVE.py'), /Refusing to replace existing timeline/);
assert(!JSON.stringify(pack.manifest).match(/[A-Z]:\\/), 'manifest must contain no absolute Windows path');
for (const id of ['btnResolveFolder', 'btnResolvePackage', 'btnResolveWatch', 'btnResolveReturn']) assert(html.includes(`id="${id}"`));
assert(html.indexOf('js/post-adapter.js') < html.indexOf('js/resolve-roundtrip.js'));
assert.match(sw, /motkshoot-v28/);
assert.match(sw, /js\/resolve-roundtrip\.js/);
console.log('MOTK Shoot Resolve round-trip self-test: PASS');
