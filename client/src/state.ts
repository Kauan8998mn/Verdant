import type { Bootstrap, ChannelInfo, MessageInfo, PresenceInfo, ServerInfo, SessionInfo, VoiceStateInfo } from './types.js';

export interface State {
  bootstrap?: Bootstrap;
  server?: ServerInfo;
  session?: SessionInfo;
  channels: ChannelInfo[];
  activeChannel?: ChannelInfo;
  messages: MessageInfo[];
  presence: PresenceInfo[];
  typing: Set<string>;
  wsStatus: 'offline' | 'connecting' | 'connected' | 'reconnecting';
  rtt?: number;
  voice: VoiceStateInfo;
}

const state: State = {
  channels: [],
  messages: [],
  presence: [],
  typing: new Set(),
  wsStatus: 'offline',
  voice: {
    status: 'idle',
    muted: false,
    deafened: false,
    adminMuted: false,
    members: [],
    speaking: new Set(),
    inputDevices: [],
    outputDevices: [],
    screen: {
      status: 'idle',
      resolution: '720p',
      fps: 30,
      includeAudio: true,
      sourcePreference: 'any',
      bitrateKbps: 0,
      localActive: false,
      remotes: [],
      allAudioMuted: false
    }
  }
};

const listeners = new Set<(state: State) => void>();

export function getState(): State { return state; }

function patchChanges(target: object, patch: object): boolean {
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.is((target as Record<string, unknown>)[key], value)) return true;
  }
  return false;
}

export function updateState(patch: Partial<State>): void {
  if (!patchChanges(state, patch)) return;
  Object.assign(state, patch);
  for (const listener of listeners) listener(state);
}

export function updateVoice(patch: Partial<VoiceStateInfo>): void {
  if (!patchChanges(state.voice, patch)) return;
  Object.assign(state.voice, patch);
  for (const listener of listeners) listener(state);
}

export function updateScreen(patch: Partial<State['voice']['screen']>): void {
  if (!patchChanges(state.voice.screen, patch)) return;
  Object.assign(state.voice.screen, patch);
  for (const listener of listeners) listener(state);
}

export function mutateState(mutator: (state: State) => void): void {
  mutator(state);
  for (const listener of listeners) listener(state);
}

export function subscribe(listener: (state: State) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function appendMessage(message: MessageInfo): void {
  if (state.messages.some(item => item.id === message.id)) return;
  state.messages.push(message);
  if (state.messages.length > 300) state.messages.splice(0, state.messages.length - 300);
  for (const listener of listeners) listener(state);
}
export function removeMessage(messageId: string): void {
  const index = state.messages.findIndex(item => item.id === messageId);
  if (index < 0) return;
  state.messages.splice(index, 1);
  for (const listener of listeners) listener(state);
}

export function updateMessage(message: MessageInfo): void {
  const index = state.messages.findIndex(item => item.id === message.id);
  if (index < 0) {
    appendMessage(message);
    return;
  }
  state.messages[index] = message;
  for (const item of state.messages) {
    if (item.replyTo?.id !== message.id) continue;
    item.replyTo = {
      id: message.id,
      authorName: message.authorName,
      content: message.content,
      ...(message.attachment ? { attachmentName: message.attachment.originalName } : {})
    };
  }
  for (const listener of listeners) listener(state);
}

