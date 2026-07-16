import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../js/playback.js', import.meta.url), 'utf8');
const bitmap = { id: 'bitmap-1' };
const events = [];
let invalidations = 0;
let timerId = 0;

const K = {
  clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
  toast: (message) => { throw new Error(message); },
  project: { current: { fps: 12 } },
  frames: {
    list: [{ id: 'frame-1' }],
    _bitmaps: new Map(),
    count: () => 1,
    expanded: () => [0],
    getBitmap: async () => bitmap,
  },
  viewport: {
    mode: 'live', playing: false, playExp: null, playBitmap: null,
    invalidate: () => { invalidations += 1; },
    setMode: () => {},
  },
  audio: { startPlayback: () => {}, stopPlayback: () => {} },
  bus: { emit: (name, payload) => events.push({ name, payload }) },
};

const context = vm.createContext({
  K,
  performance: { now: () => 0 },
  setTimeout: () => ++timerId,
  clearTimeout: () => {},
});
vm.runInContext(source, context);

await K.playback.play();
assert.equal(K.playback.playing, true);
assert.equal(K.viewport.playBitmap, bitmap, 'first bitmap is installed before playback clock runs');
assert.equal(K.viewport.playExp, 0);
assert.equal(invalidations, 1);
assert.ok(events.some((event) => event.name === 'playback:frame' && event.payload.exposure === 0));

K.playback.stop();
assert.equal(K.playback.playing, false);
assert.equal(K.viewport.playing, false);

console.log('MOTK Shoot playback self-test: PASS');
