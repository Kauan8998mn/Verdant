import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
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
      const port = address.port;
      server.close(error => error ? reject(error) : resolve(port));
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
    if (child.exitCode !== null) throw new Error(`Servidor encerrou antes do healthcheck:\n${output}`);
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch { /* retry */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timeout aguardando servidor:\n${output}`);
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
      } catch { /* ignore */ }
    };
    const cleanup = () => { clearTimeout(timer); ws.removeEventListener('message', handler); };
    ws.addEventListener('message', handler);
  });
}

test('fluxo real: servidor + nomes únicos + WebSocket + histórico persistente', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'verdant-integration-'));
  const dataDir = path.join(temp, 'data');
  const logDir = path.join(temp, 'logs');
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let child = startServer(port, dataDir, logDir);

  try {
    await waitHealth(base, child);

    const createdResponse = await fetch(`${base}/api/servers`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Servidor Teste', ownerName: 'Uriel' })
    });
    assert.equal(createdResponse.status, 201);
    const created: any = await createdResponse.json();
    const serverId = created.server.id as string;
    const channelId = created.channels.find((item: any) => item.type === 'text').id as string;
    const ownerToken = created.session.token as string;

    const joinResponse = await fetch(`${base}/api/servers/${serverId}/join`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Alice' })
    });
    assert.equal(joinResponse.status, 200);
    const joined: any = await joinResponse.json();

    const duplicateResponse = await fetch(`${base}/api/servers/${serverId}/join`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'alice' })
    });
    assert.equal(duplicateResponse.status, 409);

    const ownerWs = await wsOpen(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(ownerToken)}`);
    const aliceWs = await wsOpen(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(joined.session.token)}`);
    const received = waitEvent(aliceWs, 'chat.message');
    ownerWs.send(JSON.stringify({ type: 'chat.send', channelId, content: 'Olá pela LAN' }));
    const event = await received;
    assert.equal(event.message.content, 'Olá pela LAN');
    assert.equal(event.message.authorName, 'Uriel');

    const historyResponse = await fetch(`${base}/api/channels/${channelId}/messages?limit=50`, { headers: { authorization: `Bearer ${ownerToken}` } });
    const history: any = await historyResponse.json();
    assert.equal(history.messages.length, 1);
    assert.equal(history.messages[0].content, 'Olá pela LAN');

    ownerWs.close();
    aliceWs.close();
    await stopServer(child);

    child = startServer(port, dataDir, logDir);
    await waitHealth(base, child);
    const bootstrap: any = await (await fetch(`${base}/api/bootstrap`)).json();
    assert.equal(bootstrap.servers.some((server: any) => server.id === serverId), true);
    const rejoined: any = await (await fetch(`${base}/api/servers/${serverId}/join`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Uriel' })
    })).json();
    const persisted: any = await (await fetch(`${base}/api/channels/${channelId}/messages?limit=50`, { headers: { authorization: `Bearer ${rejoined.session.token}` } })).json();
    assert.equal(persisted.messages[0].content, 'Olá pela LAN');
  } finally {
    await stopServer(child);
    fs.rmSync(temp, { recursive: true, force: true });
  }
});


test('Fase 3 real: upload, MIME verificado, histórico, download e limite configurado de 50 MB', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'verdant-files-'));
  const dataDir = path.join(temp, 'data');
  const logDir = path.join(temp, 'logs');
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = startServer(port, dataDir, logDir);

  try {
    await waitHealth(base, child);
    const created: any = await (await fetch(`${base}/api/servers`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Arquivos', ownerName: 'Uriel' })
    })).json();
    const token = created.session.token as string;
    const channelId = created.channels.find((item: any) => item.type === 'text').id as string;
    const pdf = Buffer.from('%PDF-1.7\nverdant-test\n%%EOF\n', 'utf8');

    const uploadResponse = await fetch(`${base}/api/channels/${channelId}/files?name=${encodeURIComponent('../../manual.pdf')}`, {
      method: 'POST', headers: { authorization: `Bearer ${token}` }, body: pdf
    });
    assert.equal(uploadResponse.status, 201);
    const upload: any = await uploadResponse.json();
    assert.equal(upload.file.originalName, 'manual.pdf');
    assert.equal(upload.file.mime, 'application/pdf');
    assert.equal(upload.file.size, pdf.length);
    assert.equal(upload.message.attachment.originalName, 'manual.pdf');

    const history: any = await (await fetch(`${base}/api/channels/${channelId}/messages?limit=50`, { headers: { authorization: `Bearer ${token}` } })).json();
    assert.equal(history.messages.length, 1);
    assert.equal(history.messages[0].attachment.id, upload.file.id);

    const grantResponse = await fetch(`${base}/api/files/${upload.file.id}/grant`, {
      method: 'POST', headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(grantResponse.status, 200);
    const grant: any = await grantResponse.json();
    const downloadResponse = await fetch(`${base}${grant.url}`);
    assert.equal(downloadResponse.status, 200);
    assert.equal(downloadResponse.headers.get('content-type'), 'application/pdf');
    assert.match(downloadResponse.headers.get('content-disposition') ?? '', /manual\.pdf/);
    assert.deepEqual(Buffer.from(await downloadResponse.arrayBuffer()), pdf);

    const reused = await fetch(`${base}${grant.url}`);
    assert.equal(reused.status, 401);

    const oversizeStatus = await new Promise<number>((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1', port,
        path: `/api/channels/${channelId}/files?name=grande.bin`,
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-length': String(500 * 1024 * 1024 + 1) }
      }, res => {
        res.resume();
        res.once('end', () => resolve(res.statusCode ?? 0));
      });
      req.once('error', reject);
      req.end();
    });
    assert.equal(oversizeStatus, 413);

    const uploadFiles = fs.readdirSync(path.join(dataDir, 'uploads')).filter(name => !name.endsWith('.part'));
    assert.equal(uploadFiles.length, 1);
    assert.equal(uploadFiles.some(name => name.includes('manual.pdf')), false);
  } finally {
    await stopServer(child);
    fs.rmSync(temp, { recursive: true, force: true });
  }
});


test('pré-Fase 6: somente Dono apaga mensagem/canal/servidor e anexos físicos acompanham a exclusão', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'verdant-owner-delete-'));
  const dataDir = path.join(temp, 'data');
  const logDir = path.join(temp, 'logs');
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = startServer(port, dataDir, logDir);
  try {
    await waitHealth(base, child);
    const created: any = await (await fetch(`${base}/api/servers`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Admin', ownerName: 'Dono' })
    })).json();
    const serverId = created.server.id as string;
    const ownerToken = created.session.token as string;
    const textId = created.channels.find((item: any) => item.type === 'text').id as string;
    const joined: any = await (await fetch(`${base}/api/servers/${serverId}/join`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Membro' })
    })).json();
    const memberToken = joined.session.token as string;

    const ownerWs = await wsOpen(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(ownerToken)}`);
    const messageEvent = waitEvent(ownerWs, 'chat.message');
    ownerWs.send(JSON.stringify({ type: 'chat.send', channelId: textId, content: 'apague-me' }));
    const sent = await messageEvent;

    const denied = await fetch(`${base}/api/messages/${sent.message.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${memberToken}` } });
    assert.equal(denied.status, 403);

    const deletedEvent = waitEvent(ownerWs, 'chat.message.deleted');
    const deleted = await fetch(`${base}/api/messages/${sent.message.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${ownerToken}` } });
    assert.equal(deleted.status, 200);
    assert.equal((await deletedEvent).messageId, sent.message.id);

    const uploadDir = path.join(dataDir, 'uploads');
    const uploadForMessage: any = await (await fetch(`${base}/api/channels/${textId}/files?name=apagar-msg.txt`, {
      method: 'POST', headers: { authorization: `Bearer ${ownerToken}` }, body: Buffer.from('anexo mensagem')
    })).json();
    assert.equal(fs.readdirSync(uploadDir).filter(name => !name.endsWith('.part')).length, 1);
    const deleteAttachmentMessage = await fetch(`${base}/api/messages/${uploadForMessage.message.id}`, {
      method: 'DELETE', headers: { authorization: `Bearer ${ownerToken}` }
    });
    assert.equal(deleteAttachmentMessage.status, 200);
    assert.equal(fs.readdirSync(uploadDir).filter(name => !name.endsWith('.part')).length, 0);

    const secondText: any = await (await fetch(`${base}/api/servers/${serverId}/channels`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ name: 'temporario', type: 'text' })
    })).json();
    await fetch(`${base}/api/channels/${secondText.channel.id}/files?name=apagar-canal.txt`, {
      method: 'POST', headers: { authorization: `Bearer ${ownerToken}` }, body: Buffer.from('anexo canal')
    });
    assert.equal(fs.readdirSync(uploadDir).filter(name => !name.endsWith('.part')).length, 1);
    const memberDeleteChannel = await fetch(`${base}/api/channels/${secondText.channel.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${memberToken}` } });
    assert.equal(memberDeleteChannel.status, 403);
    const ownerDeleteChannel = await fetch(`${base}/api/channels/${secondText.channel.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${ownerToken}` } });
    assert.equal(ownerDeleteChannel.status, 200);
    assert.equal(fs.readdirSync(uploadDir).filter(name => !name.endsWith('.part')).length, 0);

    await fetch(`${base}/api/channels/${textId}/files?name=apagar-servidor.txt`, {
      method: 'POST', headers: { authorization: `Bearer ${ownerToken}` }, body: Buffer.from('anexo servidor')
    });
    assert.equal(fs.readdirSync(uploadDir).filter(name => !name.endsWith('.part')).length, 1);

    const memberDeleteServer = await fetch(`${base}/api/servers/${serverId}`, { method: 'DELETE', headers: { authorization: `Bearer ${memberToken}` } });
    assert.equal(memberDeleteServer.status, 403);
    const serverDeletedEvent = waitEvent(ownerWs, 'server.deleted');
    const ownerDeleteServer = await fetch(`${base}/api/servers/${serverId}`, { method: 'DELETE', headers: { authorization: `Bearer ${ownerToken}` } });
    assert.equal(ownerDeleteServer.status, 200);
    assert.equal((await serverDeletedEvent).serverId, serverId);
    assert.equal(fs.readdirSync(uploadDir).filter(name => !name.endsWith('.part')).length, 0);
    const bootstrap: any = await (await fetch(`${base}/api/bootstrap`)).json();
    assert.equal(bootstrap.servers.some((item: any) => item.id === serverId), false);
    ownerWs.close();
  } finally {
    await stopServer(child);
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('pré-Fase 6.1: TXT é indexado/pesquisável e preview usa URL temporária sem navegar a aplicação', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'verdant-index-preview-'));
  const dataDir = path.join(temp, 'data');
  const logDir = path.join(temp, 'logs');
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = startServer(port, dataDir, logDir);
  try {
    await waitHealth(base, child);
    const created: any = await (await fetch(`${base}/api/servers`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Índice TXT', ownerName: 'Dono' })
    })).json();
    const serverId = created.server.id as string;
    const token = created.session.token as string;
    const channelId = created.channels.find((item: any) => item.type === 'text').id as string;
    const text = Buffer.from('Relatório Verdant\nA palavra rara é jabuticaba-azul.\nFim.\n', 'utf8');

    const uploadResponse = await fetch(`${base}/api/channels/${channelId}/files?name=${encodeURIComponent('relatorio.txt')}`, {
      method: 'POST', headers: { authorization: `Bearer ${token}` }, body: text
    });
    assert.equal(uploadResponse.status, 201);
    const upload: any = await uploadResponse.json();
    assert.match(upload.file.mime, /^text\/plain/);

    const searchResponse = await fetch(`${base}/api/servers/${serverId}/files/search?q=${encodeURIComponent('jabuticaba-azul')}`, {
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(searchResponse.status, 200);
    const search: any = await searchResponse.json();
    assert.equal(search.files.length, 1);
    assert.equal(search.files[0].id, upload.file.id);
    assert.match(search.files[0].excerpt, /jabuticaba-azul/i);

    const previewGrantResponse = await fetch(`${base}/api/files/${upload.file.id}/preview-grant`, {
      method: 'POST', headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(previewGrantResponse.status, 200);
    const previewGrant: any = await previewGrantResponse.json();
    const preview = await fetch(`${base}${previewGrant.url}`);
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get('content-disposition') ?? '', /^inline;/i);
    assert.equal(await preview.text(), text.toString('utf8'));

    const reused = await fetch(`${base}${previewGrant.url}`);
    assert.equal(reused.status, 200);
    assert.equal(await reused.text(), text.toString('utf8'));
  } finally {
    await stopServer(child);
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
