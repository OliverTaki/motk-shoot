import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../css/app.css', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const manifest = await readFile(new URL('../manifest.json', import.meta.url), 'utf8');

for (const required of [
  '@media (max-width: 720px) and (orientation: portrait)',
  'grid-template-rows: minmax(210px, 1fr) 188px',
  '#btnCapture::after',
  'content: "CAPTURE"',
  'padding-bottom: env(safe-area-inset-bottom)',
]) assert.match(css, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

assert.match(html, /phones, tablets and desktops/);
assert.match(manifest, /phones, tablets and desktops/);
assert.doesNotMatch(`${css}\n${html}`, /iPhone|Android|userAgent|navigator\.platform/i);
assert.match(css, /#center \{ display: grid; grid-template-columns: 1fr 292px;/);

console.log('MOTK Shoot mobile layout self-test: PASS');
