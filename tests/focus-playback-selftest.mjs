import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const playback = await readFile(new URL('../js/playback.js', import.meta.url), 'utf8');
const ui = await readFile(new URL('../js/ui.js', import.meta.url), 'utf8');

assert.match(playback, /loopOverride = null/);
assert.match(playback, /this\._runLoop = loopOverride === null \? this\.loop : !!loopOverride/);
assert.match(playback, /if \(this\._runLoop && !this\._short\)/);
assert.match(ui, /#btnFocusPlay'[\s\S]*loopOverride: true/);
assert.match(ui, /#btnFocusPlay'\)\.textContent = K\.playback\.playing \? 'PAUSE' : 'PLAY'/);

console.log('MOTK Shoot focus playback self-test: PASS');
