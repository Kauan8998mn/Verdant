import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppDatabase } from '../server/src/database.ts';

test('SQLite persiste servidor, canais e histórico após reabrir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verdant-db-'));
  let db = new AppDatabase(dir);
  const server = db.createServer('Teste');
  assert.equal(server.inviteCode.length, 6);
  const channels = db.listChannels(server.id);
  const text = channels.find(channel => channel.type === 'text');
  assert.ok(text);
  db.addMessage({
    serverId: server.id,
    channelId: text.id,
    authorName: 'Uriel',
    authorRole: 'owner',
    content: 'mensagem persistente',
    kind: 'user'
  });
  db.close();

  db = new AppDatabase(dir);
  assert.equal(db.listServers()[0]?.name, 'Teste');
  assert.equal(db.getServerByInvite(server.inviteCode)?.id, server.id);
  const messages = db.listMessages(text.id);
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.content, 'mensagem persistente');
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});


test('pré-Fase 6: exclusão de mensagem e servidor é persistente e em cascata', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verdant-delete-'));
  const db = new AppDatabase(dir);
  const server = db.createServer('Apagar');
  const text = db.listChannels(server.id).find(channel => channel.type === 'text')!;
  const message = db.addMessage({ serverId: server.id, channelId: text.id, authorName: 'Dono', authorRole: 'owner', content: 'remover', kind: 'user' });
  assert.equal(db.getMessage(message.id)?.content, 'remover');
  assert.equal(db.deleteMessage(message.id).deleted, true);
  assert.equal(db.getMessage(message.id), undefined);
  assert.equal(db.deleteServer(server.id), true);
  assert.equal(db.getServer(server.id), undefined);
  assert.equal(db.listChannels(server.id).length, 0);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
