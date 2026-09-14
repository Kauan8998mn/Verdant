export type ScreenVideoMode = 'paused' | 'low' | 'high';

export interface ScreenPolicyInput {
  shareId: string;
  focusedShareId?: string;
  remoteVideoCount: number;
  totalVideoCount?: number;
}

/**
 * Fase 7 bandwidth-first policy:
 * - uma única transmissão pode tocar em alta sem exigir interação extra;
 * - com 2+ transmissões na grade, vídeo remoto fica sob demanda (pausado);
 * - ao focar, apenas a transmissão focada recebe vídeo em alta;
 * - áudio da screen share é controlado separadamente e não depende desta regra.
 *
 * O modo `low` continua disponível para fallback/adaptação futura, mas a grade
 * multi-stream padrão prioriza banda/CPU acima de previews animados.
 */
export function screenVideoMode(input: ScreenPolicyInput): ScreenVideoMode {
  const { shareId, focusedShareId, remoteVideoCount } = input;
  if (focusedShareId) return focusedShareId === shareId ? 'high' : 'paused';
  const totalVideoCount = Math.max(remoteVideoCount, input.totalVideoCount ?? remoteVideoCount);
  return totalVideoCount <= 1 ? 'high' : 'paused';
}

export function spatialLayerForMode(mode: ScreenVideoMode): number | undefined {
  if (mode === 'low') return 0;
  if (mode === 'high') return 2;
  return undefined;
}

export function priorityForMode(mode: ScreenVideoMode): number {
  if (mode === 'high') return 8;
  if (mode === 'low') return 2;
  return 1;
}

export function clampSpatialLayer(value: unknown): 0 | 1 | 2 {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  if (parsed >= 2) return 2;
  if (parsed >= 1) return 1;
  return 0;
}

export function buildScreenSimulcastEncodings(maxBitrateKbps: number, fps: number): Array<Record<string, number | string>> {
  const high = Math.max(300, Math.round(maxBitrateKbps || 2500));
  const middle = Math.max(180, Math.round(high * 0.55));
  const low = Math.max(120, Math.round(high * 0.25));
  const frameRate = Math.max(15, Math.min(60, Math.round(fps || 30)));
  return [
    { scaleResolutionDownBy: 4, maxBitrate: low * 1000, maxFramerate: Math.min(15, frameRate), scalabilityMode: 'L1T3' },
    { scaleResolutionDownBy: 2, maxBitrate: middle * 1000, maxFramerate: Math.min(30, frameRate), scalabilityMode: 'L1T3' },
    { scaleResolutionDownBy: 1, maxBitrate: high * 1000, maxFramerate: frameRate, scalabilityMode: 'L1T3' }
  ];
}
