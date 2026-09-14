import fs from 'node:fs';
import path from 'node:path';
import type { ServerResponse } from 'node:http';

const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg'
};

export function serveStatic(clientDir: string, pathname: string, res: ServerResponse): boolean {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const safe = path.normalize(requested).replace(/^(\.\.[/\\])+/, '');
  let file = path.resolve(clientDir, `.${safe.startsWith('/') ? safe : `/${safe}`}`);
  const root = path.resolve(clientDir);
  if (!file.startsWith(`${root}${path.sep}`) && file !== root) return false;

  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    file = path.join(root, 'index.html');
    if (!fs.existsSync(file)) return false;
  }

  const ext = path.extname(file).toLowerCase();
  const stat = fs.statSync(file);
  res.writeHead(200, {
    'content-type': mime[ext] ?? 'application/octet-stream',
    'content-length': stat.size,
    'cache-control': 'no-store, no-cache, must-revalidate',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    'permissions-policy': 'camera=(self), microphone=(self), display-capture=(self), speaker-selection=(self)'
  });
  fs.createReadStream(file).pipe(res);
  return true;
}
