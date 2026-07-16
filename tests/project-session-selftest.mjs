import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const project = await readFile(new URL('../js/project.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const ui = await readFile(new URL('../js/ui.js', import.meta.url), 'utf8');

assert.match(project, /sessionStorage\.getItem\(this\.SESSION_KEY\)/);
assert.match(project, /sessionStorage\.setItem\(this\.SESSION_KEY, id\)/);
assert.match(project, /START_MODE_KEY: 'motkShootProjectStartMode'/);
assert.match(project, /LAST_PROJECT_KEY: 'motkShootLastProjectId'/);
assert.match(project, /this\.startMode\(\) === 'resume-last'/);
assert.match(project, /await this\.create\(this\._freshSessionName\(\), \{ freshSession: true \}\)/);
assert.doesNotMatch(project, /getMeta\('lastProjectId'\)/);
assert.doesNotMatch(project, /setMeta\('lastProjectId'/);
assert.doesNotMatch(project, /sort\(\(a, b\) => b\.updatedAt - a\.updatedAt\)\[0\]/);
assert.match(html, /Each browser session starts clean\./);
assert.match(html, /Older shoots stay closed until you explicitly open one/);
assert.match(html, /Start a new shoot after the browser closes/);
assert.match(html, /Camera Stop\/Restart and a normal reload never create another project/);
assert.match(ui, /Open project/);
assert.match(ui, /K\.project\.setStartMode/);

console.log('MOTK Shoot project session self-test: PASS');
