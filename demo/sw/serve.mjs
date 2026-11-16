// Demo server for demo/sw/. Run: node demo/sw/serve.mjs [port]  (default 4173)
// node:http only. It is also the reference for the headers the worker needs.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, '..', '..', 'frontend');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

let version = 'v1';

// A file below root, or null when the path escapes it or is not a file.
function resolveFile(root, relative) {
  let decoded;
  try {
    decoded = decodeURIComponent(relative);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const file = path.resolve(root, '.' + path.posix.normalize('/' + decoded));
  if (file !== root && !file.startsWith(root + path.sep)) return null;
  try {
    return fs.statSync(file).isFile() ? file : null;
  } catch {
    return null;
  }
}

function send(res, status, type, body, headers = {}) {
  res.writeHead(status, { 'content-type': type, ...headers });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');

  if (req.method === 'POST' && pathname.startsWith('/__version/')) {
    const next = pathname.slice('/__version/'.length);
    if (!/^[A-Za-z0-9._-]+$/.test(next)) return send(res, 400, 'text/plain', 'bad version');
    version = next;
    return send(res, 200, 'text/plain', version);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'text/plain', 'method not allowed');

  if (pathname === '/api/time') {
    return send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ now: new Date().toISOString() }), {
      'cache-control': 'no-store',
    });
  }
  if (pathname === '/vendor/blob.bin') {
    return send(res, 200, 'application/octet-stream', Buffer.alloc(200 * 1024, 7));
  }

  const fromKit = pathname.startsWith('/app-kit/');
  const file = fromKit
    ? resolveFile(FRONTEND, pathname.slice('/app-kit/'.length))
    : resolveFile(HERE, pathname === '/' ? 'index.html' : pathname.slice(1));
  if (!file) return send(res, 404, 'text/plain', 'not found');

  const type = TYPES[path.extname(file)] ?? 'application/octet-stream';
  const name = path.basename(file);
  if (!fromKit && name === 'sw.js') {
    const body = fs.readFileSync(file, 'utf8').split('__VERSION__').join(version);
    return send(res, 200, type, body, { 'cache-control': 'no-cache' });
  }
  if (!fromKit && name === 'manifest.webmanifest') {
    return send(res, 200, type, fs.readFileSync(file), { 'cache-control': 'no-cache' });
  }
  send(res, 200, type, fs.readFileSync(file));
});

const port = Number(process.argv[2] ?? 4173);
server.listen(port, () => {
  process.stdout.write(`app-kit sw demo on http://localhost:${port}/\n`);
});
