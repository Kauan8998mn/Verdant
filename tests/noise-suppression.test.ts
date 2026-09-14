import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { DEFAULT_VOICE_AUDIO_PREFERENCES, sanitizeVoiceAudioPreferences } from '../client/src/voice-audio-preferences.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadProcessor(): any {
  const source = fs.readFileSync(path.join(root, 'client/public/audio/verdant-noise-worklet.js'), 'utf8');
  let Processor: any;
  class AudioWorkletProcessorStub {
    port = { onmessage: null as ((event: any) => void) | null, postMessage(_data: unknown) {} };
  }
  vm.runInNewContext(source, {
    AudioWorkletProcessor: AudioWorkletProcessorStub,
    registerProcessor: (_name: string, ctor: any) => { Processor = ctor; },
    sampleRate: 48000,
    Float32Array,
    Math,
    Number
  });
  assert.ok(Processor, 'worklet deve registrar o processador');
  return new Processor();
}

function configure(processor: any, model: 'standard' | 'verdant', level: 'low' | 'medium' | 'high' | 'maximum' = 'maximum'): void {
  processor.port.onmessage?.({
    data: {
      type: 'config',
      preferences: {
        noiseSuppression: true,
        suppressorModel: model,
        suppressionLevel: level,
        voiceDetection: true,
        voiceDetectionMode: 'auto',
        manualThresholdDb: -42
      }
    }
  });
}

function run(processor: any, input: Float32Array): Float32Array {
  const output = new Float32Array(input.length);
  assert.equal(processor.process([[input]], [[output]]), true);
  return output;
}

function rms(values: Float32Array): number {
  let sum = 0;
  for (const value of values) sum += value * value;
  return Math.sqrt(sum / Math.max(1, values.length));
}

function randomNoise(seedRef: { value: number }, amplitude: number): Float32Array {
  const result = new Float32Array(128);
  for (let i = 0; i < result.length; i += 1) {
    seedRef.value = (1664525 * seedRef.value + 1013904223) >>> 0;
    const unit = seedRef.value / 0xffffffff;
    result[i] = (unit * 2 - 1) * amplitude;
  }
  return result;
}

test('preferências de áudio têm padrão leve e sanitização limitada', () => {
  assert.equal(DEFAULT_VOICE_AUDIO_PREFERENCES.suppressorModel, 'standard');
  assert.equal(DEFAULT_VOICE_AUDIO_PREFERENCES.noiseSuppression, true);
  assert.equal(DEFAULT_VOICE_AUDIO_PREFERENCES.voiceDetectionMode, 'auto');
  assert.equal(sanitizeVoiceAudioPreferences({ manualThresholdDb: -999 }).manualThresholdDb, -60);
  assert.equal(sanitizeVoiceAudioPreferences({ manualThresholdDb: 10 }).manualThresholdDb, -20);
});

test('Verdant DSP reduz ruído contínuo agressivamente sem esmagar fala tonal', () => {
  const noiseProcessor = loadProcessor();
  configure(noiseProcessor, 'verdant', 'maximum');
  const seed = { value: 0xdecafbad };
  let inputNoise = 0;
  let outputNoise = 0;
  let samples = 0;
  for (let block = 0; block < 420; block += 1) {
    const input = randomNoise(seed, 0.02);
    const output = run(noiseProcessor, input);
    if (block > 260) {
      inputNoise += rms(input);
      outputNoise += rms(output);
      samples += 1;
    }
  }
  assert.ok(outputNoise / inputNoise < 0.03, `ruído residual alto: ${outputNoise / inputNoise}`);
  assert.ok(noiseProcessor.noiseFloorDb > -50, 'estimador deve aprender um piso de ruído constante');

  const voiceProcessor = loadProcessor();
  configure(voiceProcessor, 'verdant', 'maximum');
  let phase = 0;
  let inputVoice = 0;
  let outputVoice = 0;
  for (let block = 0; block < 120; block += 1) {
    const input = new Float32Array(128);
    for (let i = 0; i < input.length; i += 1) {
      input[i] = 0.12 * Math.sin(phase);
      phase += 2 * Math.PI * 220 / 48000;
    }
    const output = run(voiceProcessor, input);
    if (block > 25) {
      inputVoice += rms(input);
      outputVoice += rms(output);
    }
  }
  assert.ok(outputVoice / inputVoice > 0.78, `fala foi atenuada demais: ${outputVoice / inputVoice}`);
});

