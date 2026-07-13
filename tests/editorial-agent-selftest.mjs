/* Run while the dummy production agent is listening: node tests/editorial-agent-selftest.mjs */
'use strict';
const url = process.argv[2] || 'ws://localhost:8793';
const socket = new WebSocket(url);
const pending = new Map();
let sequence = 0;
const request = (type, payload) => new Promise((resolve, reject) => {
  const id = `editorial_test_${++sequence}`;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${type} timed out`)); }, 5000);
  pending.set(id, (message) => { clearTimeout(timer); resolve(message); });
  socket.send(JSON.stringify({ type, id, ...payload }));
});
socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data));
  if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
});
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
const context = { productionId: 'prod_test', production: 'Phase6 Test', shotId: 'SC010_C020', take: 1, projectId: 'project_test' };
const files = {
  'editorial.edl': 'TITLE: PHASE6 TEST\r\n',
  'editorial.fcpxml': '<?xml version="1.0"?><fcpxml version="1.10"/>\n',
  'editorial_aaf_lite.json': '{"schema":"motk-aaf-lite/1"}\n',
  'editorial.json': '{"schema":"motk-editorial/1"}\n',
  'conform_active_edit.ffconcat': 'ffconcat version 1.0\n',
  'conform_recipe.txt': 'ffmpeg -version\n',
};
const accepted = await request('folder.editorial', { context, files });
if (!accepted.ok || accepted.files?.length !== 6) throw new Error(`valid package rejected: ${accepted.error || 'bad response'}`);
const rejected = await request('folder.editorial', { context, files: { '../escape.txt': 'blocked' } });
if (rejected.ok || !String(rejected.error).includes('unknown editorial file name')) throw new Error('unknown/traversal file name was not rejected');
const incomplete = await request('folder.editorial', { context, files: { 'editorial.edl': 'incomplete' } });
if (incomplete.ok || !String(incomplete.error).includes('all six files')) throw new Error('incomplete package was not rejected');
socket.close();
console.log('PASS');
console.log('Six fixed editorial files were written atomically; unknown/traversal names and incomplete packages were rejected.');
