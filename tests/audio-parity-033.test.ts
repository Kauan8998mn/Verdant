import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const voice=fs.readFileSync(path.join(root,'client/src/voice.ts'),'utf8');

const forbidden=['setInputGain(', 'setMonitorVolume(', 'getRemoteVolume(', 'setRemoteVolume(', 'toggleMicTest(', 'setScreenAudioDevice('];
test('pré-Fase 6: hotfixes antigos de ganho/monitor/remoto continuam fora do núcleo',()=>{ for(const token of forbidden) assert.equal(voice.includes(token),false,token); });

test('pré-Fase 6: nova intervenção de áudio fica isolada ao microfone',()=>{
  assert.equal(fs.existsSync(path.join(root,'client/src/microphone-processing.ts')),true);
  assert.equal(fs.existsSync(path.join(root,'client/src/voice-audio-preferences.ts')),true);
  const uiSounds=fs.readFileSync(path.join(root,'client/src/ui-sounds.ts'),'utf8');
  assert.doesNotMatch(uiSounds,/getUserMedia|mediasoup|Producer|Consumer|replaceTrack|AudioContext|GainNode|createGain/);
  assert.match(voice,/createMicrophonePipeline/);
  assert.match(voice,/appData: \{ source: 'microphone' \}/);
});
