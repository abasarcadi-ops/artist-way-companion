// Tiny static file server for public/, used by `npm run dev` and the e2e run.
//
//   node test/server.mjs          serves http://localhost:8910
//   PORT=9000 node test/server.mjs
//
// Every response says Cache-Control: no-store, so a reload always shows the
// files on disk. Query strings are ignored for file lookup: /?today=2026-10-22
// serves index.html, and the app reads ?today= itself (localhost only).
// It listens on 127.0.0.1; set HOST=0.0.0.0 to reach it from a phone on the
// same network.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../public/', import.meta.url));
const DEFAULT_PORT = 8910;
const DEFAULT_HOST = '127.0.0.1';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Starts serving public/. Resolves with the listening http.Server once it is
 * ready (pass port 0 for a free port, then read server.address().port).
 */
export function startServer(port = envPort(), host = process.env.HOST || DEFAULT_HOST) {
  const server = createServer((req, res) => {
    serve(req, res).catch(() => send(res, 500, 'Server error'));
  });
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolvePromise(server);
    });
  });
}

async function serve(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
    return;
  }
  const file = fileFor(req.url);
  if (!file || !(await isFile(file))) {
    send(res, 404, 'Not found');
    return;
  }
  const body = await readFile(file);
  res.writeHead(200, {
    'Content-Type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

// Maps a request URL to a file inside public/, or null. "/" is index.html.
// Anything that would land outside public/ is refused.
function fileFor(url) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(url, 'http://localhost').pathname);
  } catch {
    return null; // malformed percent-encoding
  }
  if (pathname.includes('\0')) return null;
  if (pathname === '/') pathname = '/index.html';
  const file = resolve(ROOT, `.${pathname}`);
  return file.startsWith(ROOT) ? file : null;
}

async function isFile(file) {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

function send(res, status, text, headers = {}) {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(text);
}

function envPort() {
  return process.env.PORT ? Number(process.env.PORT) : DEFAULT_PORT;
}

// Listen when run directly (`node test/server.mjs`), not when imported.
// NODE_TEST_CONTEXT is set when `node --test` runs this file as if it were a
// test; listening there would keep the test run open forever.
const runDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (runDirectly && !process.env.NODE_TEST_CONTEXT) {
  const server = await startServer();
  const { port } = server.address();
  console.log(`Serving public/ at http://localhost:${port}`);
}
