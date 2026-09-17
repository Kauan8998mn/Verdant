import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', MEDIA_DISABLED: '1', DATA_DIR: dataDir, LOG_DIR: logDir, UPLOAD_DIR: path.join(dataDir, 'uploads') },
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

test('0.3.6 real: repetir o mesmo uploadId não cria arquivo/mensagem duplicados', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'verdant-upload-idempotent-'));
  const dataDir = path.join(temp, 'data');
  const logDir = path.join(temp, 'logs');
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = startServer(port, dataDir, logDir);

  try {
    await waitHealth(base, child);
    const created: any = await (await fetch(`${base}/api/servers`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Idempotente', ownerName: 'Uriel' })
    })).json();
    const token = created.session.token as string;
    const channelId = created.channels.find((item: any) => item.type === 'text').id as string;
    const uploadId = 'upload-idempotente-12345678';
    const body = Buffer.from('imagem-ou-arquivo-de-teste');
    const target = `${base}/api/channels/${channelId}/files?name=teste.txt&uploadId=${encodeURIComponent(uploadId)}`;

    const first = await fetch(target, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body });
    assert.equal(first.status, 201);
    const a: any = await first.json();

    const second = await fetch(target, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body });
    assert.equal(second.status, 200);
    const b: any = await second.json();
    assert.equal(b.reused, true);
    assert.equal(b.file.id, a.file.id);
    assert.equal(b.message.id, a.message.id);

    const history: any = await (await fetch(`${base}/api/channels/${channelId}/messages?limit=50`, { headers: { authorization: `Bearer ${token}` } })).json();
    assert.equal(history.messages.length, 1);
    const stored = fs.readdirSync(path.join(dataDir, 'uploads')).filter(name => !name.endsWith('.part'));
    assert.equal(stored.length, 1);
  } finally {
    await stopServer(child);
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
