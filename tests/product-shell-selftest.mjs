import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const [html, css, ui, localFolder, production, sw, design] = await Promise.all([
  read('index.html'), read('css/app.css'), read('js/ui.js'), read('js/local-folder.js'),
  read('js/production.js'), read('sw.js'), read('docs/PRODUCT_DESIGN_2026-07-16.md'),
]);

for (const group of ['assist', 'session', 'settings']) assert.match(html, new RegExp(`data-group="${group}"`));
for (const id of ['btnAssist', 'btnSession', 'btnSettings', 'btnFocus', 'btnFocusHide', 'btnFocusExit']) {
  assert.match(html, new RegExp(`id="${id}"`));
}
assert.match(css, /body\.focus-mode #viewportWrap/);
assert.match(css, /body\.focus-controls-hidden #focusHud/);
assert.match(ui, /openPanel\('assist', 'onion'\)/);
assert.match(ui, /openPanel\('session', 'session'\)/);
assert.match(ui, /openPanel\('settings', 'camera'\)/);

const sessionMarkup = html.slice(html.indexOf('data-pane="session"'), html.indexOf('<!-- REVIEW -->'));
assert.match(sessionMarkup, /Import CSV \/ JSON/);
assert.match(sessionMarkup, /Local capture folder/);
assert.doesNotMatch(sessionMarkup, /GAS URL|Add shot|Create a production/);
assert.match(production, /importContextText/);
assert.match(production, /pullContext/);
assert.doesNotMatch(production.slice(production.indexOf('async endSession'), production.indexOf('async downloadReport')), /editorial\.writePackage/);

assert.match(localFolder, /showDirectoryPicker/);
assert.match(localFolder, /getDirectoryHandle/);
assert.match(localFolder, /_writeUnique/);
assert.match(localFolder, /navigator\.share/);
assert.match(localFolder, /IndexedDB remains the recovery copy/);
assert.match(sw, /js\/local-folder\.js/);
assert.match(design, /It is not the place where a production is designed or a film is edited/);

console.log('MOTK Shoot product shell self-test: PASS');
