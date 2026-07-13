/* Sample MOTK Shoot bridge relay — Node 18+, zero dependencies.
 *
 *   node bridge/server.mjs [port]
 *
 * Accepts WebSocket connections (MOTK Shoot + any number of external
 * controllers) and relays every message to all other clients. This is the
 * simplest way to wire lighting/moco/scripts to MOTK Shoot: your controller
 * connects here, sends {"cmd":"capture"}, and receives all MOTK Shoot events.
 * Replace the relay logic with real DMX/GPIO control as needed.
 */
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

const PORT = parseInt(process.argv[2] || '8790', 10);
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const clients = new Set();

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('MOTK Shoot bridge relay. Connect via WebSocket.\n');
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  clients.add(socket);
  console.log(`[bridge] client connected (${clients.size} total)`);
  let buf = Buffer.alloc(0);

  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (true) {
      const frame = decodeFrame(buf);
      if (!frame) break;
      buf = buf.subarray(frame.consumed);
      if (frame.opcode === 8) { socket.end(); return; }         // close
      if (frame.opcode === 9) { socket.write(encodeFrame(frame.payload, 10)); continue; } // ping→pong
      if (frame.opcode !== 1) continue;                          // text only
      const text = frame.payload.toString('utf8');
      console.log('[bridge] →', text.slice(0, 120));
      for (const c of clients) if (c !== socket && !c.destroyed) {
        c.write(encodeFrame(Buffer.from(text), 1));
      }
    }
  });
  const drop = () => { clients.delete(socket); console.log(`[bridge] client left (${clients.size} total)`); };
  socket.on('close', drop);
  socket.on('error', drop);
});

function decodeFrame(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let off = 2;
  if (len === 126) { if (buf.length < 4) return null; len = buf.readUInt16BE(2); off = 4; }
  else if (len === 127) { if (buf.length < 10) return null; len = Number(buf.readBigUInt64BE(2)); off = 10; }
  const maskLen = masked ? 4 : 0;
  if (buf.length < off + maskLen + len) return null;
  let payload = buf.subarray(off + maskLen, off + maskLen + len);
  if (masked) {
    const mask = buf.subarray(off, off + 4);
    payload = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
  }
  return { opcode, payload, consumed: off + maskLen + len };
}

function encodeFrame(payload, opcode = 1) {
  const len = payload.length;
  let header;
  if (len < 126) header = Buffer.from([0x80 | opcode, len]);
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([header, payload]);
}

server.listen(PORT, () => console.log(`[bridge] listening on ws://localhost:${PORT}`));
