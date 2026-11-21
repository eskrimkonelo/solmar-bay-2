// Solmar Bay — a small static file server for local playtesting.
//
//   node serve.ts            serves game/ on http://localhost:8080
//   node serve.ts --port 9000   serves it on another port instead
//
// It only serves files inside game/, sends the MIME types a browser game
// needs, and refuses anything that climbs out of that folder. This is a
// development convenience, not a web server for the internet.

import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(fileURLToPath(import.meta.url));
const gameRoot = resolve(join(repoRoot, 'game'));

const cliArgs = process.argv.slice(2);
const portFlag = cliArgs.indexOf('--port');
const wantedPort = portFlag === -1 ? 8080 : Number(cliArgs[portFlag + 1]);
const port = Number.isInteger(wantedPort) && wantedPort > 0 && wantedPort < 65536
  ? wantedPort
  : 8080;

// The content types a browser game asks for; anything else is sent as a
// plain byte stream.
const mimeByExtension: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8',
};

function serveFile(filePath: string, response: import('node:http').ServerResponse): void {
  let size: number;
  try {
    const stats = statSync(filePath);
    if (!stats.isFile()) throw new Error('not a file');
    size = stats.size;
  } catch {
    response.writeHead(404).end('not found');
    return;
  }
  const type = mimeByExtension[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  response.writeHead(200, {
    'content-type': type,
    'content-length': size,
    'cache-control': 'no-store',
  });
  createReadStream(filePath).pipe(response);
}

const server = createServer((request, response) => {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
  } catch {
    response.writeHead(400).end('bad request');
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';

  // Resolve inside game/ and refuse anything that escapes it.
  const filePath = resolve(join(gameRoot, normalize(pathname)));
  if (filePath !== gameRoot && !filePath.startsWith(gameRoot + sep)) {
    response.writeHead(403).end('forbidden');
    return;
  }
  serveFile(filePath, response);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Solmar Bay game/ is on http://localhost:${port}`);
});
