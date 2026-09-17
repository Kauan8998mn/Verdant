import { isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';

export function isLoopback(address?: string): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}
export function proxyPrincipal(req: IncomingMessage): string | undefined {
  if (!isLoopback(req.socket.remoteAddress)) return undefined;
  const user = req.headers['x-verdant-user'];
  return typeof user === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(user) ? user : undefined;
}
export function clientRateKey(req: IncomingMessage, production: boolean): string {
  if (production && isLoopback(req.socket.remoteAddress)) {
    const ip = req.headers['x-verdant-client-ip'];
    if (typeof ip === 'string' && isIP(ip)) return ip;
  }
  return req.socket.remoteAddress ?? 'unknown';
}
