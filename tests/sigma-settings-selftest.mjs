import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [agent, helper, tether, ui] = await Promise.all([
  readFile(new URL('bridge/camera-agent.mjs', root), 'utf8'),
  readFile(new URL('bridge/sigma-sdk-helper.ps1', root), 'utf8'),
  readFile(new URL('js/tether.js', root), 'utf8'),
  readFile(new URL('js/ui.js', root), 'utf8'),
]);

for (const path of [
  '/sigma/exposure/mode', '/sigma/exposure/shutter', '/sigma/exposure/aperture',
  '/sigma/exposure/iso-auto', '/sigma/exposure/iso', '/sigma/image/white-balance',
  '/sigma/image/color-mode', '/sigma/image/quality', '/sigma/storage/destination',
]) assert.ok(agent.includes(path), `SIGMA control is missing: ${path}`);

assert.match(agent, /runSigma\('capture', \['-OutputDir', DIR, '-BaseName', base, \.\.\.sigmaOverrideArgs\(\)\]/);
assert.match(agent, /runSigma\('preview', \['-Output', target, \.\.\.sigmaOverrideArgs\(\)\]/);
assert.doesNotMatch(agent, /\[\[1, 'Camera card'\]/, 'MOTK captures must always create a computer original');
assert.match(helper, /ConfigureStillCapture\(ref info, imageQuality, exposureMode, shutterCode, apertureCode, isoAuto, isoCode, whiteBalanceCode, colorModeCode\)/);
assert.match(helper, /Camera does not expose aperture control\. Put the lens aperture ring in Auto\/A\./);
assert.match(helper, /NormalizeCapturedFile\(target, stream\.ToArray\(\)\)/);
assert.match(tether, /selectedConfigs: \{\}/);
assert.match(tether, /await this\._restoreSelectedConfigs\(\)/);
assert.match(tether, /this\.selectedConfigs\[path\] = res\.config\?\.current \|\| value/);
assert.match(tether, /\/shutter\(\?:speed\)\?\$\/i/);
assert.match(ui, /tetherConfigs: \{ \.\.\.K\.tether\.selectedConfigs \}/);
assert.match(ui, /K\.tether\.selectedConfigs = \{ \.\.\.\(s\.tetherConfigs \|\| \{\}\) \}/);

console.log('MOTK Shoot SIGMA settings self-test: PASS');
