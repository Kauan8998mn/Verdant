import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, isPublicIPv4, resolveAnnouncedAddress } from '../server/src/config.ts';
import { TurnCredentials } from '../server/src/turn.ts';
import { proxyPrincipal, clientRateKey } from '../server/src/proxy-auth.ts';
import { bearerToken } from '../server/src/http-utils.ts';
import { sanitizeContext } from '../server/src/logger.ts';
import { AppDatabase } from '../server/src/database.ts';
import { SessionManager } from '../server/src/sessions.ts';

test('public config rejects private media, exposed HTTP and malformed settings', () => {
  const env = { NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://verdant.test', MEDIASOUP_ANNOUNCED_ADDRESS: '8.8.8.8' };
  assert.equal(loadConfig('/tmp', env).host, '127.0.0.1');
  assert.equal(loadConfig('/tmp', {}).host, '0.0.0.0');
  assert.equal(isPublicIPv4('203.0.113.1'), false);
  assert.equal(isPublicIPv4('203.0.114.1'), true);
  assert.equal(isPublicIPv4('198.51.100.1'), false);
  assert.equal(isPublicIPv4('198.51.101.1'), true);
  for (const patch of [{ VERDANT_HOST: '0.0.0.0' }, { PUBLIC_ORIGIN: 'http://verdant.test' },
    { MEDIASOUP_ANNOUNCED_ADDRESS: '10.0.0.2' }, { MEDIA_EXPOSE_INTERNAL_IP: 'true' },
    { VERDANT_PORT: '43110x' }, { UPLOAD_MAX_MB: '0' }, { TLS_CERT: '/tmp/cert' }]) {
    assert.throws(() => loadConfig('/tmp', { ...env, ...patch }));
  }
});

test('public media hostname cannot resolve to loopback', async () => {
  const config = loadConfig('/tmp', { NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://verdant.test',
    MEDIASOUP_ANNOUNCED_ADDRESS: 'localhost' });
  await assert.rejects(resolveAnnouncedAddress(config), /IPv4 público/);
});

test('TURN uses expiring HMAC credentials and limits diagnostic transport modes', () => {
  const env = { TURN_ENABLED: 'true', TURN_SECRET: 'a'.repeat(64), TURN_HOST: 'turn.verdant.test', TURN_REALM: 'verdant.test', TURN_TTL_SECONDS: '120' };
  const service = new TurnCredentials(env);
  const a = service.issue(1_000_000), b = service.issue(1_100_000);
  assert.equal(a.expiresAt, 1_120_000);
  assert.equal(b.expiresAt, 1_220_000);
  assert.notEqual(a.iceServers[0].username, b.iceServers[0].username);
  assert.equal(a.iceServers[0].credential, createHmac('sha1', env.TURN_SECRET).update(a.iceServers[0].username).digest('base64'));
  assert.equal(a.iceServers[0].urls.length, 3);
  assert.throws(() => new TurnCredentials({ ...env, VERDANT_ICE_POLICY: 'relay' }));
  const relay = new TurnCredentials({ ...env, VERDANT_DEBUG_WEBRTC: 'true', VERDANT_ICE_POLICY: 'relay', VERDANT_TURN_TRANSPORT: 'tcp' }).issue();
  assert.equal(relay.iceTransportPolicy, 'relay');
  assert.deepEqual(relay.iceServers[0].urls, ['turn:turn.verdant.test:3478?transport=tcp']);
  assert.throws(() => new TurnCredentials({ ...env, TURN_SECRET: 'short' }));
  for (const secret of ['a'.repeat(32) + '#comment', 'a'.repeat(32) + '\nno-auth', 'a'.repeat(257)]) {
    assert.throws(() => new TurnCredentials({ ...env, TURN_SECRET: secret }));
  }
  assert.deepEqual(new TurnCredentials({}).issue().iceServers, []);
});

test('proxy identity only trusts loopback and Basic coexists with app session', () => {
  const req: any = { socket: { remoteAddress: '127.0.0.1' }, headers: {
    'x-verdant-user': 'alice', 'x-verdant-client-ip': '192.0.2.2',
    authorization: 'Basic dGVzdA==', 'x-verdant-session': 'a'.repeat(43)
  } };
  assert.equal(proxyPrincipal(req), 'alice');
  assert.equal(clientRateKey(req, true), '192.0.2.2');
  assert.equal(bearerToken(req), 'a'.repeat(43));
  req.socket.remoteAddress = '192.0.2.3';
  assert.equal(proxyPrincipal(req), undefined);
  assert.equal(clientRateKey(req, true), '192.0.2.3');
});

test('identity remains bound across restart and legacy roles cannot be claimed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verdant-identity-'));
  const db = new AppDatabase(dir);
  try {
    const server = db.createServer('Identity', '');
    const first = new SessionManager(db);
    const owner = first.createOwnerSession(server.id, 'Owner', 'alice');
    assert.equal(first.canResume(server.id, 'Owner', owner.token, 'bob'), false);
    const restarted = new SessionManager(db);
    assert.throws(() => restarted.join(server.id, 'Owner', undefined, 'bob'));
    assert.throws(() => restarted.join(server.id, 'Owner'));
    assert.equal(restarted.join(server.id, 'Owner', undefined, 'alice').role, 'owner');
    db.bindRole(server.id, 'legacy', 'Legacy', 'moderator');
    assert.throws(() => restarted.join(server.id, 'Legacy', undefined, 'bob'));
    assert.throws(() => restarted.setRole(server.id, 'owner', 'Owner', 'member'));
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('resuming without a live websocket keeps a finite session expiry', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verdant-expiry-'));
  const db = new AppDatabase(dir);
  try {
    const server = db.createServer('Expiry', '');
    const sessions = new SessionManager(db);
    const owner = sessions.createOwnerSession(server.id, 'Owner');
    sessions.markConnected(owner.token);
    sessions.markDisconnected(owner.token);
    assert.equal(sessions.join(server.id, 'Owner', owner.token), owner);
    assert.ok(owner.expiresAt && owner.expiresAt > Date.now());
    owner.expiresAt = Date.now() - 1;
    assert.equal(sessions.canResume(server.id, 'Owner', owner.token), false);
    sessions.cleanupExpired();
    assert.equal(sessions.get(owner.token), undefined);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('structured logs redact nested TURN credentials and websocket tokens', () => {
  assert.deepEqual(sanitizeContext({ nested: [{ credential: 'hidden', token: 'hidden', route: 'relay' }], url: '/ws?token=hidden&purpose=voice' }), {
    nested: [{ route: 'relay' }], url: '/ws?token=[redacted]&purpose=voice'
  });
});
