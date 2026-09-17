import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';

async function port(): Promise<number> {
  return new Promise(resolve => {
    const server = net.createServer().listen(0, '127.0.0.1', () => {
      const p = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(p));
    });
  });
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null) return;
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.kill('SIGTERM');
  });
}
async function ready(url: string, child: ChildProcess) {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error('Test service exited');
    try { await fetch(url); return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Service timeout: ${url}`);
}
async function upgrade(url: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { headers: { ...headers, Connection: 'Upgrade', Upgrade: 'websocket',
      'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==' } });
    req.setTimeout(5000, () => req.destroy(new Error('Upgrade timeout')));
    req.on('error', reject);
    req.on('response', res => { res.resume(); resolve(res.statusCode!); });
    req.on('upgrade', (res, socket) => { socket.destroy(); resolve(res.statusCode!); });
    req.end();
  });
}

test('real Caddy: Basic, session, history, upload and WebSocket identity isolation', { timeout: 60_000 }, async t => {
  if (spawnSync('caddy', ['version']).status !== 0) {
    if (process.env.REQUIRE_PROXY_E2E === '1') assert.fail('Caddy required');
    t.skip('Caddy not installed'); return;
  }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'verdant-proxy-'));
  const appPort = await port(), proxyPort = await port(), turnPort = await port();
  const origin = `https://127.0.0.1:${proxyPort}`, base = `http://127.0.0.1:${proxyPort}`;
  const password = 'local-test-password-only';
  const hash = spawnSync('caddy', ['hash-password'], { input: password + '\n', encoding: 'utf8' });
  assert.equal(hash.status, 0);
  fs.writeFileSync(path.join(temp, 'users'), `alice ${hash.stdout.trim()}\nbob ${hash.stdout.trim()}\n`, { mode: 0o600 });
  const caddyfile = fs.readFileSync('deploy/Caddyfile', 'utf8')
    .replace('https://@@APP_HOST@@', base).replace('https://@@TURN_HOST@@', `http://127.0.0.1:${turnPort}`)
    .replace('/etc/verdant/caddy-users', path.join(temp, 'users'))
    .replaceAll('@@APP_PORT@@', String(appPort)).replaceAll('@@UPLOAD_BYTES@@', '1048576')
    .replace('{\n  servers', '{\n  admin off\n  servers');
  fs.writeFileSync(path.join(temp, 'Caddyfile'), caddyfile);
  const children: ChildProcess[] = [];
  let output = '';
  const start = (cmd: string, args: string[], env: NodeJS.ProcessEnv) => {
    const child = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout!.on('data', b => { output += b; }); child.stderr!.on('data', b => { output += b; });
    children.push(child); return child;
  };
  const auth = (user: string) => ({ authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`, origin });
  try {
    const app = start(process.execPath, ['server/src/index.ts'], { ...process.env, NODE_ENV: 'production', MEDIA_DISABLED: 'true',
      VERDANT_PORT: String(appPort), PUBLIC_ORIGIN: origin, DATA_DIR: path.join(temp, 'data'), UPLOAD_PATH: path.join(temp, 'uploads'),
      LOG_DIR: '/proc/verdant-no-file-logs', UPLOAD_MAX_MB: '1' });
    await ready(`http://127.0.0.1:${appPort}/api/health`, app);
    const proxy = start('caddy', ['run', '--config', path.join(temp, 'Caddyfile'), '--adapter', 'caddyfile'], process.env);
    await ready(base, proxy);
    assert.equal((await fetch(`${base}/api/bootstrap`)).status, 401);
    const bootstrap = await (await fetch(`${base}/api/bootstrap`, { headers: auth('alice') })).json();
    assert.deepEqual(bootstrap.addresses, []);
    assert.deepEqual(bootstrap.media.listenAddresses, []);
    const health = await (await fetch(`${base}/api/health`, { headers: auth('alice') })).json();
    assert.deepEqual(health, { ok: true, server: true, database: true, mediasoup: false });
    const create = await fetch(`${base}/api/servers`, { method: 'POST', headers: { ...auth('alice'), 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Proxy QA', ownerName: 'Alice' }) });
    assert.equal(create.status, 201);
    const created = await create.json(), token = created.session.token;
    const channel = created.channels.find((c: any) => c.type === 'text');
    const history = `${base}/api/channels/${channel.id}/messages`;
    assert.equal((await fetch(history, { headers: auth('alice') })).status, 401);
    assert.equal((await fetch(history, { headers: { ...auth('alice'), 'x-verdant-session': token } })).status, 200);
    assert.equal((await fetch(history, { headers: { ...auth('bob'), 'x-verdant-session': token, 'x-verdant-user': 'alice' } })).status, 401);
    const upload = await fetch(`${base}/api/channels/${channel.id}/files?name=qa.txt`, { method: 'POST', headers: { ...auth('alice'), 'x-verdant-session': token, 'content-type': 'application/octet-stream' }, body: 'proxy QA attachment' });
    assert.equal(upload.status, 201);
    assert.equal((await fetch(`${base}/api/servers`, { method: 'POST', headers: { ...auth('alice'), origin: 'https://evil.test', 'content-type': 'application/json' }, body: '{}' })).status, 403);
    assert.equal(await upgrade(`${base}/ws?token=${token}`, auth('alice')), 101);
    assert.equal(await upgrade(`${base}/ws?token=${token}`, { ...auth('bob'), 'x-verdant-user': 'alice' }), 401);
    assert.equal(await upgrade(`${base}/ws?token=${token}`, { ...auth('alice'), origin: 'https://evil.test' }), 403);
  } catch (error) { t.diagnostic(output); throw error; }
  finally { for (const child of children.reverse()) await stop(child); fs.rmSync(temp, { recursive: true, force: true }); }
});
