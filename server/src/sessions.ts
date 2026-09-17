import { randomBytes } from 'node:crypto';
import type { Role } from '../../shared/src/domain.ts';
import { MAX_PARTICIPANTS, validateDisplayName } from '../../shared/src/domain.ts';
import type { AppDatabase } from './database.ts';

export interface Session {
  token: string;
  principal?: string;
  serverId: string;
  displayName: string;
  normalizedName: string;
  role: Role;
  createdAt: number;
  lastSeenAt: number;
  connected: boolean;
  expiresAt?: number;
}

export class SessionManager {
  #sessions = new Map<string, Session>();
  #db: AppDatabase;
  #graceMs = 10 * 60_000;

  constructor(db: AppDatabase) {
    this.#db = db;
  }

  createOwnerSession(serverId: string, rawName: unknown, principal?: string): Session {
    const parsed = validateDisplayName(rawName);
    if (!parsed.ok) throw new SessionError(400, parsed.error);
    if (this.#activeNameTaken(serverId, parsed.normalized)) throw new SessionError(409, 'Esse nome já está em uso neste servidor.');

    if (principal) this.#db.bindIdentity(serverId, parsed.normalized, principal);
    this.#db.bindRole(serverId, parsed.normalized, parsed.value, 'owner');
    return this.#newSession(serverId, parsed.value, parsed.normalized, 'owner', principal);
  }

  join(serverId: string, rawName: unknown, resumeToken?: unknown, principal?: string): Session {
    const server = this.#db.getServer(serverId);
    if (!server) throw new SessionError(404, 'Servidor não encontrado.');

    const parsed = validateDisplayName(rawName);
    if (!parsed.ok) throw new SessionError(400, parsed.error);

    const bound = this.#db.getIdentity(serverId, parsed.normalized);
    if (bound && bound !== principal) throw new SessionError(403, 'Nome reservado para sua identidade autenticada.');
    if (principal) {
      const ownName = this.#db.identityName(serverId, principal);
      if (ownName && ownName !== parsed.normalized) throw new SessionError(409, 'Use seu nome já registrado neste servidor.');
      if ((bound && bound !== principal) || (!bound && this.#db.getRole(serverId, parsed.normalized))) {
        throw new SessionError(403, 'Nome reservado. O administrador precisa vincular identidades legadas antes da migração.');
      }
    }

    if (typeof resumeToken === 'string') {
      const existing = this.#sessions.get(resumeToken);
      if (existing && existing.serverId === serverId && existing.normalizedName === parsed.normalized && existing.principal === principal && !this.#isExpired(existing)) {
        existing.displayName = parsed.value;
        existing.lastSeenAt = Date.now();
        if (!existing.connected) existing.expiresAt = Date.now() + this.#graceMs;
        return existing;
      }
    }

    this.cleanupExpired();
    if (this.#activeNameTaken(serverId, parsed.normalized)) {
      throw new SessionError(409, 'Esse nome já está em uso neste servidor.');
    }

    const activeCount = [...this.#sessions.values()].filter(s => s.serverId === serverId && !this.#isExpired(s)).length;
    if (activeCount >= MAX_PARTICIPANTS) throw new SessionError(429, `O servidor atingiu o limite de ${MAX_PARTICIPANTS} participantes.`);

    if (principal && !this.#db.getIdentity(serverId, parsed.normalized)) this.#db.bindIdentity(serverId, parsed.normalized, principal);
    const role = this.#db.getRole(serverId, parsed.normalized) ?? 'member';
    if (!this.#db.getRole(serverId, parsed.normalized)) {
      this.#db.bindRole(serverId, parsed.normalized, parsed.value, role);
    }
    return this.#newSession(serverId, parsed.value, parsed.normalized, role, principal);
  }

  canResume(serverId: string, rawName: unknown, resumeToken: unknown, principal?: string): boolean {
    const parsed = validateDisplayName(rawName);
    if (!parsed.ok || typeof resumeToken !== 'string') return false;
    const existing = this.#sessions.get(resumeToken);
    return Boolean(existing && existing.serverId === serverId && existing.normalizedName === parsed.normalized && existing.principal === principal && !this.#isExpired(existing));
  }

  get(token: string | undefined): Session | undefined {
    if (!token) return undefined;
    const session = this.#sessions.get(token);
    if (!session || this.#isExpired(session)) return undefined;
    session.lastSeenAt = Date.now();
    return session;
  }

  markConnected(token: string): Session | undefined {
    const session = this.get(token);
    if (!session) return undefined;
    session.connected = true;
    session.expiresAt = undefined;
    return session;
  }

  markDisconnected(token: string): Session | undefined {
    const session = this.#sessions.get(token);
    if (!session) return undefined;
    session.connected = false;
    session.lastSeenAt = Date.now();
    session.expiresAt = Date.now() + this.#graceMs;
    return session;
  }

  setRole(serverId: string, normalizedName: string, displayName: string, role: Role): void {
    if (this.#db.getRole(serverId, normalizedName) === 'owner') throw new SessionError(403, 'O cargo Dono não pode ser alterado.');
    this.#db.bindRole(serverId, normalizedName, displayName, role);
    for (const session of this.#sessions.values()) {
      if (session.serverId === serverId && session.normalizedName === normalizedName) session.role = role;
    }
  }

  listPresence(serverId: string): Array<Pick<Session, 'displayName' | 'role' | 'connected'>> {
    this.cleanupExpired();
    return [...this.#sessions.values()]
      .filter(s => s.serverId === serverId && !this.#isExpired(s))
      .map(s => ({ displayName: s.displayName, role: s.role, connected: s.connected }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'pt-BR'));
  }

  tokensForServer(serverId: string): string[] {
    return [...this.#sessions.values()].filter(session => session.serverId === serverId).map(session => session.token);
  }

  invalidateServer(serverId: string): void {
    for (const [token, session] of this.#sessions) {
      if (session.serverId === serverId) this.#sessions.delete(token);
    }
  }

  cleanupExpired(): void {
    const now = Date.now();
    for (const [token, session] of this.#sessions) {
      if (session.expiresAt && session.expiresAt <= now) this.#sessions.delete(token);
    }
  }

  #activeNameTaken(serverId: string, normalized: string): boolean {
    return [...this.#sessions.values()].some(s => s.serverId === serverId && s.normalizedName === normalized && !this.#isExpired(s));
  }

  #isExpired(session: Session): boolean {
    return Boolean(session.expiresAt && session.expiresAt <= Date.now());
  }

  #newSession(serverId: string, displayName: string, normalizedName: string, role: Role, principal?: string): Session {
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    const session: Session = { token, principal, serverId, displayName, normalizedName, role, createdAt: now, lastSeenAt: now, connected: false, expiresAt: now + 30 * 60_000 };
    this.#db.touchMemberProfile(serverId, normalizedName, displayName);
    this.#sessions.set(token, session);
    return session;
  }
}

export class SessionError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
