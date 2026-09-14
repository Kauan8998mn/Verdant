import type { VoiceAudioPreferences } from './voice-audio-preferences.js';

export interface MicrophoneDiagnostic {
  inputLevelDb: number;
  noiseFloorDb: number;
  thresholdDb: number;
  gateOpen: boolean;
  transient: boolean;
  attenuationDb: number;
}

export interface MicrophonePipeline {
  outputTrack: MediaStreamTrack;
  update(preferences: VoiceAudioPreferences): void;
  dispose(): Promise<void>;
}

export function needsAudioWorklet(preferences: VoiceAudioPreferences): boolean {
  return preferences.voiceDetection || preferences.noiseSuppression;
}

export function nativeMicrophoneConstraints(preferences: VoiceAudioPreferences, deviceId?: string): MediaTrackConstraints {
  const useNativeSuppression = preferences.noiseSuppression && preferences.suppressorModel === 'standard';
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    echoCancellation: true,
    noiseSuppression: useNativeSuppression,
    autoGainControl: preferences.suppressorModel === 'standard',
    channelCount: 1
  };
}

export async function applyNativeProcessingConstraints(track: MediaStreamTrack, preferences: VoiceAudioPreferences): Promise<void> {
  const supported = navigator.mediaDevices?.getSupportedConstraints?.() ?? {};
  const constraints: MediaTrackConstraints = { channelCount: 1 };
  if (supported.echoCancellation) constraints.echoCancellation = true;
  if (supported.noiseSuppression) constraints.noiseSuppression = preferences.noiseSuppression && preferences.suppressorModel === 'standard';
  if (supported.autoGainControl) constraints.autoGainControl = preferences.suppressorModel === 'standard';
  try { await track.applyConstraints(constraints); } catch {
    // Alguns dispositivos/Chromium não permitem reaplicar todos os constraints em uma track viva.
  }
}

export async function createMicrophonePipeline(
  sourceTrack: MediaStreamTrack,
  preferences: VoiceAudioPreferences,
  onDiagnostic?: (diagnostic: MicrophoneDiagnostic) => void
): Promise<MicrophonePipeline> {
  if (!needsAudioWorklet(preferences)) {
    return {
      outputTrack: sourceTrack,
      update() {},
      async dispose() {}
    };
  }

  if (typeof AudioContext !== 'function') {
    throw new Error('Este Chromium não disponibilizou AudioContext para o processamento do microfone.');
  }

  const context = new AudioContext({ latencyHint: 'interactive' });
  if (!context.audioWorklet) {
    await context.close().catch(() => {});
    throw new Error('Este Chromium não disponibilizou AudioWorklet para o processamento do microfone.');
  }
  await context.audioWorklet.addModule('/audio/verdant-noise-worklet.js');
  const sourceStream = new MediaStream([sourceTrack]);
  const source = context.createMediaStreamSource(sourceStream);
  const node = new AudioWorkletNode(context, 'verdant-noise-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    channelCount: 1,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers'
  });
  const destination = context.createMediaStreamDestination();
  const outputTrack = destination.stream.getAudioTracks()[0];
  if (!outputTrack) {
    await context.close();
    throw new Error('Não foi possível criar a faixa de áudio processada.');
  }

  source.connect(node);
  node.connect(destination);
  node.port.onmessage = event => {
    const data = event.data as Partial<MicrophoneDiagnostic> | undefined;
    if (!data || typeof data.inputLevelDb !== 'number') return;
    onDiagnostic?.({
      inputLevelDb: data.inputLevelDb,
      noiseFloorDb: Number(data.noiseFloorDb ?? -60),
      thresholdDb: Number(data.thresholdDb ?? -42),
      gateOpen: Boolean(data.gateOpen),
      transient: Boolean(data.transient),
      attenuationDb: Number(data.attenuationDb ?? 0)
    });
  };

  const update = (next: VoiceAudioPreferences) => node.port.postMessage({ type: 'config', preferences: next });
  update(preferences);
  if (context.state === 'suspended') await context.resume().catch(() => {});

  return {
    outputTrack,
    update,
    async dispose() {
      node.port.onmessage = null;
      try { source.disconnect(); } catch {}
      try { node.disconnect(); } catch {}
      try { destination.disconnect(); } catch {}
      try { outputTrack.stop(); } catch {}
      if (context.state !== 'closed') await context.close().catch(() => {});
    }
  };
}
