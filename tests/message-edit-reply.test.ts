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

async function wsOpen(url: string): Promise<WebSocket> {
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout websocket')), 3000);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('erro websocket')); }, { once: true });
  });
  return ws;
}

function waitEvent(ws: WebSocket, type: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`timeout evento ${type}`)); }, 3000);
    const handler = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(String(event.data));
        if (payload.type !== type) return;
        cleanup();
        resolve(payload);
      } catch {}
    };
    const cleanup = () => { clearTimeout(timer); ws.removeEventListener('message', handler); };
    ws.addEventListener('message', handler);
  });
}

test('mensagens: resposta, edição apenas pelo autor e legenda editável em anexo', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'verdant-edit-reply-'));
  const dataDir = path.join(temp, 'data');
  const logDir = path.join(temp, 'logs');
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = startServer(port, dataDir, logDir);

  try {
    await waitHealth(base, child);
    const created: any = await (await fetch(`${base}/api/servers`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Chat', ownerName: 'Uriel' })
    })).json();
    const serverId = created.server.id as string;
    const channelId = created.channels.find((item: any) => item.type === 'text').id as string;
    const ownerToken = created.session.token as string;

    const joined: any = await (await fetch(`${base}/api/servers/${serverId}/join`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Rafael' })
    })).json();
    const rafaelToken = joined.session.token as string;

    const ownerWs = await wsOpen(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(ownerToken)}`);
    const rafaelWs = await wsOpen(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(rafaelToken)}`);

    const firstEvent = waitEvent(ownerWs, 'chat.message');
    rafaelWs.send(JSON.stringify({ type: 'chat.send', channelId, content: 'mensagem original' }));
    const first = (await firstEvent).message;

    const replyEvent = waitEvent(ownerWs, 'chat.message');
    rafaelWs.send(JSON.stringify({ type: 'chat.send', channelId, content: 'resposta', replyToId: first.id }));
    const reply = (await replyEvent).message;
    assert.equal(reply.replyTo.id, first.id);
    assert.equal(reply.replyTo.authorName, 'Rafael');
    assert.equal(reply.replyTo.content, 'mensagem original');

    const editResponse = await fetch(`${base}/api/messages/${reply.id}`, {
      method: 'PATCH', headers: { authorization: `Bearer ${rafaelToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'resposta editada' })
    });
    assert.equal(editResponse.status, 200);
    const edited: any = await editResponse.json();
    assert.equal(edited.message.content, 'resposta editada');
    assert.equal(typeof edited.message.editedAt, 'string');

    const forbidden = await fetch(`${base}/api/messages/${reply.id}`, {
      method: 'PATCH', headers: { authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'dono tentou editar' })
    });
    assert.equal(forbidden.status, 403);

    const uploadId = 'upload-caption-test-12345678';
    const upload = await fetch(`${base}/api/channels/${channelId}/files?name=imagem.png&uploadId=${uploadId}&replyToId=${encodeURIComponent(first.id)}`, {
      method: 'POST', headers: { authorization: `Bearer ${rafaelToken}` }, body: Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])
    });
    assert.equal(upload.status, 201);
    const uploaded: any = await upload.json();
    assert.equal(uploaded.message.replyTo.id, first.id);

    const initialCaption = await fetch(`${base}/api/messages/${uploaded.message.id}`, {
      method: 'PATCH', headers: { authorization: `Bearer ${rafaelToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'legenda inicial', initialCaption: true })
    });
    assert.equal(initialCaption.status, 200);
    const captioned: any = await initialCaption.json();
    assert.equal(captioned.message.content, 'legenda inicial');
    assert.equal(captioned.message.editedAt, undefined);

    const captionEdit = await fetch(`${base}/api/messages/${uploaded.message.id}`, {
      method: 'PATCH', headers: { authorization: `Bearer ${rafaelToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'legenda alterada' })
    });
    assert.equal(captionEdit.status, 200);
    const recaptioned: any = await captionEdit.json();
    assert.equal(recaptioned.message.content, 'legenda alterada');
    assert.equal(typeof recaptioned.message.editedAt, 'string');

    const history: any = await (await fetch(`${base}/api/channels/${channelId}/messages?limit=50`, { headers: { authorization: `Bearer ${ownerToken}` } })).json();
    const storedReply = history.messages.find((item: any) => item.id === reply.id);
    const storedAttachment = history.messages.find((item: any) => item.id === uploaded.message.id);
    assert.equal(storedReply.content, 'resposta editada');
    assert.equal(storedReply.replyTo.id, first.id);
    assert.equal(storedAttachment.content, 'legenda alterada');
    assert.equal(storedAttachment.replyTo.id, first.id);

    ownerWs.close();
    rafaelWs.close();
  } finally {
    await stopServer(child);
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
