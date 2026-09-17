import path from 'node:path';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

export interface AppConfig {
  production: boolean; host: string; port: number; mediaPort: number; mediaDisabled: boolean;
  mediaListenIps?: string[]; mediaAnnouncedAddress?: string; exposeInternalMediaIp: boolean;
  dataDir: string; databasePath: string; logDir: string; clientDir: string; uploadsDir: string;
  tlsCert?: string; tlsKey?: string; publicOrigin?: string; allowedHosts?: string[];
  uploadMaxBytes: number; debugWebrtc: boolean; journalOnly: boolean;
}

export function loadConfig(rootDir: string, env: NodeJS.ProcessEnv = process.env): AppConfig {
  const production = env.NODE_ENV === 'production';
  const port = integer(env.VERDANT_PORT ?? env.PORT ?? '43110', 'VERDANT_PORT', 1, 65535);
  const mediaPort = integer(env.MEDIASOUP_PORT ?? env.MEDIA_PORT ?? '43111', 'MEDIASOUP_PORT', 1, 65535);
  if (port === mediaPort) throw new Error('PORT e MEDIA_PORT precisam ser diferentes.');
  const host = env.VERDANT_HOST ?? env.HOST ?? (production ? '127.0.0.1' : '0.0.0.0');
  const mediaListenIps = list(env.MEDIASOUP_LISTEN_IP ?? env.MEDIA_LISTEN_IPS) ?? (production ? ['0.0.0.0'] : undefined);
  if (mediaListenIps?.some(ip => !isIP(ip))) throw new Error('MEDIASOUP_LISTEN_IP deve conter IPs de interfaces locais.');
  const mediaAnnouncedAddress = hostname(env.MEDIASOUP_ANNOUNCED_ADDRESS ?? env.MEDIA_ANNOUNCED_ADDRESS);
  const publicOrigin = origin(env.PUBLIC_ORIGIN);
  const exposeInternalMediaIp = bool(env.MEDIA_EXPOSE_INTERNAL_IP);
  const mediaDisabled = bool(env.MEDIA_DISABLED);
  if (production) {
    if (host !== '127.0.0.1') throw new Error('Produção exige VERDANT_HOST=127.0.0.1 atrás do Caddy.');
    if (!publicOrigin?.startsWith('https://')) throw new Error('Produção exige PUBLIC_ORIGIN=https://dominio.');
    if (!mediaDisabled && !mediaAnnouncedAddress) throw new Error('Produção exige MEDIASOUP_ANNOUNCED_ADDRESS público.');
    if (exposeInternalMediaIp) throw new Error('Produção não pode expor candidatos internos.');
    if (env.TLS_CERT || env.TLS_KEY) throw new Error('Produção usa TLS no Caddy, não TLS_CERT/TLS_KEY no Node.');
    if (mediaAnnouncedAddress && isIP(mediaAnnouncedAddress) && !isPublicIPv4(mediaAnnouncedAddress)) {
      throw new Error('Endereço anunciado deve ser IPv4 público, não LAN/loopback/VPN.');
    }
  }
  const dataDir = path.resolve(env.DATA_DIR ?? path.join(rootDir, 'data'));
  return {
    production, host, port, mediaPort, mediaDisabled, mediaListenIps, mediaAnnouncedAddress, exposeInternalMediaIp,
    dataDir, databasePath: path.resolve(env.DATABASE_PATH ?? path.join(dataDir, 'verdant.sqlite')),
    logDir: path.resolve(env.LOG_DIR ?? path.join(rootDir, 'logs')),
    clientDir: path.join(rootDir, 'client', 'dist'),
    uploadsDir: path.resolve(env.UPLOAD_PATH ?? env.UPLOAD_DIR ?? path.join(rootDir, 'uploads')),
    tlsCert: env.TLS_CERT, tlsKey: env.TLS_KEY, publicOrigin,
    allowedHosts: list(env.ALLOWED_HOSTS)?.map(v => v.toLowerCase()) ?? (publicOrigin ? [new URL(publicOrigin).hostname] : undefined),
    uploadMaxBytes: integer(env.UPLOAD_MAX_MB ?? '50', 'UPLOAD_MAX_MB', 1, 500) * 1024 * 1024,
    debugWebrtc: bool(env.VERDANT_DEBUG_WEBRTC), journalOnly: production || bool(env.VERDANT_JOURNAL_ONLY)
  };
}

export function integer(raw: string, name: string, min: number, max: number): number {
  if (!/^\d+$/.test(raw)) throw new Error(`${name} inválido.`);
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${name} fora do intervalo ${min}–${max}.`);
  return n;
}
export function bool(raw?: string): boolean {
  if (!raw || /^(0|false|no)$/i.test(raw)) return false;
  if (/^(1|true|yes)$/i.test(raw)) return true;
  throw new Error('Valor booleano inválido; use true ou false.');
}
function list(raw?: string): string[] | undefined {
  const values = raw?.split(',').map(x => x.trim()).filter(Boolean);
  return values?.length ? [...new Set(values)] : undefined;
}
export function hostname(raw?: string): string | undefined {
  if (!raw?.trim()) return undefined;
  const value = raw.trim().toLowerCase();
  if (!isIP(value) && !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value)) throw new Error('Hostname/IP inválido.');
  if (!isIP(value) && value.split('.').some(label => !label || label.length > 63 || label.startsWith('-') || label.endsWith('-'))) throw new Error('Hostname inválido.');
  return value;
}
function origin(raw?: string): string | undefined {
  if (!raw) return undefined;
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('PUBLIC_ORIGIN deve ser uma origem HTTP(S) sem caminho/credenciais.');
  return url.origin;
}
export function isPublicIPv4(ip: string): boolean {
  if (isIP(ip) !== 4) return false;
  const [a, b, c] = ip.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 25 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || (b === 0 && [0, 2].includes(c)) || (b === 88 && c === 99))) ||
    (a === 198 && ([18, 19].includes(b) || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
}
export async function resolveAnnouncedAddress(config: AppConfig): Promise<string | undefined> {
  const value = config.mediaAnnouncedAddress;
  if (!config.production || !value) return value;
  const records = isIP(value) ? [{ address: value }] : await lookup(value, { family: 4, all: true });
  if (!records.length || records.some(r => !isPublicIPv4(r.address))) throw new Error('DNS da mídia deve resolver apenas IPv4 público.');
  if (records.length !== 1) throw new Error('Use um único registro A/IP estável para esta VM.');
  return records[0].address;
}
