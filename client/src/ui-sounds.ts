export type UiSoundEvent = 'messageReceived' | 'voiceLeave' | 'serverLeave' | 'screenStart' | 'screenStop';
export type UiSoundId = 'message-click' | 'message-dog' | 'participant-leave' | 'screen-start' | 'screen-stop';

export interface UiSoundEventPreference {
  enabled: boolean;
  soundId: UiSoundId;
  volume: number;
}

export interface UiSoundPreferences {
  enabled: boolean;
  masterVolume: number;
  events: Record<UiSoundEvent, UiSoundEventPreference>;
}

export interface UiSoundDefinition {
  id: UiSoundId;
  label: string;
  url: string;
}

const STORAGE_KEY = 'verdant.ui-sounds.v1';

export const UI_SOUND_LIBRARY: Record<UiSoundId, UiSoundDefinition> = {
  'message-click': { id: 'message-click', label: 'Click suave (padrão)', url: '/sounds/message/clicksoundeffect.mp3' },
  'message-dog': { id: 'message-dog', label: 'Clicker alternativo', url: '/sounds/message/dog-clicker.mp3' },
  'participant-leave': { id: 'participant-leave', label: 'Saída do participante', url: '/sounds/participant-leave/enter-da-game.mp3' },
  'screen-start': { id: 'screen-start', label: 'Início de transmissão', url: '/sounds/screen-start/steam-deck-enter-game.mp3' },
  'screen-stop': { id: 'screen-stop', label: 'Fim de transmissão', url: '/sounds/screen-stop/switch-sound.mp3' }
};

export const DEFAULT_UI_SOUND_PREFERENCES: UiSoundPreferences = {
  enabled: true,
  masterVolume: 70,
  events: {
    messageReceived: { enabled: true, soundId: 'message-click', volume: 70 },
    voiceLeave: { enabled: true, soundId: 'participant-leave', volume: 70 },
    serverLeave: { enabled: true, soundId: 'participant-leave', volume: 70 },
    screenStart: { enabled: true, soundId: 'screen-start', volume: 70 },
    screenStop: { enabled: true, soundId: 'screen-stop', volume: 70 }
  }
};

export const EVENT_SOUND_OPTIONS: Record<UiSoundEvent, UiSoundId[]> = {
  messageReceived: ['message-click', 'message-dog'],
  voiceLeave: ['participant-leave'],
  serverLeave: ['participant-leave'],
  screenStart: ['screen-start'],
  screenStop: ['screen-stop']
};

export function loadUiSoundPreferences(): UiSoundPreferences {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return cloneDefaults();
    return sanitizeUiSoundPreferences(JSON.parse(raw));
  } catch {
    return cloneDefaults();
  }
}

export function saveUiSoundPreferences(preferences: UiSoundPreferences): UiSoundPreferences {
  const sanitized = sanitizeUiSoundPreferences(preferences);
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized)); } catch {}
  return sanitized;
}

export function resetUiSoundPreferences(): UiSoundPreferences {
  try { if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY); } catch {}
  return cloneDefaults();
}

export function sanitizeUiSoundPreferences(input: Partial<UiSoundPreferences> | undefined): UiSoundPreferences {
  const defaults = cloneDefaults();
  const sourceEvents = input?.events ?? {} as Partial<Record<UiSoundEvent, Partial<UiSoundEventPreference>>>;
  const events = {} as Record<UiSoundEvent, UiSoundEventPreference>;
  for (const event of Object.keys(defaults.events) as UiSoundEvent[]) {
    const fallback = defaults.events[event];
    const candidate = sourceEvents[event];
    const allowed = EVENT_SOUND_OPTIONS[event];
    const requestedSound = candidate?.soundId;
    events[event] = {
      enabled: typeof candidate?.enabled === 'boolean' ? candidate.enabled : fallback.enabled,
      soundId: requestedSound && allowed.includes(requestedSound) ? requestedSound : fallback.soundId,
      volume: clampPercent(candidate?.volume ?? fallback.volume)
    };
  }
  return {
    enabled: typeof input?.enabled === 'boolean' ? input.enabled : defaults.enabled,
    masterVolume: clampPercent(input?.masterVolume ?? defaults.masterVolume),
    events
  };
}

export class UiSoundController {
  #preferences: UiSoundPreferences;

  constructor(preferences = loadUiSoundPreferences()) {
    this.#preferences = preferences;
  }

  get preferences(): UiSoundPreferences { return this.#preferences; }

  setPreferences(preferences: UiSoundPreferences): UiSoundPreferences {
    this.#preferences = saveUiSoundPreferences(preferences);
    return this.#preferences;
  }

  reset(): UiSoundPreferences {
    this.#preferences = resetUiSoundPreferences();
    return this.#preferences;
  }

  play(event: UiSoundEvent): void {
    const preference = this.#preferences.events[event];
    if (!this.#preferences.enabled || !preference.enabled) return;
    this.#playDefinition(preference.soundId, this.#effectiveVolume(preference.volume));
  }

  preview(event: UiSoundEvent): void {
    const preference = this.#preferences.events[event];
    this.#playDefinition(preference.soundId, this.#effectiveVolume(preference.volume));
  }

  #effectiveVolume(eventVolume: number): number {
    return clamp01((this.#preferences.masterVolume / 100) * (eventVolume / 100));
  }

  #playDefinition(soundId: UiSoundId, volume: number): void {
    if (typeof Audio === 'undefined') return;
    const definition = UI_SOUND_LIBRARY[soundId];
    const audio = new Audio(definition.url);
    audio.preload = 'auto';
    audio.volume = clamp01(volume);
    void audio.play().catch(() => {});
  }
}

function cloneDefaults(): UiSoundPreferences {
  return {
    enabled: DEFAULT_UI_SOUND_PREFERENCES.enabled,
    masterVolume: DEFAULT_UI_SOUND_PREFERENCES.masterVolume,
    events: {
      messageReceived: { ...DEFAULT_UI_SOUND_PREFERENCES.events.messageReceived },
      voiceLeave: { ...DEFAULT_UI_SOUND_PREFERENCES.events.voiceLeave },
      serverLeave: { ...DEFAULT_UI_SOUND_PREFERENCES.events.serverLeave },
      screenStart: { ...DEFAULT_UI_SOUND_PREFERENCES.events.screenStart },
      screenStop: { ...DEFAULT_UI_SOUND_PREFERENCES.events.screenStop }
    }
  };
}

function clampPercent(value: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 70;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
