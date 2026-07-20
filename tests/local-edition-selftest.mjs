import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const [html, css, shell, main, sw] = await Promise.all([
  read('index.html'), read('css/local-edition.css'), read('js/local-edition.js'), read('js/main.js'), read('sw.js'),
]);

assert.match(html, /css\/local-edition\.css/);
assert.match(html, /js\/local-edition\.js/);
assert.match(shell, /params\.get\('edition'\) === 'local'/);
assert.match(shell, /MOTK Shoot Local/);
assert.match(shell, /__motk_ping/);
assert.match(shell, /openPanel\('session', 'session'\)/);
for (const selector of ['link', 'review', 'production']) assert.match(css, new RegExp(`\\[data-tab="${selector}"\\]`));
assert.match(css, /\.local-external/);

for (const id of [
  'btnCapture', 'btnTestCapture', 'btnLive', 'btnPlay', 'btnLoop', 'btnShort',
  'btnStepBack', 'btnStepFwd', 'btnDelete', 'btnUndo', 'timeline', 'reel',
  'inCaptureHold', 'btnChooseLocalFolder', 'btnExportProj', 'btnImportProj',
  'btnExportVideo', 'btnExportSeq', 'btnReverse', 'btnPingPong', 'btnImportImgs', 'btnXsheet',
]) assert.match(html, new RegExp(`id="${id}"`), `${id} must remain in the local edition core`);

for (const pane of ['onion', 'guides', 'layers', 'audio', 'session', 'export', 'camera', 'project']) {
  assert.match(html, new RegExp(`data-pane="${pane}"`), `${pane} pane must remain available`);
}

const session = html.slice(html.indexOf('data-pane="session"'), html.indexOf('<!-- REVIEW -->'));
assert.match(session, /Local capture folder/);
assert.match(session, /class="local-external"/);
const exportPane = html.slice(html.indexOf('data-pane="export"'), html.indexOf('<!-- LINK -->'));
for (const heading of ['Movie', 'Image sequence', 'Project', 'Edit sequence']) assert.match(exportPane, new RegExp(`<h3>${heading}<\\/h3>`));
assert.match(exportPane, /class="local-external"/);

assert.match(main, /!window\.MOTK_LOCAL_EDITION && 'serviceWorker' in navigator/);
assert.match(sw, /motkshoot-v27/);
assert.match(sw, /js\/local-edition\.js/);
assert.match(sw, /css\/local-edition\.css/);

console.log('MOTK Shoot Local edition self-test: PASS');
