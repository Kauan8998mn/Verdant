import { createHmac, randomBytes } from 'node:crypto';
import { bool, hostname, integer } from './config.ts';

export interface IceConfig {
  iceServers: Array<{ urls: string[]; username: string; credential: string }>;
  iceTransportPolicy: 'all' | 'relay';
  expiresAt?: number;
  debug: boolean;
}
export class TurnCredentials {
  #secret: string;
  #urls: string[];
  #ttl: number;
  #policy: 'all' | 'relay';
  #debug: boolean;
  constructor(env: NodeJS.ProcessEnv = process.env) {
    const enabled = bool(env.TURN_ENABLED);
    this.#debug = bool(env.VERDANT_DEBUG_WEBRTC);
    this.#policy = env.VERDANT_ICE_POLICY === 'relay' ? 'relay' : 'all';
    if (env.VERDANT_ICE_POLICY && !['all', 'relay'].includes(env.VERDANT_ICE_POLICY)) throw new Error('VERDANT_ICE_POLICY inválida.');
    const mode = env.VERDANT_TURN_TRANSPORT ?? 'all';
    if (!['all','udp','tcp','tls'].includes(mode)) throw new Error('VERDANT_TURN_TRANSPORT inválido.');
    if ((this.#policy === 'relay' || mode !== 'all') && (!this.#debug || !enabled)) throw new Error('Diagnóstico relay/TURN exige TURN_ENABLED e VERDANT_DEBUG_WEBRTC.');
    this.#secret = enabled ? (env.TURN_SECRET ?? '') : '';
    this.#ttl = integer(env.TURN_TTL_SECONDS ?? '3600', 'TURN_TTL_SECONDS', 120, 86400);
    this.#urls = [];
    if (!enabled) return;
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(this.#secret) || /CHANGE|REPLACE|example/i.test(this.#secret)) throw new Error('TURN_SECRET deve ter 32–256 caracteres aleatórios (hex/base64url).');
    const host = hostname(env.TURN_HOST);
    if (!host || host.includes(':')) throw new Error('TURN_HOST deve ser hostname/IPv4 configurado.');
    if (!hostname(env.TURN_REALM)) throw new Error('TURN_REALM obrigatório.');
    const port = integer(env.TURN_PORT ?? '3478', 'TURN_PORT', 1, 65535);
    const tlsPort = integer(env.TURN_TLS_PORT ?? '5349', 'TURN_TLS_PORT', 1, 65535);
    const tls = bool(env.TURN_TLS_ENABLED ?? 'true');
    if (mode === 'tls' && !tls) throw new Error('Diagnóstico TLS exige TURN_TLS_ENABLED.');
    if (mode === 'all' || mode === 'udp') this.#urls.push(`turn:${host}:${port}?transport=udp`);
    if (mode === 'all' || mode === 'tcp') this.#urls.push(`turn:${host}:${port}?transport=tcp`);
    if (tls && (mode === 'all' || mode === 'tls')) this.#urls.push(`turns:${host}:${tlsPort}?transport=tcp`);
  }
  issue(now = Date.now()): IceConfig {
    if (!this.#urls.length) return { iceServers: [], iceTransportPolicy: 'all', debug: this.#debug };
    const expiry = Math.floor(now / 1000) + this.#ttl;
    const username = `${expiry}:${randomBytes(12).toString('hex')}`;
    const credential = createHmac('sha1', this.#secret).update(username).digest('base64');
    return { iceServers: [{ urls: [...this.#urls], username, credential }], iceTransportPolicy: this.#policy, expiresAt: expiry * 1000, debug: this.#debug };
  }
}
