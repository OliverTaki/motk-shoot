/* Optional Phase 1.6 server: static MOTK Shoot files with the isolation
 * headers required by the archived Web-gPhoto2 WebAssembly build. Node 18+,
 * standard library only. Do not use this server as a public deployment. */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const at = args.indexOf('--' + name);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const port = Math.max(1, Math.min(65535, parseInt(arg('port', '8146'), 10) || 8146));
const host = arg('host', '127.0.0.1');
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm',
  '.md': 'text/markdown; charset=utf-8',
};

createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, `http://${host}:${port}`).pathname); }
  catch { res.writeHead(400); res.end('Bad request'); return; }
  if (pathname === '/') pathname = '/experiments/webusb/';
  const relative = normalize(pathname.replace(/^[/\\]+/, ''));
  let file = resolve(join(root, relative));
  if (file !== root && !file.startsWith(root + '\\') && !file.startsWith(root + '/')) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, {
    'Content-Type': types[extname(file).toLowerCase()] || 'application/octet-stream',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  createReadStream(file).pipe(res);
}).listen(port, host, () => {
  console.log(`MOTK Shoot WebUSB experiment: http://${host}:${port}/experiments/webusb/`);
  console.log('Local experiment server only. Press Ctrl+C to stop.');
});
