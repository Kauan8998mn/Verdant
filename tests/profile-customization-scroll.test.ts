import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AppDatabase } from '../server/src/database.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('porta indisponível'));
      server.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

function startServer(port: number, dataDir: string, logDir: string): ChildProcess {
  return spawn(process.execPath, ['--experimental-strip-types', 'server/src/index.ts'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port), HOST: '127.0.0.1', MEDIA_DISABLED: '1',
      DATA_DIR: dataDir, LOG_DIR: logDir, UPLOAD_DIR: path.join(dataDir, 'uploads')
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

async function waitHealth(base: string, child: ChildProcess): Promise<void> {
  let output = '';
  child.stdout?.on('data', chunk => { output += chunk.toString(); });
  child.stderr?.on('data', chunk => { output += chunk.toString(); });
  for (let i = 0; i < 80; i += 1) {
    if (child.exitCode !== null) throw new Error(`Servidor encerrou:\n${output}`);
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timeout:\n${output}`);
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

test('perfil: avatar persiste no SQLite e remoção preserva o perfil', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verdant-profile-db-'));
  let db = new AppDatabase(dir);
  const server = db.createServer('Perfis');
  db.touchMemberProfile(server.id, 'uriel', 'Uriel');
  const fakeWebp = 'data:image/webp;base64,' + Buffer.from('RIFFxxxxWEBP').toString('base64');
  const saved = db.updateMemberAvatar(server.id, 'uriel', 'Uriel', fakeWebp);
  assert.equal(saved.avatarDataUrl, fakeWebp);
  db.close();

  db = new AppDatabase(dir);
  assert.equal(db.getMemberProfile(server.id, 'uriel')?.avatarDataUrl, fakeWebp);
  const removed = db.updateMemberAvatar(server.id, 'uriel', 'Uriel', undefined);
  assert.equal(removed.avatarDataUrl, null);
  assert.equal(db.listMemberProfiles(server.id).length, 1);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('perfil: endpoint só altera o perfil da sessão autenticada', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'verdant-profile-api-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = startServer(port, path.join(temp, 'data'), path.join(temp, 'logs'));
  try {
    await waitHealth(base, child);
    const created: any = await (await fetch(`${base}/api/servers`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Perfis', ownerName: 'Uriel' })
    })).json();
    const serverId = created.server.id as string;
    const ownerToken = created.session.token as string;

    const joined: any = await (await fetch(`${base}/api/servers/${serverId}/join`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Rafael' })
    })).json();
    const rafaelToken = joined.session.token as string;

    const fakeWebp = 'data:image/webp;base64,' + Buffer.from('RIFFxxxxWEBP').toString('base64');
    const update = await fetch(`${base}/api/servers/${serverId}/profile`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${rafaelToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ avatarDataUrl: fakeWebp })
    });
    assert.equal(update.status, 200);
    const payload: any = await update.json();
    assert.equal(payload.profile.displayName, 'Rafael');
    assert.equal(payload.profile.avatarDataUrl, fakeWebp);

    const listResponse = await fetch(`${base}/api/servers/${serverId}/profiles`, {
      headers: { authorization: `Bearer ${ownerToken}` }
    });
    assert.equal(listResponse.status, 200);
    const list: any = await listResponse.json();
    const rafael = list.profiles.find((profile: any) => profile.displayName === 'Rafael');
    const uriel = list.profiles.find((profile: any) => profile.displayName === 'Uriel');
    assert.equal(rafael.avatarDataUrl, fakeWebp);
    assert.ok(uriel);
    assert.notEqual(uriel.avatarDataUrl, fakeWebp);

    const invalid = await fetch(`${base}/api/servers/${serverId}/profile`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${rafaelToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ avatarDataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' })
    });
    assert.equal(invalid.status, 400);
  } finally {
    await stopServer(child);
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('chat: atualização incremental não reconstrói toda a lista e Chromium não usa scroll anchoring', () => {
  const main = fs.readFileSync(path.join(root, 'client/src/main.ts'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'client/public/styles.css'), 'utf8');
  assert.match(main, /function reconcileMessageList\(/);
  assert.match(main, /messages\.insertBefore\(node, current \?\? null\)/);
  assert.match(main, /function restorePatchedMessageScroll\(/);
  assert.match(main, /if \(!messages\.isConnected \|\| !scrollPinned\) return;/);
  assert.match(css, /\.messages\s*\{[\s\S]*?scroll-behavior:\s*auto\s*!important;[\s\S]*?overflow-anchor:\s*none;/);
});

test('aparência: foto, presets, blur e brilho de fala estão conectados às preferências locais', () => {
  const main = fs.readFileSync(path.join(root, 'client/src/main.ts'), 'utf8');
  const prefs = fs.readFileSync(path.join(root, 'client/src/client-preferences.ts'), 'utf8');
  assert.match(main, /renderProfileSettings/);
  assert.match(main, /prepareAvatarImage/);
  assert.match(main, /createImageBitmap/);
  assert.match(main, /THEME_PRESETS/);
  assert.match(main, /SPEAKING_PRESETS/);
  assert.match(prefs, /speakingColor:/);
  assert.match(prefs, /speakingGlow:/);
  assert.match(prefs, /panelBlur:/);
  assert.match(prefs, /--speaking-ring/);
  assert.match(prefs, /--panel-blur/);
});
