import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  MAX_REMOTE_VOLUME_PERCENT,
  clampRemoteVolumePercent,
  formatRemoteVolumeLabel,
  needsRemoteBoost,
  remoteVolumeDb,
  remoteVolumeGain
} from '../client/src/remote-playback-boost.ts';

test('volume individual vai até 200% e continua local/persistente', async () => {
  const voice = await readFile(new URL('../client/src/voice.ts', import.meta.url), 'utf8');
  const voiceUi = await readFile(new URL('../client/src/voice-ui.ts', import.meta.url), 'utf8');

  assert.equal(MAX_REMOTE_VOLUME_PERCENT, 200);
  assert.equal(clampRemoteVolumePercent(-10), 0);
  assert.equal(clampRemoteVolumePercent(80.4), 80);
  assert.equal(clampRemoteVolumePercent(250), 200);
  assert.equal(remoteVolumeGain(200), 2);
  assert.ok(Math.abs(remoteVolumeDb(200) - 6.020599913) < 0.000001);
  assert.equal(needsRemoteBoost(100), false);
  assert.equal(needsRemoteBoost(101), true);
  assert.equal(formatRemoteVolumeLabel(150), '150% · +3.5 dB');

  assert.match(voice, /setLocalVolume\(displayName: string, volumePercent: number\)/);
  assert.match(voice, /verdant:voice-volume:/);
  assert.match(voiceUi, /volumeSlider\.max = '200'/);
  assert.match(voiceUi, /acima de 100% usa boost local/);
});

test('0–100% permanece no HTMLAudioElement direto; boost só entra acima de 100%', async () => {
  const voice = await readFile(new URL('../client/src/voice.ts', import.meta.url), 'utf8');
  const boost = await readFile(new URL('../client/src/remote-playback-boost.ts', import.meta.url), 'utf8');
  const mic = await readFile(new URL('../client/src/microphone-processing.ts', import.meta.url), 'utf8');

  assert.match(voice, /audio\.srcObject = new MediaStream\(\[consumer\.track\]\)/);
  assert.match(voice, /if \(!needsRemoteBoost\(value\)\)/);
  assert.match(voice, /item\.audio\.volume = value \/ 100/);
  assert.match(voice, /item\.audio\.volume = 1;/);
  assert.match(voice, /item\.audio\.volume = 0;/);

  // O boost recebe somente uma track remota clonada e nunca captura microfone.
  assert.match(boost, /track\.clone\(\)/);
  assert.doesNotMatch(boost, /getUserMedia|replaceTrack|producer\.|microphone/i);
  assert.doesNotMatch(mic, /remote-playback-boost|RemotePlaybackBoostManager/);
});

test('boost usa limiter e possui fallback para 100% antes de trocar a saída', async () => {
  const voice = await readFile(new URL('../client/src/voice.ts', import.meta.url), 'utf8');
  const boost = await readFile(new URL('../client/src/remote-playback-boost.ts', import.meta.url), 'utf8');

  assert.match(boost, /createDynamicsCompressor\(\)/);
  assert.match(boost, /limiter\.threshold\.value = -2/);
  assert.match(boost, /limiter\.ratio\.value = 20/);

  const applyStart = voice.indexOf('async #applyRemotePlaybackVolume');
  const disposeStart = voice.indexOf('\n  #disposeRemoteBoost', applyStart);
  assert.ok(applyStart >= 0 && disposeStart > applyStart);
  const apply = voice.slice(applyStart, disposeStart);

  const fallbackIndex = apply.indexOf('item.audio.volume = 1;');
  const boostedIndex = apply.lastIndexOf('item.audio.volume = 0;');
  assert.ok(fallbackIndex >= 0 && boostedIndex > fallbackIndex);
  assert.match(apply, /boostedAudio\.play\(\)/);
});
