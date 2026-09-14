export const MAX_REMOTE_VOLUME_PERCENT = 200;

export interface RemoteBoostHandle {
  track: MediaStreamTrack;
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
  limiter: DynamicsCompressorNode;
  destination: MediaStreamAudioDestinationNode;
}

export function clampRemoteVolumePercent(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.max(0, Math.min(MAX_REMOTE_VOLUME_PERCENT, Math.round(value)));
}

export function remoteVolumeGain(volumePercent: number): number {
  return clampRemoteVolumePercent(volumePercent) / 100;
}

export function remoteVolumeDb(volumePercent: number): number {
  const gain = remoteVolumeGain(volumePercent);
  if (gain <= 0) return Number.NEGATIVE_INFINITY;
  return 20 * Math.log10(gain);
}

export function formatRemoteVolumeLabel(volumePercent: number): string {
  const value = clampRemoteVolumePercent(volumePercent);
  if (value <= 100) return `${value}%`;
  return `${value}% · +${remoteVolumeDb(value).toFixed(1)} dB`;
}

export function needsRemoteBoost(volumePercent: number): boolean {
  return clampRemoteVolumePercent(volumePercent) > 100;
}

/**
 * Caminho de reprodução REMOTO e isolado.
 *
 * Regras de segurança:
 * - nunca recebe a track do microfone local;
 * - clona a track recebida do Consumer antes do Web Audio;
 * - só é necessário acima de 100%;
 * - 0–100% continua usando HTMLAudioElement.volume diretamente;
 * - o limiter evita picos excessivos ao aplicar até +6.02 dB.
 */
export class RemotePlaybackBoostManager {
  #context?: AudioContext;
  #handles = new Set<RemoteBoostHandle>();

  async create(track: MediaStreamTrack, volumePercent: number): Promise<RemoteBoostHandle | undefined> {
    if (!needsRemoteBoost(volumePercent) || track.kind !== 'audio' || track.readyState === 'ended') return undefined;

    const context = await this.#getRunningContext();
    if (!context) return undefined;

    const clonedTrack = track.clone();
    try {
      const source = context.createMediaStreamSource(new MediaStream([clonedTrack]));
      const gain = context.createGain();
      const limiter = context.createDynamicsCompressor();
      const destination = context.createMediaStreamDestination();

      // Até 200% = ganho linear 2.0 ~= +6.02 dB.
      gain.gain.value = remoteVolumeGain(volumePercent);

      // Limiter leve para que o boost não transforme picos em clipping brutal.
      limiter.threshold.value = -2;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.08;

      source.connect(gain);
      gain.connect(limiter);
      limiter.connect(destination);

      const handle: RemoteBoostHandle = { track: clonedTrack, source, gain, limiter, destination };
      this.#handles.add(handle);
      return handle;
    } catch {
      clonedTrack.stop();
      return undefined;
    }
  }

  update(handle: RemoteBoostHandle, volumePercent: number): void {
    const context = this.#context;
    if (!context) return;
    const value = remoteVolumeGain(volumePercent);
    try {
      handle.gain.gain.setTargetAtTime(value, context.currentTime, 0.012);
    } catch {
      handle.gain.gain.value = value;
    }
  }

  dispose(handle: RemoteBoostHandle | undefined): void {
    if (!handle) return;
    this.#handles.delete(handle);
    try { handle.source.disconnect(); } catch {}
    try { handle.gain.disconnect(); } catch {}
    try { handle.limiter.disconnect(); } catch {}
    try { handle.destination.disconnect(); } catch {}
    try { handle.track.stop(); } catch {}
  }

  async resume(): Promise<boolean> {
    const context = this.#context;
    if (!context) return false;
    if (context.state === 'running') return true;
    try { await context.resume(); } catch {}
    return String(context.state) === 'running';
  }

  async close(): Promise<void> {
    for (const handle of [...this.#handles]) this.dispose(handle);
    const context = this.#context;
    this.#context = undefined;
    if (context && context.state !== 'closed') {
      try { await context.close(); } catch {}
    }
  }

  async #getRunningContext(): Promise<AudioContext | undefined> {
    try {
      const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
      if (!Ctx) return undefined;
      this.#context ??= new Ctx({ latencyHint: 'interactive' });
      if (this.#context.state === 'suspended') {
        try { await this.#context.resume(); } catch {}
      }
      return this.#context.state === 'running' ? this.#context : undefined;
    } catch {
      return undefined;
    }
  }
}
