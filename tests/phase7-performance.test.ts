import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { channelsRenderSignature, membersRenderSignature, railRenderSignature } from '../client/src/render-policy.ts';
import { screenVideoMode } from '../client/src/screen-multistream.ts';
import type { State } from '../client/src/state.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name: string) => fs.readFileSync(path.join(root, name), 'utf8');

function makeState(): State {
  return {
    bootstrap: {
      servers: [{ id: 's1', name: 'Servidor', description: '', inviteCode: 'ABC', createdAt: new Date(0).toISOString() }],
      addresses: [], secureTransport: true, mediaSecureContextRequired: true,
      media: { enabled: true, listenAddresses: [] }, participantLimit: 6
    },
    server: { id: 's1', name: 'Servidor', description: '', inviteCode: 'ABC', createdAt: new Date(0).toISOString() },
    session: { token: 'token', serverId: 's1', displayName: 'Uriel', role: 'owner' },
    channels: [{ id: 'voice-1', serverId: 's1', name: 'Geral', type: 'voice', position: 0 }],
    activeChannel: { id: 'voice-1', serverId: 's1', name: 'Geral', type: 'voice', position: 0 },
    messages: [], presence: [{ displayName: 'Uriel', role: 'owner', connected: true }], typing: new Set(),
    wsStatus: 'connected',
    voice: {
      status: 'connected', joinedChannelId: 'voice-1', muted: false, deafened: false, adminMuted: false,
      members: [{ displayName: 'Uriel', channelId: 'voice-1', role: 'owner', selfMuted: false, deafened: false, adminMuted: false }],
      speaking: new Set(), inputDevices: [], outputDevices: [],
      screen: { status: 'idle', resolution: '720p', fps: 30, includeAudio: true, sourcePreference: 'any', bitrateKbps: 0, localActive: false, remotes: [], allAudioMuted: false }
    }
  };
}

test('Fase 7: speaking não reconstrói rail/sidebar; patch pontual cuida da classe', () => {
  const state = makeState();
  const railBefore = railRenderSignature(state);
  const channelsBefore = channelsRenderSignature(state, 1);
  const membersBefore = membersRenderSignature(state, 1);
  state.voice.speaking.add('Uriel');
  assert.equal(railRenderSignature(state), railBefore);
  assert.equal(channelsRenderSignature(state, 1), channelsBefore);
  assert.equal(membersRenderSignature(state, 1), membersBefore);

  state.voice.muted = true;
  assert.notEqual(channelsRenderSignature(state, 1), channelsBefore);
});

test('Fase 7: voice-ui saiu do main.ts e main ficou abaixo da linha de base da Fase 6', () => {
  const main = read('client/src/main.ts');
  const voiceUi = read('client/src/voice-ui.ts');
  assert.doesNotMatch(main, /function renderVoicePanel\(/);
  assert.match(main, /from '\.\/voice-ui\.js'/);
  assert.match(voiceUi, /export function renderVoicePanel/);
  assert.match(voiceUi, /export function patchVoiceDynamicState/);
  assert.ok(main.split(/\r?\n/).length < 2700);
});

test('Fase 7: múltiplas telas em grade não baixam vídeo remoto sem foco', () => {
  assert.equal(screenVideoMode({ shareId: 'a', remoteVideoCount: 2, totalVideoCount: 2 }), 'paused');
  assert.equal(screenVideoMode({ shareId: 'a', focusedShareId: 'a', remoteVideoCount: 2, totalVideoCount: 2 }), 'high');
  assert.equal(screenVideoMode({ shareId: 'b', focusedShareId: 'a', remoteVideoCount: 2, totalVideoCount: 2 }), 'paused');
});

test('Fase 7: política de Consumer evita sinalização repetida e mantém áudio separado', () => {
  const voice = read('client/src/voice.ts');
  assert.match(voice, /appliedVideoMode/);
  assert.match(voice, /audioConsumerPaused/);
  assert.match(voice, /needsServerResume/);
  assert.match(voice, /remoteScreenListsEqual/);
  assert.match(voice, /consumer\.pause/);
  assert.match(voice, /consumer\.resume/);
});

test('Fase 7: servidor limita explosão de screen shares por canal', () => {
  const media = read('server/src/media.ts');
  assert.match(media, /MAX_SCREEN_SHARES_PER_CHANNEL = 4/);
  assert.match(media, /SCREEN_LIMIT_REACHED/);
  assert.match(media, /#countActiveScreenVideos/);
});
