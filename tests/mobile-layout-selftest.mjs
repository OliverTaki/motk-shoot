import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../css/app.css', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const manifest = await readFile(new URL('../manifest.json', import.meta.url), 'utf8');

for (const required of [
  '@media (max-width: 720px) and (orientation: portrait)',
  '@media (max-height: 600px) and (orientation: landscape) and (max-width: 1180px)',
  'body.panel-open #center',
  'grid-template-rows: minmax(210px, 1fr) minmax(260px, 44dvh)',
  '#btnCapture::after',
  'content: "CAPTURE"',
  'padding-bottom: env(safe-area-inset-bottom)',
  'body.focus-mode #viewportWrap',
  'body.focus-controls-hidden #focusHud',
  '#transport .transport-secondary { display: none !important; }',
  '#btnTransportMore { display: inline-flex',
  '#waveform, #timeline { display: none !important; }',
]) assert.match(css, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

assert.match(html, /phones, tablets and desktops/);
assert.match(manifest, /phones, tablets and desktops/);
assert.doesNotMatch(`${css}\n${html}`, /userAgent|navigator\.platform/i);
assert.match(css, /#center \{ display: grid; grid-template-columns: 1fr;/);
assert.match(html, /id="btnFocus"/);
assert.match(html, /id="btnFocusHide"/);
assert.match(html, /id="btnFocusPlay"/);
assert.match(html, /id="btnQuickCamera"/);
assert.match(html, /id="cameraQuickModal"/);
assert.match(html, /id="storageChoiceModal"/);
assert.match(css, /body\.focus-mode #focusHud \{[\s\S]*pointer-events: auto;/);
assert.match(css, /#btnQuickCamera \{ display: inline-flex;/);
assert.doesNotMatch(html, /id="btnFocus(?:Live|Test)"/);
assert.match(html, /id="shootingControlsModal"/);
assert.match(css, /\.transport-secondary \{ display: inline-flex; \}/);
assert.match(css, /#btnTransportMore \{ display: none;/);

console.log('MOTK Shoot mobile layout self-test: PASS');
