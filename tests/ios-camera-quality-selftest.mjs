import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [camera, ui, html, sw] = await Promise.all([
  readFile(new URL('js/camera.js', root), 'utf8'),
  readFile(new URL('js/ui.js', root), 'utf8'),
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('sw.js', root), 'utf8'),
]);

assert.match(camera, /compactDevices/);
assert.match(camera, /Back camera/);
assert.match(camera, /Front camera/);
assert.match(camera, /getPhotoCapabilities/);
assert.match(camera, /imageWidth = caps\.imageWidth\.max/);
assert.match(camera, /imageHeight = caps\.imageHeight\.max/);
assert.match(camera, /method: 'device-photo'/);
assert.match(camera, /method: 'live-view-frame'/);
assert.match(ui, /s\.photoMode !== undefined \? !!s\.photoMode : !!window\.ImageCapture/);
assert.match(html, /id="cameraQualityStatus"/);
assert.match(html, /id="quickCameraQuality"/);
assert.match(sw, /motkshoot-v28/);

console.log('MOTK Shoot iOS camera quality self-test: PASS');
