import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SlidingWindowRateLimiter, hashServerPassword, validateServerPassword, verifyServerPassword } from '../server/src/security.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name: string) => fs.readFileSync(path.join(root, name), 'utf8');

test('Fase 8: senha nunca é armazenada em texto puro e comparação rejeita valor incorreto', () => {
  const encoded = hashServerPassword('batata-segura-123');
  assert.doesNotMatch(encoded, /batata-segura-123/);
  assert.equal(verifyServerPassword('batata-segura-123', encoded), true);
  assert.equal(verifyServerPassword('outra-senha', encoded), false);
  assert.throws(() => validateServerPassword('curta'), /entre 8 e 128/);
});

test('Fase 8: rate limiter bloqueia rajada e informa espera', () => {
  const limiter = new SlidingWindowRateLimiter(2, 1000);
  assert.equal(limiter.consume('ip', 100).allowed, true);
  assert.equal(limiter.consume('ip', 200).allowed, true);
  const blocked = limiter.consume('ip', 300);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 1);
  assert.equal(limiter.consume('ip', 1200).allowed, true);
});

test('Fase 8: fullscreen nativo, mute por transmissão e voz separada da navegação estão presentes', () => {
  const screen = read('client/src/screen-ui.ts');
  const main = read('client/src/main.ts');
  const ws = read('server/src/websocket.ts');
  assert.match(screen, /requestFullscreen/);
  assert.match(screen, /Mutar transmissão/);
  assert.match(screen, /setScreenAudioMuted/);
  assert.match(main, /new RealtimeClient\('voice'\)/);
  assert.doesNotMatch(main.slice(main.indexOf('async function selectServer'), main.indexOf('async function selectChannel')), /voice\.leave/);
  assert.match(ws, /hasSibling/);
});
