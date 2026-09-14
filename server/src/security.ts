import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const SCRYPT_COST = 16_384;

export function validateServerPassword(value: unknown, optional = true): string | undefined {
  if ((value === undefined || value === null || value === '') && optional) return undefined;
  if (typeof value !== 'string') throw new SecurityError(400, 'Senha inválida.');
  if (value.length < PASSWORD_MIN || value.length > PASSWORD_MAX) {
    throw new SecurityError(400, `A senha deve ter entre ${PASSWORD_MIN} e ${PASSWORD_MAX} caracteres.`);
  }
  return value;
}

export function hashServerPassword(password: string): string {
  const salt = randomBytes(16);
  const digest = scryptSync(password, salt, 32, { N: SCRYPT_COST, r: 8, p: 1 });
  return `scrypt$${SCRYPT_COST}$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

export function verifyServerPassword(password: unknown, stored: string | undefined): boolean {
  if (!stored || typeof password !== 'string') return false;
  const [algorithm, costText, saltText, digestText] = stored.split('$');
  if (algorithm !== 'scrypt' || !costText || !saltText || !digestText) return false;
  const cost = Number(costText);
  if (!Number.isSafeInteger(cost) || cost < 2 || cost > SCRYPT_COST) return false;
  try {
    const expected = Buffer.from(digestText, 'base64url');
    const actual = scryptSync(password, Buffer.from(saltText, 'base64url'), expected.length, { N: cost, r: 8, p: 1 });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export class SlidingWindowRateLimiter {
  #buckets = new Map<string, { startedAt: number; count: number }>();
  #limit: number;
  #windowMs: number;
  constructor(limit: number, windowMs: number) {
    this.#limit = limit;
    this.#windowMs = windowMs;
  }

  consume(key: string, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
    let bucket = this.#buckets.get(key);
    if (!bucket || now - bucket.startedAt >= this.#windowMs) {
      bucket = { startedAt: now, count: 0 };
      this.#buckets.set(key, bucket);
    }
    bucket.count += 1;
    return {
      allowed: bucket.count <= this.#limit,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.startedAt + this.#windowMs - now) / 1000))
    };
  }
}

export class SecurityError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
