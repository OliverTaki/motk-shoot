import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [ui, tether, frames] = await Promise.all([
  readFile(new URL('js/ui.js', root), 'utf8'),
  readFile(new URL('js/tether.js', root), 'utf8'),
  readFile(new URL('js/frames.js', root), 'utf8'),
]);

assert.match(ui, /insert: false/);
assert.match(ui, /if \(tetherP\) await tetherP/);
assert.match(ui, /if \(!test\) K\.frames\.insertCapture\(meta\.id\)/);
assert.match(ui, /if \(meta\) await K\.frames\.discardFailedCapture\(meta\.id\)/);
assert.match(tether, /if \(!res\.ok\) throw new Error/);
assert.match(tether, /Camera shutter failed:/);
assert.match(frames, /async discardFailedCapture\(id\)/);

const insertAt = ui.indexOf("if (!test) K.frames.insertCapture(meta.id)");
const awaitAt = ui.indexOf('if (tetherP) await tetherP');
assert.ok(awaitAt >= 0 && insertAt > awaitAt, 'timeline insertion must happen after tether completion');

console.log('MOTK Shoot capture integrity self-test: PASS');
