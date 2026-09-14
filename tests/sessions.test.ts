import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppDatabase } from '../server/src/database.ts';
import { SessionError, SessionManager } from '../server/src/sessions.ts';

test('sessões exigem nome único por servidor e limitam a seis participantes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verdant-sessions-'));
  const db = new AppDatabase(dir);
  const server = db.createServer('Sala');
  const sessions = new SessionManager(db);
  sessions.createOwnerSession(server.id, 'Uriel');

  assert.throws(() => sessions.join(server.id, 'URIEL'), (error: unknown) => {
    return error instanceof SessionError && error.status === 409;
  });

  for (const name of ['A', 'B', 'C', 'D', 'E']) sessions.join(server.id, name);
  assert.throws(() => sessions.join(server.id, 'F'), (error: unknown) => {
    return error instanceof SessionError && error.status === 429;
  });

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
