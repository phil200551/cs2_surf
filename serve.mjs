#!/usr/bin/env node
/**
 * Zero-dependency static server for the production build in dist/.
 *
 *   node serve.mjs [port] [--open]
 *
 * Listens on localhost only (default port 8080, the next free one if taken),
 * serves the right MIME types (module scripts require them), and with --open
 * launches the default browser once it is listening. Needs only Node.js: no
 * npm install.
 */
import { exec } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('./dist/', import.meta.url)));
const args = process.argv.slice(2);
const openBrowser = args.includes('--open');
let port = Number(process.env.PORT || args.find((a) => /^\d+$/.test(a)) || 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

if (!existsSync(resolve(root, 'index.html'))) {
  console.error('\n  dist/index.html not found. Build the game first:  npm install  then  npm run build\n');
  process.exit(1);
}

async function handle(req, res) {
  try {
    let path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = resolve(root, `.${path}`);
    // Never serve anything outside dist/.
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}

function launch(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

/** Resolves with the listen error, or null once listening. */
function listen(server, portNumber, host) {
  return new Promise((done) => {
    const onError = (err) => {
      server.off('listening', onListening);
      done(err);
    };
    const onListening = () => {
      server.off('error', onError);
      done(null);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(portNumber, host);
  });
}

// Take the first port free on both IPv4 and IPv6 loopback, so "localhost"
// reaches this server whichever address the browser tries. A machine without
// IPv6 just uses IPv4.
let started = false;
for (let attempt = 0; attempt < 20 && !started; attempt++, port++) {
  const v4 = createServer(handle);
  const err4 = await listen(v4, port, '127.0.0.1');
  if (err4) {
    if (err4.code === 'EADDRINUSE') continue;
    console.error(`\n  Could not start the server: ${err4.message}\n`);
    process.exit(1);
  }
  const v6 = createServer(handle);
  const err6 = await listen(v6, port, '::1');
  if (err6 && err6.code === 'EADDRINUSE') {
    v4.close();
    continue;
  }
  started = true;
  const url = `http://localhost:${port}/`;
  console.log(`\n  Skyline Surf is running at  ${url}\n  Keep this window open while you play. Press Ctrl+C to stop.\n`);
  if (openBrowser) launch(url);
}
if (!started) {
  console.error('\n  No free port found. Pass one explicitly, for example:  node serve.mjs 9000\n');
  process.exit(1);
}
