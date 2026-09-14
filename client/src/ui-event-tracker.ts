import type { State } from './state.js';
import type { UiSoundEvent } from './ui-sounds.js';

export interface UiTrackedEvent {
  event: UiSoundEvent;
  displayName?: string;
}

interface Snapshot {
  joinedChannelId?: string;
  selfName?: string;
  membersInLocalChannel: Set<string>;
  activeScreenKeys: Set<string>;
}

export class UiEventTracker {
  #previous?: Snapshot;

  reset(): void { this.#previous = undefined; }

  observe(state: State): UiTrackedEvent[] {
    const current = snapshot(state);
    const previous = this.#previous;
    this.#previous = current;
    if (!previous) return [];

    const output: UiTrackedEvent[] = [];
    const stayedInSameCall = Boolean(current.joinedChannelId && previous.joinedChannelId === current.joinedChannelId);
    if (!stayedInSameCall) return output;

    for (const name of previous.membersInLocalChannel) {
      if (name === current.selfName) continue;
      if (!current.membersInLocalChannel.has(name)) output.push({ event: 'voiceLeave', displayName: name });
    }

    // Fase 6: cada share possui identidade própria. Assim iniciar/parar uma
    // segunda transmissão não mascara a primeira nem gera um falso stop/start.
    for (const key of previous.activeScreenKeys) {
      if (!current.activeScreenKeys.has(key)) output.push({ event: 'screenStop' });
    }
    for (const key of current.activeScreenKeys) {
      if (!previous.activeScreenKeys.has(key)) output.push({ event: 'screenStart' });
    }
    return output;
  }
}

function snapshot(state: State): Snapshot {
  const joinedChannelId = state.voice.joinedChannelId;
  const membersInLocalChannel = new Set<string>();
  if (joinedChannelId) {
    for (const member of state.voice.members) {
      if (member.channelId === joinedChannelId) membersInLocalChannel.add(member.displayName);
    }
  }
  const activeScreenKeys = new Set<string>();
  if (state.voice.screen.localActive) activeScreenKeys.add(`local:${state.voice.screen.localShareId ?? 'screen'}`);
  for (const remote of state.voice.screen.remotes ?? []) activeScreenKeys.add(`remote:${remote.shareId}`);
  return {
    joinedChannelId,
    selfName: state.session?.displayName,
    membersInLocalChannel,
    activeScreenKeys
  };
}
