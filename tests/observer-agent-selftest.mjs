/* Start the agent with --host 0.0.0.0 --serve-app, then pass its LAN IP. */
'use strict';
const port = Number(process.argv[2] || 8795);
const lanHost = process.argv[3];
if (!lanHost) throw new Error('Pass this computer\'s LAN IPv4 address as the second argument');

const page = await fetch(`http://127.0.0.1:${port}/?observer=1`);
if (!page.ok || !(await page.text()).includes('js/ecosystem.js')) throw new Error('observer app was not served');
const blocked = await fetch(`http://127.0.0.1:${port}/tmp/phase6-productions/editorial.json`);
if (blocked.status !== 404) throw new Error('non-public workspace file was served');

const connect = (url) => new Promise((resolve, reject) => {
  const socket = new WebSocket(url), waiters = [], messages = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    const index = waiters.findIndex((entry) => entry.test(message));
    if (index >= 0) { const [entry] = waiters.splice(index, 1); clearTimeout(entry.timer); entry.resolve(message); }
    else messages.push(message);
  });
  socket.addEventListener('open', () => {
    socket.waitFor = (test) => {
      const index = messages.findIndex(test);
      if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]);
      return new Promise((done, fail) => {
        const entry = { test, resolve: done, timer: null };
        entry.timer = setTimeout(() => { const at = waiters.indexOf(entry); if (at >= 0) waiters.splice(at, 1); fail(new Error('WebSocket response timed out')); }, 5000);
        waiters.push(entry);
      });
    };
    resolve(socket);
  }, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

const observer = await connect(`ws://${lanHost}:${port}`);
observer.send(JSON.stringify({ type: 'observer.subscribe' }));
const controller = await connect(`ws://127.0.0.1:${port}`);
controller.send(JSON.stringify({ type: 'tether.shoot', id: 'observer_preview_source' }));
const shot = await controller.waitFor((message) => message.id === 'observer_preview_source');
if (!shot.ok || !shot.jpeg) throw new Error('dummy agent did not return a valid preview JPEG');
controller.send(JSON.stringify({ type: 'observer.publish', jpeg: shot.jpeg, state: { project: { name: 'Observer Test' }, frames: 12, edit: 'MAIN' } }));
const update = await observer.waitFor((message) => message.type === 'observer.update' && message.state?.project?.name === 'Observer Test');
if (update.state?.project?.name !== 'Observer Test' || update.state?.frames !== 12) throw new Error('observer update mismatch');
observer.send(JSON.stringify({ type: 'tether.shoot', id: 'must_be_read_only' }));
const refusal = await observer.waitFor((message) => message.id === 'must_be_read_only');
if (refusal.ok || !String(refusal.error).includes('read-only')) throw new Error('LAN mutation was not refused');
observer.close();controller.close();
console.log('PASS');
console.log('The agent served only public app assets, relayed observer state, and rejected a LAN shooting command.');
