import path from 'node:path';

export interface AppConfig {
  host: string; port: number; mediaPort: number; mediaDisabled: boolean; mediaListenIps?: string[]; mediaAnnouncedAddress?: string; exposeInternalMediaIp: boolean;
  dataDir: string; logDir: string; clientDir: string; uploadsDir: string; tlsCert?: string; tlsKey?: string; publicOrigin?: string; allowedHosts?: string[];
}

export function loadConfig(rootDir: string): AppConfig {
  const port=parsePort(process.env.PORT??'43110','PORT'); const mediaPort=parsePort(process.env.MEDIA_PORT??'43111','MEDIA_PORT'); if(port===mediaPort)throw new Error('PORT e MEDIA_PORT precisam ser diferentes.');
  const mediaListenIps=list(process.env.MEDIA_LISTEN_IPS); const allowedHosts=list(process.env.ALLOWED_HOSTS)?.map(v=>v.toLowerCase());
  const mediaAnnouncedAddress=cleanHost(process.env.MEDIA_ANNOUNCED_ADDRESS);
  const publicOrigin=normalizeOrigin(process.env.PUBLIC_ORIGIN);
  return { host:process.env.HOST??'0.0.0.0', port, mediaPort, mediaDisabled:/^(1|true|yes)$/i.test(process.env.MEDIA_DISABLED??''), mediaListenIps, mediaAnnouncedAddress, exposeInternalMediaIp:/^(1|true|yes)$/i.test(process.env.MEDIA_EXPOSE_INTERNAL_IP??''),
    dataDir:path.resolve(process.env.DATA_DIR??path.join(rootDir,'data')), logDir:path.resolve(process.env.LOG_DIR??path.join(rootDir,'logs')), clientDir:path.resolve(path.join(rootDir,'client','dist')), uploadsDir:path.resolve(process.env.UPLOAD_DIR??path.join(rootDir,'uploads')),
    tlsCert:process.env.TLS_CERT?path.resolve(process.env.TLS_CERT):undefined, tlsKey:process.env.TLS_KEY?path.resolve(process.env.TLS_KEY):undefined, publicOrigin, allowedHosts };
}
function list(raw:string|undefined):string[]|undefined { const v=raw?.split(',').map(x=>x.trim()).filter(Boolean); return v?.length?[...new Set(v)]:undefined; }
function cleanHost(raw:string|undefined):string|undefined { const v=raw?.trim(); if(!v)return; if(/[\/\s]/.test(v))throw new Error('MEDIA_ANNOUNCED_ADDRESS deve ser apenas IP ou hostname.'); return v; }
function normalizeOrigin(raw:string|undefined):string|undefined { const v=raw?.trim(); if(!v)return; const u=new URL(v); if(u.protocol!=='https:'&&u.protocol!=='http:')throw new Error('PUBLIC_ORIGIN precisa usar http ou https.'); return u.origin; }
function parsePort(raw:string,name:string):number { const value=Number.parseInt(raw,10); if(!Number.isInteger(value)||value<1||value>65535)throw new Error(`${name} inválida: ${raw}`); return value; }
