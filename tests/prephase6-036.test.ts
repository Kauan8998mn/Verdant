import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mainRenderSignature } from '../client/src/render-policy.ts';
import { DEFAULT_CLIENT_PREFERENCES } from '../client/src/client-preferences.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function baseState(): any {
  return {
    server: { id: 'srv' },
    session: { token: 'tok', displayName: 'Uriel' },
    channels: [],
    activeChannel: { id: 'chat', name: 'geral', type: 'text' },
    messages: [],
    presence: [],
    typing: new Set<string>(),
    wsStatus: 'connected',
    voice: { members: [], screen: {} }
  };
}

test('0.3.6: eventos de digitando não recriam o painel principal', () => {
  const a = baseState();
  const b = baseState();
  b.typing.add('Gean');
  assert.equal(mainRenderSignature(a), mainRenderSignature(b));
});

test('0.3.6: indicador de digitando é atualizado pontualmente no DOM', () => {
  const main = fs.readFileSync(path.join(root, 'client/src/main.ts'), 'utf8');
  assert.match(main, /patchTypingIndicator\(typing\)/);
  assert.match(main, /if \(state\.activeChannel\?\.type === 'text'\)/);
});

test('0.3.6: engrenagem fica no mesmo grupo do botão de transmissão', () => {
  const main = fs.readFileSync(path.join(root, 'client/src/main.ts'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'client/public/styles.css'), 'utf8');
  assert.match(main, /stripActions\.append\(mic, deafen, screen, settings\)/);
  assert.match(css, /\.user-strip-actions \{ display: flex/);
});

test('0.3.6: imagem anexada é carregada automaticamente sem exigir clique', () => {
  const main = fs.readFileSync(path.join(root, 'client/src/main.ts'), 'utf8');
  const block = main.slice(main.indexOf('async function addInlineAttachmentImage'), main.indexOf('async function openFilePreview'));
  assert.match(block, /host\.prepend\(image\)/);
  assert.match(block, /image\.src = grant\.url/);
  assert.doesNotMatch(block, /if \(!session \|\| !host\.isConnected\) return/);
});

test('0.3.6: Ctrl+V aceita arquivos do clipboard e texto puro continua nativo', () => {
  const main = fs.readFileSync(path.join(root, 'client/src/main.ts'), 'utf8');
  assert.match(main, /area\.addEventListener\('paste'/);
  assert.match(main, /filesFromClipboard\(event\.clipboardData\)/);
  assert.match(main, /if \(!files\.length\) return/);
  assert.match(main, /stageAttachments\(channelId, files\)/);
  assert.match(main, /window\.confirm/);
});

test('0.3.6: upload usa identificador idempotente e uma única repetição de rede', () => {
  const api = fs.readFileSync(path.join(root, 'client/src/api.ts'), 'utf8');
  const routes = fs.readFileSync(path.join(root, 'server/src/routes.ts'), 'utf8');
  const db = fs.readFileSync(path.join(root, 'server/src/database.ts'), 'utf8');
  assert.match(api, /uploadId/);
  assert.match(api, /return sendAttempt\(0\)\.catch/);
  assert.match(routes, /getFileByClientUploadId/);
  assert.match(db, /idx_files_server_client_upload/);
});

test('0.3.8: preferências reaplicadas ficam restritas a aparência/privacidade', () => {
  assert.equal(DEFAULT_CLIENT_PREFERENCES.backgroundColor, '#08100f');
  assert.equal(DEFAULT_CLIENT_PREFERENCES.externalMediaPreviews, false);
  assert.equal('speakingGlowColor' in DEFAULT_CLIENT_PREFERENCES, false);
  assert.equal('messageSound' in DEFAULT_CLIENT_PREFERENCES, false);
});

test('0.3.6: criar servidor possui botão explícito para fechar', () => {
  const main = fs.readFileSync(path.join(root, 'client/src/main.ts'), 'utf8');
  const block = main.slice(main.indexOf('function renderEntryDialog'), main.indexOf('function openChannelDialog'));
  assert.match(block, /entry-dialog-head/);
  assert.match(block, /close\.addEventListener\('click'/);
});
