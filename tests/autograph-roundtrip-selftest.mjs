import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const shared = fs.readFileSync(new URL('js/post-adapter.js', root), 'utf8');
const source = fs.readFileSync(new URL('js/autograph-roundtrip.js', root), 'utf8');
const html = fs.readFileSync(new URL('index.html', root), 'utf8');
const capture = new Blob(['capture'], { type: 'image/jpeg' });
Object.defineProperty(capture, 'name', { value: 'capture.jpg' });
const template = new Blob(['unchanged-agp'], { type: 'application/octet-stream' });
Object.defineProperty(template, 'name', { value: 'studio.agp' });
const project = { id: 'p1', name: 'Autograph Test', fps: 24, settings: { resPreset: '3840x2160', autographRoundtrip: { packages: 0, returns: [], plannedFrames: 240 } } };
const K = {
  clamp: (n, min, max) => Math.max(min, Math.min(max, n)), bus: { on() {}, emit() {} },
  project: { current: project, async save() {}, saveSoon() {} }, layers: { list: [] },
  frames: { size: () => ({ w: 3840, h: 2160 }), getBlob: async () => capture },
  editorial: { model: async () => ({ totalFrames: 0, events: [] }) }, db: { async get() { return null; } },
};
vm.runInContext(shared + '\n' + source, vm.createContext({ K, window: {}, TextEncoder, Uint8Array, Blob, console, setInterval, clearInterval }), { filename: 'autograph-roundtrip.js' });
const pack = await K.autographRoundtrip.buildPackage({ includeCaptured: false, templateFile: template });
assert.equal(pack.manifest.sequence.mode, 'previs-first');
assert.equal(pack.manifest.sequence.durationFrames, 240);
assert.equal(pack.manifest.autograph.projectGenerated, false);
assert.equal(pack.manifest.autograph.suppliedTemplateIncluded, true);
assert(pack.files.some((file) => file.name.endsWith('/template/WORKING_TEMPLATE.agp')));
assert.equal(new TextDecoder().decode(pack.files.find((file) => file.name.endsWith('/template/WORKING_TEMPLATE.agp')).data), 'unchanged-agp');
const readme = new TextDecoder().decode(pack.files.find((file) => file.name.endsWith('/README.txt')).data);
assert.match(readme, /does not generate or rewrite \.agp files/);
assert.equal(pack.files.at(-1).name, 'packages/package_0001/READY');
for (const id of ['btnAutographTemplate', 'btnAutographPackage', 'btnAutographReturn']) assert(html.includes(`id="${id}"`));
console.log('MOTK Shoot Autograph round-trip self-test: PASS');
