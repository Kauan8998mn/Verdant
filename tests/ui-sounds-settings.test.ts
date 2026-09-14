import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_UI_SOUND_PREFERENCES, sanitizeUiSoundPreferences, UI_SOUND_LIBRARY } from '../client/src/ui-sounds.ts';
import { UiEventTracker } from '../client/src/ui-event-tracker.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function state(overrides: any = {}): any {
  return {
    server: { id: 'srv' },
    session: { token: 'tok', serverId: 'srv', displayName: 'Uriel', role: 'owner' },
    channels: [], activeChannel: undefined, messages: [], presence: [], typing: new Set(), wsStatus: 'connected',
    voice: {
      status: 'connected', joinedChannelId: 'voice-a', muted: false, deafened: false, adminMuted: false,
      members: [
        { channelId: 'voice-a', displayName: 'Uriel', role: 'owner', selfMuted: false, deafened: false, adminMuted: false },
        { channelId: 'voice-a', displayName: 'Rafael', role: 'member', selfMuted: false, deafened: false, adminMuted: false }
      ],
      speaking: new Set(), inputDevices: [], outputDevices: [],
      screen: { status: 'idle', resolution: '720p', fps: 30, includeAudio: true, sourcePreference: 'any', bitrateKbps: 0, localActive: false, remotes: [], allAudioMuted: false }
    },
    ...overrides
  };
}

test('sons enviados foram integrados como assets locais e o click suave é o padrão de mensagem', () => {
  assert.equal(DEFAULT_UI_SOUND_PREFERENCES.events.messageReceived.soundId, 'message-click');
  assert.equal(UI_SOUND_LIBRARY['message-click'].url, '/sounds/message/clicksoundeffect.mp3');
  assert.equal(UI_SOUND_LIBRARY['message-dog'].url, '/sounds/message/dog-clicker.mp3');
  for (const relative of [
    'client/public/sounds/message/clicksoundeffect.mp3',
    'client/public/sounds/message/dog-clicker.mp3',
    'client/public/sounds/screen-start/steam-deck-enter-game.mp3',
    'client/public/sounds/participant-leave/enter-da-game.mp3',
    'client/public/sounds/screen-stop/switch-sound.mp3'
  ]) assert.ok(fs.statSync(path.join(root, relative)).size > 0, relative);
});

test('preferências de som são sanitizadas e volumes ficam entre 0 e 100', () => {
  const p = sanitizeUiSoundPreferences({ masterVolume: 999, events: { messageReceived: { enabled: true, soundId: 'message-dog', volume: -20 } } as any });
  assert.equal(p.masterVolume, 100);
  assert.equal(p.events.messageReceived.soundId, 'message-dog');
  assert.equal(p.events.messageReceived.volume, 0);
});

test('tracker toca saída apenas quando outro participante deixa a chamada que continua ativa', () => {
  const tracker = new UiEventTracker();
  tracker.observe(state());
  const next = state();
  next.voice.members = next.voice.members.filter((m: any) => m.displayName !== 'Rafael');
  assert.deepEqual(tracker.observe(next), [{ event: 'voiceLeave', displayName: 'Rafael' }]);

  const leavingSelf = state();
  leavingSelf.voice.joinedChannelId = undefined;
  leavingSelf.voice.members = [];
  assert.deepEqual(tracker.observe(leavingSelf), []);
});

test('tracker detecta início e fim de transmissão sem sinal falso ao entrar na chamada', () => {
  const tracker = new UiEventTracker();
  const initial = state();
  initial.voice.screen.remotes = [{ shareId: 'já-estava', displayName: 'Rafael', audio: false, videoPaused: false, audioMuted: false }];
  assert.deepEqual(tracker.observe(initial), []);

  const stopped = state();
  assert.deepEqual(tracker.observe(stopped), [{ event: 'screenStop' }]);

  const started = state();
  started.voice.screen.remotes = [{ shareId: 'nova', displayName: 'Rafael', audio: false, videoPaused: false, audioMuted: false }];
  assert.deepEqual(tracker.observe(started), [{ event: 'screenStart' }]);
});

test('menu novo mantém volume individual e substitui os dois botões globais por um toggle de globo', () => {
  const main = fs.readFileSync(path.join(root, 'client/src/main.ts'), 'utf8');
  const voiceUi = fs.readFileSync(path.join(root, 'client/src/voice-ui.ts'), 'utf8');
  assert.match(voiceUi, /global-voice-toggle/);
  assert.match(voiceUi, /globeIcon\(\)/);
  assert.match(voiceUi, /Ninguém me ouve/);
  assert.match(voiceUi, /Todos me ouvem/);
  assert.doesNotMatch(`${main}\n${voiceUi}`, /Mutar todos para mim/);
  assert.doesNotMatch(`${main}\n${voiceUi}`, /Ouvir todos/);
  assert.match(voiceUi, /voice\.getLocalVolume\(member\.displayName\)/);
});

test('efeitos de interface não modificam o pipeline de voz', () => {
  const voice = fs.readFileSync(path.join(root, 'client/src/voice.ts'), 'utf8');
  const sounds = fs.readFileSync(path.join(root, 'client/src/ui-sounds.ts'), 'utf8');
  assert.doesNotMatch(sounds, /getUserMedia|RTCPeerConnection|mediasoup|Producer|Consumer|replaceTrack|createGain|GainNode|AudioContext/);
  assert.match(voice, /codecOptions: \{ opusDtx: true, opusFec: true \}/);
});

test('build publica os MP3 e o servidor entrega MIME de áudio correto', () => {
  const build = fs.readFileSync(path.join(root, 'scripts/build.mjs'), 'utf8');
  const staticFiles = fs.readFileSync(path.join(root, 'server/src/static-files.ts'), 'utf8');
  assert.match(build, /publicSounds/);
  assert.match(build, /recursive: true/);
  assert.match(staticFiles, /'\.mp3': 'audio\/mpeg'/);
});

test('Fase 6: tracker trata transmissões simultâneas independentemente', () => {
  const tracker = new UiEventTracker();
  const initial = state();
  initial.voice.screen.remotes = [{ shareId: 'a', displayName: 'Rafael', audio: false, videoPaused: false, audioMuted: false }];
  assert.deepEqual(tracker.observe(initial), []);

  const two = state();
  two.voice.screen.remotes = [
    { shareId: 'a', displayName: 'Rafael', audio: false, videoPaused: false, audioMuted: false },
    { shareId: 'b', displayName: 'Gean', audio: false, videoPaused: false, audioMuted: false }
  ];
  assert.deepEqual(tracker.observe(two), [{ event: 'screenStart' }]);

  const one = state();
  one.voice.screen.remotes = [{ shareId: 'b', displayName: 'Gean', audio: false, videoPaused: false, audioMuted: false }];
  assert.deepEqual(tracker.observe(one), [{ event: 'screenStop' }]);
});
