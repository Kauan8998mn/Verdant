import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name: string) => fs.readFileSync(path.join(root, name), 'utf8');
const sha = (name: string) => createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex');

test('Fase 6: servidor não mantém mais o guard de uma única tela por canal', () => {
  const media = read('server/src/media.ts');
  assert.doesNotMatch(media, /SCREEN_ALREADY_ACTIVE/);
  assert.doesNotMatch(media, /#activeScreenProducer/);
  assert.match(media, /consumer\.quality/);
  assert.match(media, /setPreferredLayers/);
  assert.match(media, /setPriority/);
});

test('Fase 6: cliente mantém múltiplas telas por shareId', () => {
  const voice = read('client/src/voice.ts');
  assert.match(voice, /#screenRemotes = new Map<string, RemoteScreenMedia>/);
  assert.match(voice, /focusScreen\(shareId\?: string\)/);
  assert.match(voice, /muteAllScreenAudio/);
  assert.match(voice, /setScreenAudioMuted/);
  assert.match(voice, /#applyScreenSubscriptionPolicy/);
  assert.match(voice, /consumer\.quality/);
});

test('Fase 6: compartilhamento usa simulcast Chromium e streamId por share', () => {
  const voice = read('client/src/voice.ts');
  const policy = read('client/src/screen-multistream.ts');
  assert.match(voice, /buildScreenSimulcastEncodings\(maxBitrateKbps, config\.fps\)/);
  assert.match(voice, /streamId: shareId/);
  assert.match(voice, /consumeOptions\.streamId = `screen-\$\{data\.appData\.shareId\}`/);
  assert.match(policy, /scaleResolutionDownBy: 4/);
  assert.match(policy, /scaleResolutionDownBy: 2/);
  assert.match(policy, /scaleResolutionDownBy: 1/);
});

test('Fase 6: UI de mídia foi extraída de main.ts e possui grid/foco/mutes', () => {
  const main = read('client/src/main.ts');
  const ui = read('client/src/screen-ui.ts');
  assert.match(main, /from '\.\/screen-ui\.js'/);
  assert.doesNotMatch(main, /function renderScreenStage\(/);
  assert.match(ui, /screen-grid/);
  assert.match(ui, /Voltar para grade/);
  assert.match(ui, /Silenciar transmissões/);
  assert.match(ui, /setScreenAudioMuted/);
});

test('Fase 6: módulos sensíveis de microfone/boost permanecem byte a byte', () => {
  assert.equal(sha('client/src/microphone-processing.ts'), 'ed22ccf3c9792491c896b54b82406164a73404f5e8b8c42750cb73686f6db234');
  assert.equal(sha('client/src/remote-playback-boost.ts'), 'c2ab1bfababfa5caee7aa431b1dc7b0519e027fe0b6224c27b6a9702881ffdc0');
  assert.equal(sha('client/src/voice-audio-preferences.ts'), 'dab0a2a8db948b46351202c5797ceee5ed672b9a36a6d8b7e48fdfa002c1205e');
  assert.equal(sha('client/public/audio/verdant-noise-worklet.js'), 'aac371dd4bb4eb3dd588fcbe929dd1d4973097b6b8fedc15efdd9d5998e3f411');
});