test('transiente isolado de teclado é barrado após calibração de ruído', () => {
  const processor = loadProcessor();
  configure(processor, 'verdant', 'high');
  const seed = { value: 12345 };
  for (let block = 0; block < 260; block += 1) run(processor, randomNoise(seed, 0.008));
  const key = new Float32Array(128);
  key[18] = 0.7;
  key[19] = -0.28;
  const out = run(processor, key);
  assert.ok(rms(out) / rms(key) < 0.2, 'transiente isolado deve ser fortemente reduzido');
});

test('integração mantém screen-audio fora do processamento do microfone', () => {
  const voice = fs.readFileSync(path.join(root, 'client/src/voice.ts'), 'utf8');
  const processing = fs.readFileSync(path.join(root, 'client/src/microphone-processing.ts'), 'utf8');
  const build = fs.readFileSync(path.join(root, 'scripts/build.mjs'), 'utf8');
  assert.match(voice, /nativeMicrophoneConstraints\(this\.#audioPreferences/);
  assert.match(voice, /codecOptions: \{ opusDtx: true, opusFec: true \}/);
  assert.match(voice, /screen-audio/);
  assert.match(processing, /AudioWorkletNode/);
  assert.match(build, /publicAudio/);
});

test('modelo padrão pede NS/AGC nativos e modelo Verdant desativa NS nativo para evitar dupla supressão', async () => {
  const { nativeMicrophoneConstraints } = await import('../client/src/microphone-processing.ts');
  const standard = nativeMicrophoneConstraints({ ...DEFAULT_VOICE_AUDIO_PREFERENCES, suppressorModel: 'standard' });
  const verdant = nativeMicrophoneConstraints({ ...DEFAULT_VOICE_AUDIO_PREFERENCES, suppressorModel: 'verdant' });
  assert.equal(standard.noiseSuppression, true);
  assert.equal(standard.autoGainControl, true);
  assert.equal(verdant.noiseSuppression, false);
  assert.equal(verdant.autoGainControl, false);
  assert.equal(verdant.echoCancellation, true);
});

test('detecção manual respeita o limite configurado', () => {
  const quiet = new Float32Array(128);
  let phase = 0;
  for (let i = 0; i < quiet.length; i += 1) {
    quiet[i] = 0.01 * Math.sin(phase);
    phase += 2 * Math.PI * 220 / 48000;
  }

  const strict = loadProcessor();
  strict.port.onmessage?.({ data: { type: 'config', preferences: {
    noiseSuppression: false, suppressorModel: 'standard', suppressionLevel: 'medium',
    voiceDetection: true, voiceDetectionMode: 'manual', manualThresholdDb: -30
  } } });
  for (let i = 0; i < 80; i += 1) run(strict, quiet);
  const strictOut = run(strict, quiet);

  const sensitive = loadProcessor();
  sensitive.port.onmessage?.({ data: { type: 'config', preferences: {
    noiseSuppression: false, suppressorModel: 'standard', suppressionLevel: 'medium',
    voiceDetection: true, voiceDetectionMode: 'manual', manualThresholdDb: -50
  } } });
  for (let i = 0; i < 80; i += 1) run(sensitive, quiet);
  const sensitiveOut = run(sensitive, quiet);

  assert.ok(rms(strictOut) < rms(quiet) * 0.08, 'limite estrito deve manter a porta fechada');
  assert.ok(rms(sensitiveOut) > rms(quiet) * 0.55, 'limite sensível deve abrir para fala baixa');
});
