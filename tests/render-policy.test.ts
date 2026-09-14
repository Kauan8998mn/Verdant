import test from 'node:test';
import assert from 'node:assert/strict';
import { mainRenderSignature } from '../client/src/render-policy.ts';
import type { State } from '../client/src/state.ts';

function makeState(): State {
  return {
    server: { id: 's1', name: 'Servidor', description: '', inviteCode: 'ABC123', createdAt: new Date(0).toISOString() },
    session: { token: 'token', serverId: 's1', displayName: 'Uriel', role: 'owner' },
    channels: [
      { id: 'text-1', serverId: 's1', name: 'geral', type: 'text', position: 0 },
      { id: 'voice-1', serverId: 's1', name: 'Geral', type: 'voice', position: 1 }
    ],
    activeChannel: { id: 'text-1', serverId: 's1', name: 'geral', type: 'text', position: 0 },
    messages: [],
    presence: [],
    typing: new Set(),
    wsStatus: 'connected',
    rtt: 20,
    voice: {
      status: 'connected',
      joinedChannelId: 'voice-1',
      muted: false,
      deafened: false,
      adminMuted: false,
      members: [],
      speaking: new Set(),
      inputDevices: [],
      outputDevices: []
    }
  };
}

test('composer de texto não é recriado por atualizações contínuas da chamada', () => {
  const state = makeState();
  const before = mainRenderSignature(state);
  state.voice.speaking = new Set(['Amigo']);
  state.voice.mediaRtt = 31;
  state.voice.transportState = 'recv: connected';
  state.voice.members = [{ displayName: 'Amigo', channelId: 'voice-1', role: 'member', selfMuted: false, deafened: false, adminMuted: false }];
  const after = mainRenderSignature(state);
  assert.equal(after, before);
});

test('composer de texto não é recriado por typing nem por chegada de mensagem', () => {
  const state = makeState();
  const before = mainRenderSignature(state);
  state.typing.add('Amigo');
  const typing = mainRenderSignature(state);
  assert.equal(typing, before);
  state.messages.push({ id: 'm1', channelId: 'text-1', authorName: 'Amigo', authorRole: 'member', content: 'oi', createdAt: new Date(0).toISOString() });
  const message = mainRenderSignature(state);
  assert.equal(message, typing);
});

test('painel de voz não é recriado por speaker/RTT/estado transitório de transporte', () => {
  const state = makeState();
  state.activeChannel = state.channels[1];
  const before = mainRenderSignature(state);
  state.voice.speaking.add('Amigo');
  state.voice.mediaRtt = 41;
  state.voice.transportState = 'send: connected';
  state.rtt = 55;
  const after = mainRenderSignature(state);
  assert.equal(after, before);
});

test('painel de voz ainda rerenderiza quando o estado estrutural muda', () => {
  const state = makeState();
  state.activeChannel = state.channels[1];
  const before = mainRenderSignature(state);
  state.voice.muted = true;
  const afterMute = mainRenderSignature(state);
  assert.notEqual(afterMute, before);

  state.voice.muted = false;
  state.voice.members = [{ displayName: 'Amigo', channelId: 'voice-1', role: 'member', selfMuted: false, deafened: false, adminMuted: false }];
  const afterMember = mainRenderSignature(state);
  assert.notEqual(afterMember, before);
});
