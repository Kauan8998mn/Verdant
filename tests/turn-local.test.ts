import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { TurnCredentials } from '../server/src/turn.ts';
import { checkTurnRelay } from './helpers/turn-client.ts';
import { turnTlsSettings } from '../deploy/turn-tls.mjs';

test('local Coturn: issued HMAC credentials relay packets over UDP, TCP and TLS', { timeout: 90_000 }, async t => {
  if (process.env.REQUIRE_TURN_E2E !== '1') { t.skip('Run with REQUIRE_TURN_E2E=1 for local Coturn test'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verdant-turn-'));
  const secret = randomBytes(32).toString('hex');
  const env = { TURN_ENABLED: 'true', TURN_SECRET: secret, TURN_HOST: 'localhost', TURN_REALM: 'verdant.test', TURN_TTL_SECONDS: '120' };
  const cert = path.join(dir, 'cert.pem'), key = path.join(dir, 'key.pem');
  assert.equal(spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-keyout', key, '-out', cert], { stdio: 'ignore' }).status, 0);
  const values: Record<string, string> = { TURN_PORT: '43978', TURN_TLS_PORT: '43979', TURN_LISTEN_IP: '127.0.0.1', PUBLIC_IP: '127.0.0.1',
    RELAY_MIN: '44000', RELAY_MAX: '44030', TURN_REALM: env.TURN_REALM, TURN_HOST: env.TURN_HOST, TURN_SECRET: secret,
    TLS_SETTINGS: turnTlsSettings(true, spawnSync('turnserver', ['-h'], { encoding: 'utf8' }).stdout, cert, key) };
  const config = fs.readFileSync('deploy/turnserver.conf.example', 'utf8').replace(/@@([A-Z_]+)@@/g, (_, k) => values[k]);
  // Loopback peers are enabled only in this isolated local test, never in deploy.
  fs.writeFileSync(path.join(dir, 'turn.conf'), config + `\nallow-loopback-peers\nrelay-threads=1\npidfile=${dir}/turn.pid\n`, { mode: 0o600 });
  const server = spawn('turnserver', ['-c', path.join(dir, 'turn.conf')], { stdio: ['ignore', 'pipe', 'pipe'] });
  let serverOutput = '';
  server.stdout.on('data', b => { serverOutput += b; }); server.stderr.on('data', b => { serverOutput += b; });
  try {
    for (let i = 0; i < 100 && !serverOutput.includes('Relay ports initialization done'); i++) {
      if (server.exitCode !== null) throw new Error(serverOutput);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    for (const mode of ['udp', 'tcp', 'tls'] as const) {
      const credential = new TurnCredentials(env).issue().iceServers[0];
      await checkTurnRelay({ mode, port: mode === 'tls' ? 43979 : 43978, ca: fs.readFileSync(cert), ...credential });
      t.diagnostic(`${mode}: 5 ChannelData packets echoed through relay with app-issued credentials`);
    }
    const expired = new TurnCredentials(env).issue(Date.now() - 300_000).iceServers[0];
    await checkTurnRelay({ mode: 'tcp', port: 43978, ca: fs.readFileSync(cert), ...expired, expired: true });
  } finally {
    if (server.exitCode === null) await new Promise<void>(resolve => {
      const timer = setTimeout(() => server.kill('SIGKILL'), 3000);
      server.once('exit', () => { clearTimeout(timer); resolve(); }); server.kill('SIGTERM');
    });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
