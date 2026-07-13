/* Start a dummy agent, then run: node tests/origin-agent-selftest.mjs [port] */
'use strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';

const port = Number(process.argv[2] || 8793);
const upgrade = (origin) => new Promise((resolve, reject) => {
  const request = http.request({
    host: '127.0.0.1', port,
    headers: {
      Connection: 'Upgrade', Upgrade: 'websocket', Origin: origin,
      'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
      'Sec-WebSocket-Version': '13',
    },
  });
  request.once('response', (response) => resolve({ status: response.statusCode }));
  request.once('upgrade', (response, socket) => { socket.destroy(); resolve({ status: response.statusCode }); });
  request.once('error', reject);
  request.end();
});

const refused = await upgrade('https://unrelated.invalid');
if (refused.status !== 403) throw new Error(`unrelated origin returned ${refused.status}, expected 403`);
const local = await upgrade('http://127.0.0.1:8321');
if (local.status !== 101) throw new Error(`localhost origin returned ${local.status}, expected 101`);

console.log('PASS');
console.log('Unrelated browser origins were rejected and localhost was accepted.');
