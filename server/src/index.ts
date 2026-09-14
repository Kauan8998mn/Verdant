import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppDatabase } from './database.ts';
import { FileService } from './files.ts';
import { loadConfig } from './config.ts';
import { Logger } from './logger.ts';
import { handleApi } from './routes.ts';
import { serveStatic } from './static-files.ts';
import { SessionManager } from './sessions.ts';
import { WebSocketHub } from './websocket.ts';
import { detectNetworkAddresses } from './network.ts';
import { DisabledMediaBackend, type MediaBackend } from './media-contract.ts';
import { SlidingWindowRateLimiter } from './security.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(here, '..', '..');
const config = loadConfig(rootDir);
fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.logDir, { recursive: true });
fs.mkdirSync(config.uploadsDir, { recursive: true });

const logger = new Logger(config.logDir);
const db = new AppDatabase(config.dataDir);
const sessions = new SessionManager(db);
const files = new FileService(db, config.uploadsDir);
const apiLimiter = new SlidingWindowRateLimiter(240, 60_000);
const authLimiter = new SlidingWindowRateLimiter(16, 60_000);

let media: MediaBackend = new DisabledMediaBackend();
if (!config.mediaDisabled) {
  const detected = detectNetworkAddresses().map(item => item.address);
  const addresses = config.mediaListenIps ?? [...new Set(['127.0.0.1', ...detected])];
  try {
    const { MediaService } = await import('./media.ts');
    media = await MediaService.create({ db, logger, listenAddresses: addresses, mediaPort: config.mediaPort, announcedAddress: config.mediaAnnouncedAddress, exposeInternalIp: config.exposeInternalMediaIp });
  } catch (error) {
    logger.error('Não foi possível iniciar o SFU mediasoup', { error: error instanceof Error ? error.message : String(error) });
    console.error('\nFalha ao iniciar a mídia (voz/tela/SFU).');
    console.error('Confirme que as dependências foram instaladas com: npm install');
    console.error('Para iniciar temporariamente apenas chat/arquivos: MEDIA_DISABLED=1 ./run-host-linux.sh\n');
    throw error;
  }
}

const hub = new WebSocketHub(db, sessions, logger, media);
media.setSignalSink({
  sendToSession: (token, payload) => hub.sendToSession(token, payload),
  broadcastToServer: (serverId, payload, excludeToken) => hub.broadcastToServer(serverId, payload, excludeToken)
});

const tlsEnabled = Boolean(config.tlsCert && config.tlsKey);
if (Boolean(config.tlsCert) !== Boolean(config.tlsKey)) {
  throw new Error('TLS_CERT e TLS_KEY precisam ser definidos juntos.');
}

const requestHandler: http.RequestListener = async (req, res) => {
  const started = performance.now();
  applySecurityHeaders(res);
  const requestPath = (req.url ?? '/').split('?')[0] ?? '/';
  const remoteKey = req.socket.remoteAddress ?? 'unknown';
  const isAuthMutation = req.method === 'POST' && (requestPath === '/api/servers' || /\/api\/servers\/[^/]+\/join$/.test(requestPath));
  const rate = (isAuthMutation ? authLimiter : apiLimiter).consume(`${remoteKey}:${isAuthMutation ? 'auth' : 'api'}`);
  if (!rate.allowed) {
    res.writeHead(429, { 'content-type': 'application/json; charset=utf-8', 'retry-after': String(rate.retryAfterSeconds) });
    res.end(JSON.stringify({ error: 'Muitas tentativas. Aguarde um pouco e tente novamente.' }));
    return;
  }
  if (!hostAllowed(req.headers.host, config.allowedHosts)) {
    res.writeHead(421, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Host não permitido.' }));
    return;
  }
  try {
    const handled = await handleApi(req, res, {
      db,
      sessions,
      hub,
      logger,
      files,
      media,
      secureTransport: tlsEnabled || Boolean(config.publicOrigin?.startsWith('https://')),
      port: config.port
    });
    if (!handled) {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (!serveStatic(config.clientDir, url.pathname, res)) {
        res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Frontend não compilado. Execute: npm run build\n');
      }
    }
  } catch (error) {
    logger.error('Erro não tratado em requisição HTTP', { error: error instanceof Error ? error.message : String(error) });
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    if (!res.writableEnded) res.end(JSON.stringify({ error: 'Erro interno do servidor.' }));
  } finally {
    logger.info('HTTP', { method: req.method, path: req.url?.split('?')[0], ms: Math.round(performance.now() - started) });
  }
};

const server = tlsEnabled
  ? https.createServer({
      cert: fs.readFileSync(config.tlsCert!),
      key: fs.readFileSync(config.tlsKey!),
      minVersion: 'TLSv1.2'
    }, requestHandler)
  : http.createServer(requestHandler);

server.on('upgrade', (req, socket, head) => {
  if (!hostAllowed(req.headers.host, config.allowedHosts) || !originAllowed(req.headers.origin, config.publicOrigin)) {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return;
  }
  hub.handleUpgrade(req, socket, head);
});
server.on('clientError', (error, socket) => {
  logger.warn('Erro de cliente HTTP', { error: error.message });
  if (!socket.destroyed) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

const cleanupTimer = setInterval(() => sessions.cleanupExpired(), 10_000);
cleanupTimer.unref();

server.listen(config.port, config.host, () => {
  const scheme = tlsEnabled ? 'https' : 'http';
  logger.info('Verdant LAN iniciado', { host: config.host, port: config.port, tls: tlsEnabled, media: media.enabled, mediaPort: media.mediaPort });
  console.log(`\nVerdant LAN — ${scheme}://127.0.0.1:${config.port}`);
  const addresses = detectNetworkAddresses();
  for (const item of addresses) console.log(`${item.kind.padEnd(7)} ${scheme}://${item.address}:${config.port}`);
  if (media.enabled) {
    console.log(`\nVoz/SFU: ativo em UDP/TCP ${media.mediaPort} (${media.listenAddresses.join(', ')})`);
    if (config.mediaAnnouncedAddress) console.log(`Mídia anunciada externamente como: ${config.mediaAnnouncedAddress}:${media.mediaPort}`);
  }
  if (config.publicOrigin) console.log(`Modo online/proxy: ${config.publicOrigin}`);
  if (config.mediaDisabled) console.log('\nVoz/SFU: desativado por MEDIA_DISABLED=1');
  if (!tlsEnabled) {
    console.log('\nAviso: voz funciona em localhost, mas outros computadores precisam acessar por HTTPS confiável.');
    console.log('Execute "npm run tls:generate" e siga README.md para confiar a CA nos clientes.');
  }
  console.log('');
});


function applySecurityHeaders(res: http.ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), display-capture=(self), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob:; connect-src 'self' https: wss:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
}

function hostAllowed(hostHeader: string | undefined, allowed: string[] | undefined): boolean {
  if (!allowed?.length) return true;
  const host=(hostHeader??'').trim().toLowerCase();
  if (!host) return false;
  const hostname=host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.split(':')[0];
  return allowed.includes(host) || allowed.includes(hostname);
}

function originAllowed(origin: string | undefined, publicOrigin: string | undefined): boolean {
  if (!publicOrigin) return true;
  if (!origin) return false;
  try { return new URL(origin).origin === publicOrigin; } catch { return false; }
}

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Encerrando servidor', { signal });
  server.close(() => {
    void (async () => {
      await media.close();
      db.close();
      process.exit(0);
    })();
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
