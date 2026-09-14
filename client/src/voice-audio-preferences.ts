export type NoiseSuppressorModel = 'standard' | 'verdant';
export type NoiseSuppressionLevel = 'low' | 'medium' | 'high' | 'maximum';
export type VoiceDetectionMode = 'auto' | 'manual';

export interface VoiceAudioPreferences {
  noiseSuppression: boolean;
  suppressorModel: NoiseSuppressorModel;
  suppressionLevel: NoiseSuppressionLevel;
  voiceDetection: boolean;
  voiceDetectionMode: VoiceDetectionMode;
  manualThresholdDb: number;
}

const STORAGE_KEY = 'verdant.voice.audio.preferences.v1';

export const DEFAULT_VOICE_AUDIO_PREFERENCES: VoiceAudioPreferences = {
  noiseSuppression: true,
  suppressorModel: 'standard',
  suppressionLevel: 'medium',
  voiceDetection: true,
  voiceDetectionMode: 'auto',
  manualThresholdDb: -42
};

export function loadVoiceAudioPreferences(): VoiceAudioPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_VOICE_AUDIO_PREFERENCES };
    return sanitizeVoiceAudioPreferences(JSON.parse(raw) as Partial<VoiceAudioPreferences>);
  } catch {
    return { ...DEFAULT_VOICE_AUDIO_PREFERENCES };
  }
}

export function saveVoiceAudioPreferences(input: VoiceAudioPreferences): VoiceAudioPreferences {
  const value = sanitizeVoiceAudioPreferences(input);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  return value;
}

export function resetVoiceAudioPreferences(): VoiceAudioPreferences {
  localStorage.removeItem(STORAGE_KEY);
  return { ...DEFAULT_VOICE_AUDIO_PREFERENCES };
}

export function sanitizeVoiceAudioPreferences(input: Partial<VoiceAudioPreferences>): VoiceAudioPreferences {
  return {
    noiseSuppression: input.noiseSuppression ?? DEFAULT_VOICE_AUDIO_PREFERENCES.noiseSuppression,
    suppressorModel: input.suppressorModel === 'verdant' ? 'verdant' : 'standard',
    suppressionLevel: normalizeLevel(input.suppressionLevel),
    voiceDetection: input.voiceDetection ?? DEFAULT_VOICE_AUDIO_PREFERENCES.voiceDetection,
    voiceDetectionMode: input.voiceDetectionMode === 'manual' ? 'manual' : 'auto',
    manualThresholdDb: clamp(Number(input.manualThresholdDb ?? DEFAULT_VOICE_AUDIO_PREFERENCES.manualThresholdDb), -60, -20)
  };
}

export function suppressionLevelLabel(level: NoiseSuppressionLevel): string {
  return ({ low: 'Baixo', medium: 'Médio', high: 'Alto', maximum: 'Máximo' })[level];
}

function normalizeLevel(value: unknown): NoiseSuppressionLevel {
  return value === 'low' || value === 'high' || value === 'maximum' ? value : 'medium';
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
