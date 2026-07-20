import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const source = fs.readFileSync(new URL('js/ae-roundtrip.js', root), 'utf8');
const html = fs.readFileSync(new URL('index.html', root), 'utf8');
const layersSource = fs.readFileSync(new URL('js/layers.js', root), 'utf8');
const uiSource = fs.readFileSync(new URL('js/ui.js', root), 'utf8');
const sw = fs.readFileSync(new URL('sw.js', root), 'utf8');

const project = {
  id: 'p_test', name: 'Previs Test', fps: 12, shotId: 'SH010', take: 1,
  settings: { resPreset: '1920x1080', aeRoundtrip: { initial: 0, delivery: 0, returns: [], plannedFrames: 96 } },
};
const previs = new Blob(['previs'], { type: 'image/png' });
Object.defineProperty(previs, 'name', { value: 'layout.png' });
const capture = new Blob(['capture'], { type: 'image/jpeg' });
Object.defineProperty(capture, 'name', { value: 'capture.jpg' });
let frameCount = 0;
const events = [{ event: 1, captureId: 'f_001', duration: 2, recordIn: 0, recordOut: 2, rawFiles: ['raw/f_001.dng'] }];

const K = {
  clamp: (n, min, max) => Math.max(min, Math.min(max, n)),
  bus: { on() {}, emit() {} },
  project: { current: project, async save() {}, saveSoon() {} },
  layers: {
    list: [{ id: 'l_previs', assetId: 'a_previs', type: 'image', name: 'Layout', sourceName: 'layout.png', role: 'previs', opacity: 0.6, x: 2, y: 3, scale: 100, rot: 0 }],
  },
  frames: {
    captures: [{ id: 'f_001', w: 1920, h: 1080 }], count: () => frameCount, size: () => ({ w: 1920, h: 1080 }),
    getBlob: async () => capture,
  },
  db: { get: async (store, id) => store === 'assets' && id === 'a_previs' ? { blob: previs } : null },
  editorial: { model: async () => ({ fps: 12, totalFrames: 2, events }) },
};
const context = vm.createContext({ K, window: {}, TextEncoder, Blob, console, setInterval, clearInterval });
vm.runInContext(source, context, { filename: 'ae-roundtrip.js' });

const ae = K.aeRoundtrip;
const initial = await ae.buildInitial({ includeCaptured: true });
assert.equal(initial.manifest.sequence.mode, 'previs-first', 'zero-capture projects must create a previs-first package');
assert.equal(initial.manifest.sequence.durationFrames, 96, 'planned duration must seed the blank AE comp');
assert(initial.manifest.sequence.layers.some((layer) => layer.role === 'previs'));
assert(initial.files.some((file) => file.name.endsWith('/scripts/BUILD_MOTK_AE_PROJECT.jsx')));
assert(initial.files.at(-1).ready, 'READY must be the final package commit marker');
assert(!JSON.stringify(initial.manifest).match(/[A-Z]:\\/), 'manifest must not contain Windows absolute paths');
assert.match(ae._builderJsx(), /target\.exists.*throw new Error/s, 'builder must refuse to overwrite an existing .aep');
assert.match(ae._builderJsx(), /guideLayer=true/, 'previs/reference must become AE guide layers');
assert.match(ae._builderJsx(), /ADBE Transform Group/, 'generated JSX must use locale-independent AE match names');

frameCount = 1;
const delivery = await ae.buildDelivery('Character A');
assert.equal(delivery.manifest.kind, 'delivery');
assert.equal(delivery.manifest.sequence.sourceLayer.name, 'Character A');
assert.equal(delivery.manifest.sequence.layers[0].durationFrames, 2, 'MOTK hold timing must survive delivery');
assert(delivery.files.some((file) => file.name.endsWith('/media/captures/f_001.jpg')));
assert.match(ae._deliveryJsx(), /MOTK_DELIVERY:/, 'delivery import must have a stable dedupe tag');
assert.match(ae._deliveryJsx(), /app\.project\.save\(\)/, 'delivery must update the existing working project');
assert.match(ae._deliveryJsx(), /activeItem instanceof CompItem/, 'an independently prepared previs comp must be accepted');
assert.match(ae._returnJsx(), /return\.json/);
assert.match(ae._returnJsx(), /READY/);

for (const id of ['btnAePrevis', 'btnAeFolder', 'btnAeInitial', 'btnAeDelivery', 'btnAeWatch', 'btnAeReturn']) assert(html.includes(`id="${id}"`));
assert(html.indexOf('js/ae-roundtrip.js') < html.indexOf('js/ui.js'), 'AE module must load before UI');
assert.match(layersSource, /async addVideo\(file, options = \{\}\)/);
assert.match(source, /role: 'ae-return'/m, 'returned-media role must be assigned by the AE module contract');
assert.match(uiSource, /\.\.\.existing/, 'UI persistence must retain independent AE round-trip state');
assert.match(sw, /motkshoot-v27/);
assert.match(sw, /js\/ae-roundtrip\.js/);

console.log('MOTK Shoot AE round-trip self-test: PASS');
