import { api, ApiError, uploadFile } from './api.js';
import { appendMessage, getState, mutateState, removeMessage, subscribe, updateMessage, updateState } from './state.js';
import type { ChannelInfo, IndexedFileInfo, MemberProfileInfo, MessageInfo, PresenceInfo, ServerInfo, SessionInfo, VoiceMemberInfo } from './types.js';
import { RealtimeClient } from './ws.js';
import { VoiceController } from './voice.js';
import { isMemberScreenSharing } from './screen-ui.js';
import { channelsRenderSignature, mainRenderSignature, membersRenderSignature, railRenderSignature } from './render-policy.js';
import { patchVoiceDynamicState, renderVoicePanel } from './voice-ui.js';
import { isMessageScrollPinned, nextMessageScrollTop, type MessageScrollSnapshot } from './chat-scroll.js';
import { createBackgroundDownloadFrame, navigateBackgroundDownload } from './download.js';
import { isPanelNearBottom, nextPanelScrollTop, type PanelScrollSnapshot } from './panel-scroll.js';
import { applyClientPreferences, loadClientPreferences, resetClientPreferences, saveClientPreferences, type ClientPreferences } from './client-preferences.js';
import { EVENT_SOUND_OPTIONS, UI_SOUND_LIBRARY, UiSoundController, loadUiSoundPreferences, type UiSoundEvent, type UiSoundPreferences } from './ui-sounds.js';
import { UiEventTracker } from './ui-event-tracker.js';
import { collectClipboardFiles } from './clipboard-files.js';
import { loadVoiceAudioPreferences, resetVoiceAudioPreferences, sanitizeVoiceAudioPreferences, saveVoiceAudioPreferences, suppressionLevelLabel, type NoiseSuppressionLevel, type NoiseSuppressorModel, type VoiceAudioPreferences, type VoiceDetectionMode } from './voice-audio-preferences.js';

const rail = must<HTMLElement>('#server-rail');
const channelsEl = must<HTMLElement>('#channel-sidebar');
const mainEl = must<HTMLElement>('#main-panel');
const membersEl = must<HTMLElement>('#member-sidebar');
const entryDialog = must<HTMLDialogElement>('#entry-dialog');
const channelDialog = must<HTMLDialogElement>('#channel-dialog');
const settingsDialog = must<HTMLDialogElement>('#settings-dialog');
const filesDialog = must<HTMLDialogElement>('#files-dialog');
const filePreviewDialog = must<HTMLDialogElement>('#file-preview-dialog');
const toasts = must<HTMLElement>('#toasts');
const realtime = new RealtimeClient();
const voiceRealtime = new RealtimeClient('voice');
const voice = new VoiceController(voiceRealtime, toast);

let entryTargetServer: ServerInfo | undefined;
let entryMode: 'join' | 'create' = 'join';
let typingTimer: number | undefined;
let scrollPinned = true;
let renderQueued = false;
let lastMainRenderSignature = '';
let lastRailRenderSignature = '';
let lastChannelsRenderSignature = '';
let lastMembersRenderSignature = '';
let profileRenderRevision = 0;
const chatDrafts = new Map<string, string>();
const pendingAttachments = new Map<string, File[]>();
const replyDrafts = new Map<string, MessageInfo>();
const editDrafts = new Map<string, MessageInfo>();
const sendingAttachmentBatches = new Set<string>();
const activeUploads = new Set<string>();
let clientPreferences: ClientPreferences = loadClientPreferences();
applyClientPreferences(clientPreferences);
let uiSoundPreferences: UiSoundPreferences = loadUiSoundPreferences();
const uiSounds = new UiSoundController(uiSoundPreferences);
let voiceAudioPreferences: VoiceAudioPreferences = loadVoiceAudioPreferences();
const uiEventTracker = new UiEventTracker();
type SettingsPage = 'profile' | 'general' | 'audio' | 'notifications' | 'appearance';
let settingsPage: SettingsPage = 'general';
let knownPresence = new Map<string, PresenceInfo>();
const pendingServerLeaveSounds = new Map<string, number>();
const recentExitSounds = new Map<string, number>();
let memberProfiles = new Map<string, MemberProfileInfo>();

const THEME_PRESETS: ReadonlyArray<{ name: string; color: string }> = [
  { name: 'Verdant', color: '#08100f' },
  { name: 'Obsidiana', color: '#000000' },
  { name: 'Neve', color: '#ffffff' },
  { name: 'Violeta', color: '#5b2a86' },
  { name: 'Rosa', color: '#ff8fc7' },
  { name: 'Oceano', color: '#0a3142' },
  { name: 'Âmbar', color: '#4a2f08' },
  { name: 'Grafite', color: '#202528' }
];

const SPEAKING_PRESETS: ReadonlyArray<{ name: string; color: string }> = [
  { name: 'Menta', color: '#91d4c7' },
  { name: 'Ciano', color: '#59d9ff' },
  { name: 'Azul', color: '#6699ff' },
  { name: 'Violeta', color: '#b788ff' },
  { name: 'Rosa', color: '#ff79bd' },
  { name: 'Laranja', color: '#ffad66' },
  { name: 'Verde', color: '#72e68f' },
  { name: 'Branco', color: '#f4f7f6' }
];

realtime.onServerStateChanged = () => { void refreshChannels(); void refreshProfiles(); };
realtime.onServerDeleted = serverId => void handleDeletedServer(serverId);
realtime.onSystem = text => toast(text);
realtime.onError = message => toast(message, true);
realtime.onChatMessage = message => {
  const self = getState().session?.displayName;
  if (message.kind === 'user' && message.authorName !== self) uiSounds.play('messageReceived');
};
realtime.onPresenceChanged = (members, initial) => handlePresenceForSounds(members, initial);
subscribe(state => {
  for (const event of uiEventTracker.observe(state)) {
    if (event.event === 'voiceLeave') playExitSound('voiceLeave', event.displayName);
    else uiSounds.play(event.event);
  }
  scheduleRender();
});

void initialize();

function handlePresenceForSounds(members: PresenceInfo[], initial: boolean): void {
  const current = new Map<string, PresenceInfo>();
  for (const member of members) current.set(soundTrackingName(member.displayName), member);

  if (initial || knownPresence.size === 0) {
    for (const timer of pendingServerLeaveSounds.values()) window.clearTimeout(timer);
    pendingServerLeaveSounds.clear();
    knownPresence = current;
    return;
  }

  const self = soundTrackingName(getState().session?.displayName ?? '');
  for (const [key, previous] of knownPresence) {
    if (!previous.connected || key === self) continue;
    const next = current.get(key);
    if (next?.connected) continue;
    if (pendingServerLeaveSounds.has(key)) continue;
    const timer = window.setTimeout(() => {
      pendingServerLeaveSounds.delete(key);
      const latest = knownPresence.get(key);
      if (latest?.connected) return;
      playExitSound('serverLeave', previous.displayName);
    }, 1800);
    pendingServerLeaveSounds.set(key, timer);
  }

  for (const [key, member] of current) {
    if (!member.connected) continue;
    const pending = pendingServerLeaveSounds.get(key);
    if (pending !== undefined) window.clearTimeout(pending);
    pendingServerLeaveSounds.delete(key);
  }
  knownPresence = current;
}

function playExitSound(event: 'voiceLeave' | 'serverLeave', displayName?: string): void {
  const key = soundTrackingName(displayName ?? event);
  const now = Date.now();
  const last = recentExitSounds.get(key) ?? 0;
  if (now - last < 2500) return;
  recentExitSounds.set(key, now);
  uiSounds.play(event);
}

function resetUiNotificationTracking(): void {
  uiEventTracker.reset();
  knownPresence = new Map();
  recentExitSounds.clear();
  for (const timer of pendingServerLeaveSounds.values()) window.clearTimeout(timer);
  pendingServerLeaveSounds.clear();
}

function soundTrackingName(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('pt-BR');
}

async function initialize(): Promise<void> {
  try {
    const bootstrap = await api.bootstrap();
    updateState({ bootstrap });
    scheduleRender();

    const invite = new URLSearchParams(location.search).get('invite');
    if (invite) {
      try {
        const resolved = await api.resolveInvite(invite);
        entryTargetServer = bootstrap.servers.find(server => server.id === resolved.server.id)
          ?? { ...resolved.server, createdAt: new Date(0).toISOString() };
        openEntryDialog('join', entryTargetServer);
        return;
      } catch (error) {
        toast(errorMessage(error), true);
      }
    }

    const remembered = bootstrap.servers.find(server => localStorage.getItem(sessionStorageKey(server.id)));
    if (remembered) {
      const ok = await tryResume(remembered);
      if (ok) return;
    }

    if (bootstrap.servers.length === 0) openEntryDialog('create');
    else renderLanding();
  } catch (error) {
    renderFatal(errorMessage(error));
  }
}

async function tryResume(server: ServerInfo): Promise<boolean> {
  const stored = readStoredSession(server.id);
  if (!stored) return false;
  try {
    const result = await api.joinServer(server.id, stored.displayName, stored.token);
    activateServer(result.server, result.channels, result.session);
    return true;
  } catch {
    localStorage.removeItem(sessionStorageKey(server.id));
    return false;
  }
}

function activateServer(server: ServerInfo, channels: ChannelInfo[], session: SessionInfo): void {
  resetUiNotificationTracking();
  localStorage.setItem(sessionStorageKey(server.id), JSON.stringify({ token: session.token, displayName: session.displayName }));
  const firstText = channels.find(channel => channel.type === 'text');
  updateState({
    server,
    session,
    channels,
    activeChannel: firstText,
    messages: [],
    presence: [],
    typing: new Set()
  });
  memberProfiles = new Map();
  profileRenderRevision += 1;
  lastMainRenderSignature = '';
  lastChannelsRenderSignature = '';
  lastMembersRenderSignature = '';
  realtime.start(session.token);
  void refreshProfiles();
  entryDialog.close();
  if (firstText) void selectChannel(firstText);
}

async function selectServer(server: ServerInfo): Promise<void> {
  if (getState().server?.id === server.id) return;
  resetUiNotificationTracking();
  memberProfiles = new Map();
  profileRenderRevision += 1;
  lastMainRenderSignature = '';
  lastChannelsRenderSignature = '';
  lastMembersRenderSignature = '';
  realtime.stop();
  if (await tryResume(server)) return;
  openEntryDialog('join', server);
}

async function selectChannel(channel: ChannelInfo): Promise<void> {
  const previous = getState().activeChannel;
  if (previous?.type === 'text' && previous.id !== channel.id) {
    realtime.setTyping(previous.id, false);
    if (typingTimer) window.clearTimeout(typingTimer);
    typingTimer = undefined;
  }
  if (previous?.id !== channel.id) scrollPinned = true;
  updateState({ activeChannel: channel, messages: [], typing: new Set() });
  if (channel.type !== 'text') return;
  try {
    const { messages } = await api.messages(channel.id);
    updateState({ messages });
    requestAnimationFrame(() => scrollMessagesToBottom());
  } catch (error) {
    toast(errorMessage(error), true);
  }
}

async function refreshChannels(): Promise<void> {
  const state = getState();
  if (!state.server) return;
  try {
    const result = await api.channels(state.server.id);
    const active = state.activeChannel ? result.channels.find(item => item.id === state.activeChannel!.id) : undefined;
    updateState({ channels: result.channels, activeChannel: active ?? result.channels.find(item => item.type === 'text') });
  } catch (error) {
    toast(errorMessage(error), true);
  }
}

async function refreshProfiles(): Promise<void> {
  const state = getState();
  if (!state.server || !state.session) return;
  try {
    const result = await api.profiles(state.server.id, state.session.token);
    const next = new Map<string, MemberProfileInfo>();
    for (const profile of result.profiles) next.set(profileKey(profile.displayName), profile);
    if (profileMapsEqual(memberProfiles, next)) return;
    memberProfiles = next;
    profileRenderRevision += 1;
    lastMainRenderSignature = '';
    lastChannelsRenderSignature = '';
    lastMembersRenderSignature = '';
    scheduleRender();
    if (settingsDialog.open && settingsPage === 'profile') renderSettingsDialog();
  } catch (error) {
    toast(errorMessage(error), true);
  }
}

function profileMapsEqual(a: Map<string, MemberProfileInfo>, b: Map<string, MemberProfileInfo>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, profile] of a) {
    const other = b.get(key);
    if (!other || other.avatarDataUrl !== profile.avatarDataUrl || other.displayName !== profile.displayName || other.updatedAt !== profile.updatedAt) return false;
  }
  return true;
}

function profileKey(displayName: string): string {
  return displayName.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
}

function renderAvatar(displayName: string, className: string): HTMLElement {
  const avatar = el('div', className, initials(displayName));
  const profile = memberProfiles.get(profileKey(displayName));
  if (!profile?.avatarDataUrl) return avatar;
  const image = document.createElement('img');
  image.src = profile.avatarDataUrl;
  image.alt = '';
  image.loading = 'lazy';
  image.decoding = 'async';
  image.addEventListener('error', () => image.remove(), { once: true });
  avatar.append(image);
  return avatar;
}

function scheduleRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

function render(): void {
  const state = getState();

  const railSignature = railRenderSignature(state);
  if (railSignature !== lastRailRenderSignature) {
    lastRailRenderSignature = railSignature;
    renderRail();
  }

  const channelsSignature = channelsRenderSignature(state, profileRenderRevision);
  if (channelsSignature !== lastChannelsRenderSignature) {
    lastChannelsRenderSignature = channelsSignature;
    renderChannels();
  }
  patchChannelDynamicState();

  const signature = mainRenderSignature(state);
  if (signature !== lastMainRenderSignature) {
    lastMainRenderSignature = signature;
    renderMain();
  }
  patchMainDynamicState();

  const membersSignature = membersRenderSignature(state, profileRenderRevision);
  if (membersSignature !== lastMembersRenderSignature) {
    lastMembersRenderSignature = membersSignature;
    renderMembers();
  }
}

function renderRail(): void {
  const { bootstrap, server } = getState();
  rail.replaceChildren();

  const brand = el('div', 'brand', 'V');
  brand.title = 'Verdant LAN';
  rail.append(brand, el('div', 'rail-separator'));

  for (const item of bootstrap?.servers ?? []) {
    const button = el('button', `server-button${server?.id === item.id ? ' active' : ''}`, initials(item.name));
    button.type = 'button';
    button.title = item.name;
    button.setAttribute('aria-label', `Abrir servidor ${item.name}`);
    button.addEventListener('click', () => void selectServer(item));
    rail.append(button);
  }

  const add = el('button', 'server-add', '+');
  add.type = 'button';
  add.title = 'Criar servidor';
  add.setAttribute('aria-label', 'Criar servidor');
  add.addEventListener('click', () => openEntryDialog('create'));
  rail.append(add);
}

function renderChannels(): void {
  const previousScrollTop = channelsEl.querySelector<HTMLElement>('.channel-scroll')?.scrollTop ?? 0;
  const { server, session, channels, activeChannel } = getState();
  channelsEl.replaceChildren();
  if (!server || !session) {
    const header = el('div', 'server-header');
    header.append(el('div', 'server-title', 'Verdant LAN'));
    channelsEl.append(header, el('div', 'channel-scroll'));
    return;
  }

  const header = el('div', 'server-header');
  header.append(el('div', 'server-title', server.name));
  const headerActions = el('div', 'server-header-actions');
  const inviteButton = el('button', 'icon-button', '↗');
  inviteButton.type = 'button';
  inviteButton.title = `Copiar convite ${server.inviteCode}`;
  inviteButton.setAttribute('aria-label', 'Copiar convite');
  inviteButton.addEventListener('click', () => void copyInvite(server));
  headerActions.append(inviteButton);
  if (session.role === 'owner') {
    const removeServer = el('button', 'icon-button owner-danger-action', '×');
    removeServer.type = 'button';
    removeServer.title = 'Excluir servidor';
    removeServer.setAttribute('aria-label', `Excluir servidor ${server.name}`);
    removeServer.addEventListener('click', () => void deleteCurrentServer());
    headerActions.append(removeServer);
  }
  header.append(headerActions);

  const scroll = el('div', 'channel-scroll');
  scroll.append(channelGroup('Canais de texto', channels.filter(c => c.type === 'text'), activeChannel, '#'));
  scroll.append(channelGroup('Canais de voz', channels.filter(c => c.type === 'voice'), activeChannel, '◖'));

  const strip = el('div', 'user-strip');
  strip.append(renderAvatar(session.displayName, 'user-strip-avatar'));
  const userMeta = el('div', 'user-meta');
  userMeta.append(el('div', 'user-name', session.displayName), el('div', 'user-role', roleLabel(session.role)));
  strip.append(userMeta);

  const mic = el('button', `icon-button call-control${getState().voice.muted || getState().voice.adminMuted ? ' active danger' : ''}`, getState().voice.muted || getState().voice.adminMuted ? '⌁' : '🎙');
  mic.type = 'button';
  mic.title = getState().voice.adminMuted ? 'Microfone silenciado por moderador' : getState().voice.muted ? 'Ativar microfone' : 'Desativar microfone';
  mic.setAttribute('aria-label', mic.title);
  mic.disabled = !voice.isJoined;
  mic.addEventListener('click', () => void voice.resumePlayback().then(() => voice.toggleMute()));

  const deafen = el('button', `icon-button call-control${getState().voice.deafened ? ' active danger' : ''}`, getState().voice.deafened ? '◉' : '🎧');
  deafen.type = 'button';
  deafen.title = getState().voice.deafened ? 'Desativar ensurdecer' : 'Ensurdecer';
  deafen.setAttribute('aria-label', deafen.title);
  deafen.disabled = !voice.isJoined;
  deafen.addEventListener('click', () => void voice.resumePlayback().then(() => voice.toggleDeafen()));

  const sharing = getState().voice.screen.localActive;
  const screen = el('button', `icon-button call-control${sharing ? ' active danger' : ''}`, sharing ? '■' : '▣');
  screen.type = 'button';
  screen.title = sharing ? 'Parar compartilhamento de tela' : 'Compartilhar tela';
  screen.setAttribute('aria-label', screen.title);
  screen.disabled = !voice.isJoined || getState().voice.screen.status === 'starting';
  screen.addEventListener('click', () => {
    if (voice.isScreenSharing) void voice.stopScreenShare();
    else void voice.startScreenShare().catch(() => {});
  });

  const settings = el('button', 'icon-button call-control', '⚙');
  settings.type = 'button';
  settings.title = 'Configurações deste cliente';
  settings.setAttribute('aria-label', settings.title);
  settings.addEventListener('click', () => void openSettingsDialog());

  const stripActions = el('div', 'user-strip-actions');
  stripActions.append(mic, deafen, screen, settings);
  strip.append(stripActions);

  channelsEl.append(header, scroll, strip);
  scroll.scrollTop = Math.min(previousScrollTop, Math.max(0, scroll.scrollHeight - scroll.clientHeight));
}

function patchChannelDynamicState(): void {
  const speaking = getState().voice.speaking;
  for (const member of channelsEl.querySelectorAll<HTMLElement>('.voice-channel-member[data-member-name]')) {
    const displayName = member.dataset.memberName;
    if (!displayName) continue;
    member.classList.toggle('speaking', speaking.has(displayName));
  }
}

function channelGroup(title: string, items: ChannelInfo[], active: ChannelInfo | undefined, icon: string): HTMLElement {
  const group = el('section', 'channel-group');
  const groupTitle = el('div', 'channel-group-title');
  groupTitle.append(el('span', '', title));

  const state = getState();
  if (state.session && (state.session.role === 'owner' || state.session.role === 'moderator')) {
    const add = el('button', 'icon-button', '+');
    add.type = 'button';
    add.title = `Criar ${items[0]?.type === 'voice' || title.includes('voz') ? 'canal de voz' : 'canal de texto'}`;
    add.setAttribute('aria-label', add.title);
    add.addEventListener('click', () => openChannelDialog(title.includes('voz') ? 'voice' : 'text'));
    groupTitle.append(add);
  }
  group.append(groupTitle);

  const isVoiceGroup = title.includes('voz');
  for (const item of items) {
    const row = el('button', `channel-row${active?.id === item.id ? ' active' : ''}${state.voice.joinedChannelId === item.id ? ' joined' : ''}`);
    row.type = 'button';
    row.append(el('span', 'channel-icon', icon), el('span', '', item.name));
    if (isVoiceGroup) {
      const count = state.voice.members.filter(member => member.channelId === item.id).length;
      if (count) row.append(el('span', 'channel-count', `${count}/6`));
    }
    row.addEventListener('click', () => void selectChannel(item));
    if (state.session?.role === 'owner') {
      const rowWrap = el('div', 'channel-row-wrap');
      const remove = el('button', 'channel-delete-button', '×');
      remove.type = 'button';
      remove.title = `Excluir canal ${item.name}`;
      remove.setAttribute('aria-label', remove.title);
      remove.addEventListener('click', event => {
        event.stopPropagation();
        void deleteChannel(item);
      });
      rowWrap.append(row, remove);
      group.append(rowWrap);
    } else {
      group.append(row);
    }

    if (isVoiceGroup) {
      for (const member of state.voice.members.filter(member => member.channelId === item.id)) {
        const sub = el('div', `voice-channel-member${state.voice.speaking.has(member.displayName) ? ' speaking' : ''}`);
        sub.dataset.memberName = member.displayName;
        sub.append(renderAvatar(member.displayName, 'voice-mini-avatar'));
        const label = el('span', 'voice-mini-name', member.displayName);
        const flags = el('span', 'voice-mini-flags');
        if (member.selfMuted || member.adminMuted) flags.append(el('span', '', '⌁'));
        if (member.deafened) flags.append(el('span', '', '◉'));
        if (isMemberScreenSharing(member.displayName)) flags.append(el('span', '', '▣'));
        sub.append(label, flags);
        group.append(sub);
      }
    }
  }
  return group;
}

function renderMain(): void {
  const previousComposer = captureComposerState();
  const previousMessages = captureMessageScrollState();
  const previousVoiceScroll = captureVoiceScrollState();
  const state = getState();
  if (!state.server || !state.session) {
    renderLanding();
    return;
  }

  mainEl.replaceChildren();
  const header = el('header', 'main-header');
  const heading = el('div', 'main-heading');
  heading.append(el('span', '', state.activeChannel?.type === 'voice' ? '◖' : '#'), el('h1', '', state.activeChannel?.name ?? 'Selecione um canal'));
  const headerRight = el('div', 'main-header-right');
  if (state.activeChannel?.type === 'text') {
    const files = el('button', 'secondary-button header-files-button', 'Arquivos');
    files.type = 'button';
    files.title = 'Pesquisar arquivos e conteúdo de arquivos TXT deste servidor';
    files.addEventListener('click', () => void openFilesDialog());
    headerRight.append(files);
  }
  headerRight.append(renderConnectionStatus());
  header.append(heading, headerRight);
  mainEl.append(header);

  if (!state.activeChannel) {
    const empty = el('div', 'empty-state');
    empty.append(cardText('Nenhum canal disponível', 'Crie um canal para começar.'));
    mainEl.append(empty);
    return;
  }

  if (state.activeChannel.type === 'voice') {
    const panel = renderVoicePanel(state.activeChannel, voice, { renderAvatar });
    mainEl.append(panel);
    restoreVoiceScrollState(panel, previousVoiceScroll, state.activeChannel.id);
    return;
  }

  const layout = el('section', 'chat-layout');
  const messages = el('div', 'messages');
  messages.id = 'messages';
  messages.dataset.channelId = state.activeChannel.id;
  messages.dataset.renderSignature = messageListSignature(state.messages);
  messages.addEventListener('scroll', () => {
    scrollPinned = isMessageScrollPinned(messages.scrollHeight, messages.scrollTop, messages.clientHeight);
  });

  if (state.messages.length === 0) {
    const empty = el('div', 'empty-state');
    empty.append(cardText(`Bem-vindo a #${state.activeChannel.name}`, 'Este é o começo do histórico deste canal. As mensagens são armazenadas localmente no PC host.'));
    messages.append(empty);
  } else {
    for (const message of state.messages) messages.append(renderMessage(message));
  }

  const typing = el('div', 'typing');
  typing.dataset.channelId = state.activeChannel.id;
  patchTypingIndicator(typing);

  const channelId = state.activeChannel.id;
  const composerRegion = el('div', 'composer-region');
  const composerContext = renderComposerContext(channelId);
  if (composerContext) composerRegion.append(composerContext);

  const editing = editDrafts.get(channelId);
  const composer = el('form', 'composer');
  const attach = el('button', 'secondary-button attach-button', '+');
  attach.type = 'button';
  attach.title = editing ? 'Finalize ou cancele a edição antes de anexar arquivos' : 'Adicionar arquivo (máx. 500 MB)';
  attach.setAttribute('aria-label', attach.title);
  attach.disabled = state.wsStatus !== 'connected' || Boolean(editing) || sendingAttachmentBatches.has(channelId);
  attach.addEventListener('click', () => chooseFileForUpload(channelId));

  const area = document.createElement('textarea');
  area.rows = 1;
  area.maxLength = 4000;
  area.dataset.channelId = channelId;
  area.value = chatDrafts.get(channelId) ?? '';
  area.placeholder = state.wsStatus !== 'connected'
    ? 'Aguardando conexão…'
    : editing
      ? 'Editar mensagem'
      : (pendingAttachments.get(channelId)?.length ?? 0) > 0
        ? 'Adicionar uma legenda…'
        : `Mensagem em #${state.activeChannel.name}`;
  area.disabled = state.wsStatus !== 'connected' || sendingAttachmentBatches.has(channelId);
  area.setAttribute('aria-label', editing ? 'Editar mensagem' : `Mensagem em ${state.activeChannel.name}`);
  area.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      composer.requestSubmit();
    }
    if (event.key === 'Escape' && (editDrafts.has(channelId) || replyDrafts.has(channelId))) {
      event.preventDefault();
      if (editDrafts.has(channelId)) cancelEdit(channelId);
      else cancelReply(channelId);
    }
  });
  area.addEventListener('input', () => {
    chatDrafts.set(channelId, area.value);
    autoGrow(area);
    if (!editing) {
      realtime.setTyping(channelId, true);
      if (typingTimer) window.clearTimeout(typingTimer);
      typingTimer = window.setTimeout(() => realtime.setTyping(channelId, false), 1200);
    }
  });
  area.addEventListener('paste', event => {
    const files = filesFromClipboard(event.clipboardData);
    if (!files.length) return; // texto puro continua usando o Ctrl+V nativo.
    event.preventDefault();
    if (editing) {
      toast('Finalize ou cancele a edição antes de anexar arquivos.', true);
      return;
    }
    const session = getState().session;
    if (!session || getState().wsStatus !== 'connected') {
      toast('Aguarde a conexão com o servidor antes de colar arquivos.', true);
      return;
    }
    stageAttachments(channelId, files);
  });

  const send = el('button', 'primary-button', editing ? 'Salvar' : sendingAttachmentBatches.has(channelId) ? 'Enviando…' : 'Enviar');
  send.type = 'submit';
  send.toggleAttribute('disabled', state.wsStatus !== 'connected' || sendingAttachmentBatches.has(channelId));
  composer.append(attach, area, send);
  composer.addEventListener('submit', event => {
    event.preventDefault();
    void submitComposer(channelId, area, send);
  });

  composerRegion.append(composer);
  layout.append(messages, typing, composerRegion);
  mainEl.append(layout);
  autoGrow(area);
  restoreComposerState(area, previousComposer, channelId);
  restoreMessageScrollState(messages, previousMessages, channelId);
}

function renderConnectionStatus(): HTMLElement {
  const { wsStatus, rtt } = getState();
  const box = el('div', 'header-status');
  box.append(el('span', `status-dot ${wsStatus}`));
  const labels: Record<string, string> = {
    connected: 'Conectado', connecting: 'Conectando', reconnecting: 'Reconectando', offline: 'Offline'
  };
  box.append(el('span', '', labels[wsStatus] ?? wsStatus));
  if (typeof rtt === 'number') box.append(el('span', '', `${rtt} ms`));
  return box;
}

function patchMainDynamicState(): void {
  const state = getState();
  if (!state.server || !state.session) return;

  const connection = mainEl.querySelector<HTMLElement>('.header-status');
  if (connection) connection.replaceWith(renderConnectionStatus());

  if (state.activeChannel?.type === 'text') {
    patchTextMessageList();
    const typing = mainEl.querySelector<HTMLElement>('.typing');
    if (typing) patchTypingIndicator(typing);
    return;
  }

  if (state.activeChannel?.type !== 'voice') return;
  patchVoiceDynamicState(mainEl, voice);
}

function messageRenderKey(message: MessageInfo): string {
  return [
    message.id,
    message.editedAt ?? '',
    message.content,
    message.attachment?.id ?? '',
    message.attachment?.originalName ?? '',
    message.replyTo?.id ?? '',
    message.replyTo?.authorName ?? '',
    message.replyTo?.content ?? '',
    message.replyTo?.attachmentName ?? ''
  ].join('\u001e');
}

function messageListSignature(messages: MessageInfo[]): string {
  return messages.map(messageRenderKey).join('\u001f');
}

function patchTextMessageList(): void {
  const state = getState();
  const messages = mainEl.querySelector<HTMLElement>('#messages');
  if (!messages || !state.activeChannel || messages.dataset.channelId !== state.activeChannel.id) return;

  const signature = messageListSignature(state.messages);
  if (messages.dataset.renderSignature === signature) return;

  const snapshot: MessageScrollSnapshot = {
    channelId: state.activeChannel.id,
    scrollTop: messages.scrollTop,
    scrollHeight: messages.scrollHeight,
    clientHeight: messages.clientHeight,
    pinned: isMessageScrollPinned(messages.scrollHeight, messages.scrollTop, messages.clientHeight)
  };

  reconcileMessageList(messages, state.messages, state.activeChannel.name);
  messages.dataset.renderSignature = signature;
  restorePatchedMessageScroll(messages, snapshot, state.activeChannel.id);
}

function reconcileMessageList(messages: HTMLElement, nextMessages: MessageInfo[], channelName: string): void {
  if (nextMessages.length === 0) {
    const existingEmpty = messages.querySelector<HTMLElement>(':scope > .empty-state');
    if (existingEmpty && messages.childElementCount === 1) return;
    const empty = el('div', 'empty-state');
    empty.append(cardText(`Bem-vindo a #${channelName}`, 'Este é o começo do histórico deste canal. As mensagens são armazenadas localmente no PC host.'));
    messages.replaceChildren(empty);
    return;
  }

  for (const child of Array.from(messages.children)) {
    if (!(child instanceof HTMLElement) || !child.classList.contains('message')) child.remove();
  }

  const existing = new Map<string, HTMLElement>();
  for (const node of messages.querySelectorAll<HTMLElement>(':scope > .message[data-message-id]')) {
    const id = node.dataset.messageId;
    if (id) existing.set(id, node);
  }

  let index = 0;
  for (const message of nextMessages) {
    const key = messageRenderKey(message);
    let node = existing.get(message.id);
    if (!node || node.dataset.renderKey !== key) {
      const replacement = renderMessage(message);
      if (node) {
        node.replaceWith(replacement);
        existing.delete(message.id);
      }
      node = replacement;
    }

    const current = messages.children.item(index);
    if (current !== node) messages.insertBefore(node, current ?? null);
    existing.delete(message.id);
    index += 1;
  }

  for (const stale of existing.values()) stale.remove();
}

function restorePatchedMessageScroll(messages: HTMLElement, snapshot: MessageScrollSnapshot, channelId: string): void {
  if (snapshot.channelId !== channelId) {
    messages.scrollTop = messages.scrollHeight;
    scrollPinned = true;
    return;
  }

  if (!snapshot.pinned) {
    const bottom = Math.max(0, messages.scrollHeight - messages.clientHeight);
    messages.scrollTop = Math.min(Math.max(0, snapshot.scrollTop), bottom);
    scrollPinned = isMessageScrollPinned(messages.scrollHeight, messages.scrollTop, messages.clientHeight);
    return;
  }

  messages.scrollTop = messages.scrollHeight;
  scrollPinned = true;
  requestAnimationFrame(() => {
    if (!messages.isConnected || !scrollPinned) return;
    messages.scrollTop = messages.scrollHeight;
  });
}

function renderMessage(message: MessageInfo): HTMLElement {
  const item = el('article', 'message');
  item.dataset.messageId = message.id;
  item.dataset.renderKey = messageRenderKey(message);
  item.id = `message-${message.id}`;
  item.append(renderAvatar(message.authorName, 'message-avatar'));

  const body = el('div');
  const head = el('div', 'message-head');
  head.append(
    el('span', 'message-author', message.authorName),
    el('span', 'message-role', roleLabel(message.authorRole)),
    el('time', 'message-time', formatTime(message.createdAt))
  );
  if (message.editedAt) {
    const edited = el('span', 'message-edited', '(editada)');
    edited.title = `Editada em ${formatDateTime(message.editedAt)}`;
    head.append(edited);
  }

  const actions = el('div', 'message-actions');
  const reply = el('button', 'message-action-button', 'Responder');
  reply.type = 'button';
  reply.title = `Responder a ${message.authorName}`;
  reply.addEventListener('click', () => beginReply(message));
  actions.append(reply);

  const session = getState().session;
  if (message.kind === 'user' && session?.displayName === message.authorName) {
    const edit = el('button', 'message-action-button', 'Editar');
    edit.type = 'button';
    edit.title = 'Editar sua mensagem';
    edit.addEventListener('click', () => beginEdit(message));
    actions.append(edit);
  }

  if (session?.role === 'owner') {
    const remove = el('button', 'message-action-button danger', 'Apagar');
    remove.type = 'button';
    remove.title = 'Apagar esta mensagem para todos';
    remove.addEventListener('click', () => void deleteMessage(message));
    actions.append(remove);
  }
  head.append(actions);
  body.append(head);

  if (message.replyTo) body.append(renderReplyReference(message.replyTo));
  if (message.content) body.append(renderRichMessageContent(message.content));
  if (message.attachment) body.append(renderAttachment(message.attachment));
  item.append(body);
  return item;
}

function renderReplyReference(replyTo: NonNullable<MessageInfo['replyTo']>): HTMLElement {
  const button = el('button', 'message-reply-reference');
  button.type = 'button';
  button.title = 'Ir para a mensagem respondida';
  const author = el('span', 'message-reply-author', replyTo.authorName);
  const content = replyTo.content.replace(/\s+/g, ' ').trim();
  const preview = content || (replyTo.attachmentName ? `Anexo: ${replyTo.attachmentName}` : 'Mensagem');
  button.append(author, el('span', 'message-reply-text', preview.length > 120 ? `${preview.slice(0, 117)}…` : preview));
  button.addEventListener('click', () => focusRepliedMessage(replyTo.id));
  return button;
}

function focusRepliedMessage(messageId: string): void {
  const target = document.getElementById(`message-${messageId}`);
  if (!target) {
    toast('A mensagem respondida não está carregada neste trecho do histórico.');
    return;
  }
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.classList.add('message-highlight');
  window.setTimeout(() => target.classList.remove('message-highlight'), 1200);
}



function renderRichMessageContent(content: string): HTMLElement {
  const box = el('div', 'message-content');
  const mediaUrls: string[] = [];
  const pattern = /https?:\/\/[^\s<>]+/giu;
  let cursor = 0;
  for (const match of content.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) box.append(document.createTextNode(content.slice(cursor, index)));
    const raw = match[0];
    const { url, trailing } = splitTrailingLinkPunctuation(raw);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.textContent = url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.className = 'message-link';
    box.append(anchor);
    if (trailing) box.append(document.createTextNode(trailing));
    if (clientPreferences.externalMediaPreviews && isDirectImageUrl(url)) mediaUrls.push(url);
    cursor = index + raw.length;
  }
  if (cursor < content.length) box.append(document.createTextNode(content.slice(cursor)));

  if (mediaUrls.length) {
    const media = el('div', 'message-external-media');
    for (const url of [...new Set(mediaUrls)].slice(0, 4)) {
      const img = document.createElement('img');
      img.className = 'message-external-image';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.alt = 'Pré-visualização de imagem externa';
      img.src = url;
      img.addEventListener('error', () => img.remove(), { once: true });
      media.append(img);
    }
    box.append(media);
  }
  return box;
}

function splitTrailingLinkPunctuation(raw: string): { url: string; trailing: string } {
  let url = raw;
  let trailing = '';
  while (/[),.;!?]$/.test(url)) {
    const last = url.at(-1) ?? '';
    if (last === ')' && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) {
      trailing = last + trailing;
      url = url.slice(0, -1);
      continue;
    }
    if (last !== ')') {
      trailing = last + trailing;
      url = url.slice(0, -1);
      continue;
    }
    break;
  }
  return { url, trailing };
}

function isDirectImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return /\.(?:png|jpe?g|gif|webp)(?:$|[?#])/i.test(url.href);
  } catch {
    return false;
  }
}

function renderAttachment(attachment: NonNullable<MessageInfo['attachment']>): HTMLElement {
  const wrap = el('div', 'attachment-wrap');
  const card = el('div', 'attachment-card');
  const icon = el('div', 'attachment-icon', attachment.mime.startsWith('image/') ? '▧' : attachment.mime.startsWith('video/') ? '▶' : attachment.mime.startsWith('audio/') ? '♪' : attachment.mime.startsWith('text/plain') ? 'TXT' : '⇩');
  const meta = el('div', 'attachment-meta');
  meta.append(el('div', 'attachment-name', attachment.originalName), el('div', 'attachment-sub', `${formatBytes(attachment.size)} · ${attachment.mime}`));
  const actions = el('div', 'attachment-actions');
  if (isPreviewableAttachmentMime(attachment.mime)) {
    const preview = el('button', 'secondary-button attachment-download', 'Ver');
    preview.type = 'button';
    preview.addEventListener('click', () => void openFilePreview(attachment));
    actions.append(preview);
  }
  const download = el('button', 'secondary-button attachment-download', 'Baixar');
  download.type = 'button';
  download.addEventListener('click', () => void downloadAttachment(attachment.id));
  actions.append(download);
  card.append(icon, meta, actions);
  wrap.append(card);
  if (attachment.mime.startsWith('image/') && attachment.size <= 20 * 1024 * 1024) {
    void addInlineAttachmentImage(wrap, attachment);
  }
  return wrap;
}

function renderComposerContext(channelId: string): HTMLElement | undefined {
  const editing = editDrafts.get(channelId);
  const replying = replyDrafts.get(channelId);
  const files = pendingAttachments.get(channelId) ?? [];
  if (!editing && !replying && files.length === 0) return undefined;

  const stack = el('div', 'composer-context-stack');

  if (editing) {
    const bar = el('div', 'composer-context-bar editing');
    const text = el('div', 'composer-context-copy');
    text.append(
      el('strong', '', 'Editando sua mensagem'),
      el('span', '', editing.attachment ? 'Você pode alterar ou remover a legenda do anexo.' : 'Pressione Esc para cancelar.')
    );
    const cancel = el('button', 'composer-context-close', '×');
    cancel.type = 'button';
    cancel.title = 'Cancelar edição';
    cancel.setAttribute('aria-label', cancel.title);
    cancel.addEventListener('click', () => cancelEdit(channelId));
    bar.append(text, cancel);
    stack.append(bar);
  } else if (replying) {
    const bar = el('div', 'composer-context-bar reply');
    const text = el('div', 'composer-context-copy');
    text.append(
      el('strong', '', `Respondendo a ${replying.authorName}`),
      el('span', '', messagePreviewText(replying))
    );
    const cancel = el('button', 'composer-context-close', '×');
    cancel.type = 'button';
    cancel.title = 'Cancelar resposta';
    cancel.setAttribute('aria-label', cancel.title);
    cancel.addEventListener('click', () => cancelReply(channelId));
    bar.append(text, cancel);
    stack.append(bar);
  }

  if (!editing && files.length) {
    const panel = el('div', 'pending-attachments');
    const header = el('div', 'pending-attachments-header');
    header.append(
      el('strong', '', files.length === 1 ? '1 arquivo pronto para enviar' : `${files.length} arquivos prontos para enviar`),
      el('span', '', 'Digite uma legenda abaixo. Nada será enviado antes da confirmação.')
    );
    panel.append(header);

    const list = el('div', 'pending-attachments-list');
    for (const file of files) {
      const chip = el('div', 'pending-attachment-chip');
      if (file.type.startsWith('image/')) {
        const img = document.createElement('img');
        img.className = 'pending-attachment-thumb';
        img.alt = '';
        const objectUrl = URL.createObjectURL(file);
        img.src = objectUrl;
        const release = () => URL.revokeObjectURL(objectUrl);
        img.addEventListener('load', release, { once: true });
        img.addEventListener('error', release, { once: true });
        chip.append(img);
      } else {
        chip.append(el('span', 'pending-attachment-file-icon', '⇧'));
      }
      const meta = el('div', 'pending-attachment-meta');
      meta.append(el('span', 'pending-attachment-name', file.name), el('span', 'pending-attachment-size', formatBytes(file.size)));
      const remove = el('button', 'pending-attachment-remove', '×');
      remove.type = 'button';
      remove.title = `Remover ${file.name}`;
      remove.setAttribute('aria-label', remove.title);
      remove.addEventListener('click', () => removePendingAttachment(channelId, file));
      chip.append(meta, remove);
      list.append(chip);
    }
    panel.append(list);
    stack.append(panel);
  }

  return stack;
}

function chooseFileForUpload(channelId: string): void {
  const state = getState();
  if (!state.session || editDrafts.has(channelId)) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.hidden = true;
  document.body.append(input);
  input.addEventListener('change', () => {
    const files = Array.from(input.files ?? []);
    input.remove();
    if (files.length) stageAttachments(channelId, files);
  }, { once: true });
  input.click();
}

function uploadKey(file: File): string {
  return `${file.name}\u001f${file.size}\u001f${file.lastModified}\u001f${file.type}`;
}

function stageAttachments(channelId: string, incoming: File[]): void {
  const maxBytes = 500 * 1024 * 1024;
  const current = [...(pendingAttachments.get(channelId) ?? [])];
  const seen = new Set(current.map(uploadKey));
  let rejectedOversize = 0;

  for (const file of incoming) {
    if (current.length >= 12) break;
    if (file.size > maxBytes) {
      rejectedOversize += 1;
      continue;
    }
    const key = uploadKey(file);
    if (seen.has(key)) continue;
    seen.add(key);
    current.push(file);
  }

  if (rejectedOversize) toast('Um ou mais arquivos ultrapassam o limite de 500 MB.', true);
  if ((pendingAttachments.get(channelId)?.length ?? 0) + incoming.length > 12) {
    toast('É possível preparar no máximo 12 arquivos por envio.', true);
  }
  if (!current.length) return;
  pendingAttachments.set(channelId, current);
  renderMain();
  focusComposer();
}

function removePendingAttachment(channelId: string, file: File): void {
  const key = uploadKey(file);
  const next = (pendingAttachments.get(channelId) ?? []).filter(item => uploadKey(item) !== key);
  if (next.length) pendingAttachments.set(channelId, next);
  else pendingAttachments.delete(channelId);
  renderMain();
  focusComposer();
}

function filesFromClipboard(data: DataTransfer | null): File[] {
  if (!data) return [];
  return collectClipboardFiles<File>(data.files, data.items as unknown as ArrayLike<{ kind: string; getAsFile(): File | null }>);
}

async function submitComposer(channelId: string, area: HTMLTextAreaElement, sendButton: HTMLButtonElement): Promise<void> {
  const state = getState();
  const session = state.session;
  if (!session || state.wsStatus !== 'connected') {
    toast('Ainda não conectado ao servidor.', true);
    return;
  }

  const editing = editDrafts.get(channelId);
  const value = area.value.trim();
  if (editing) {
    if (!value && !editing.attachment) {
      toast('Uma mensagem sem anexo não pode ficar vazia.', true);
      return;
    }
    sendButton.disabled = true;
    sendButton.textContent = 'Salvando…';
    try {
      const result = await api.editMessage(editing.id, session.token, value);
      updateMessage(result.message);
      finishEdit(channelId);
    } catch (error) {
      toast(errorMessage(error), true);
      sendButton.disabled = false;
      sendButton.textContent = 'Salvar';
    }
    return;
  }

  const files = [...(pendingAttachments.get(channelId) ?? [])];
  const replyToId = replyDrafts.get(channelId)?.id;
  if (files.length) {
    const label = files.length === 1 ? `Enviar "${files[0]!.name}"` : `Enviar ${files.length} arquivos`;
    const captionInfo = value ? '\n\nA legenda digitada será enviada junto ao primeiro arquivo.' : '';
    if (!window.confirm(`${label}?${captionInfo}`)) return;
    if (sendingAttachmentBatches.has(channelId)) return;

    sendingAttachmentBatches.add(channelId);
    area.disabled = true;
    sendButton.disabled = true;
    sendButton.textContent = 'Enviando…';
    realtime.setTyping(channelId, false);
    try {
      await sendAttachmentBatch(channelId, session.token, files, value, replyToId);
      chatDrafts.delete(channelId);
      replyDrafts.delete(channelId);
      area.value = '';
      autoGrow(area);
    } catch (error) {
      toast(errorMessage(error), true);
    } finally {
      sendingAttachmentBatches.delete(channelId);
      renderMain();
      focusComposer();
    }
    return;
  }

  if (!value) return;
  if (!realtime.sendChat(channelId, value, replyToId)) {
    toast('Ainda não conectado ao servidor.', true);
    return;
  }
  realtime.setTyping(channelId, false);
  chatDrafts.delete(channelId);
  replyDrafts.delete(channelId);
  area.value = '';
  autoGrow(area);
  renderMain();
  focusComposer();
}

async function sendAttachmentBatch(
  channelId: string,
  token: string,
  files: File[],
  caption: string,
  replyToId?: string
): Promise<void> {
  for (const [index, file] of files.entries()) {
    const message = await performUpload(channelId, token, file, replyToId);
    if (index === 0 && caption) {
      const captioned = await api.editMessage(message.id, token, caption, true);
      updateMessage(captioned.message);
      // Se um lote falhar depois do primeiro arquivo, a legenda já foi usada e
      // não deve ser repetida ao reenviar os arquivos restantes.
      chatDrafts.delete(channelId);
    }
    const remaining = (pendingAttachments.get(channelId) ?? []).filter(item => uploadKey(item) !== uploadKey(file));
    if (remaining.length) pendingAttachments.set(channelId, remaining);
    else pendingAttachments.delete(channelId);
  }
}

async function performUpload(channelId: string, token: string, file: File, replyToId?: string): Promise<MessageInfo> {
  const max = 500 * 1024 * 1024;
  if (file.size > max) throw new Error('O arquivo ultrapassa o limite de 500 MB.');

  const key = uploadKey(file);
  if (activeUploads.has(key)) throw new Error(`${file.name} já está sendo enviado.`);
  activeUploads.add(key);

  const progressToast = el('div', 'toast upload-toast');
  const label = el('div', 'upload-label', `Enviando ${file.name}…`);
  const progress = document.createElement('progress');
  progress.max = 100;
  progress.value = 0;
  progressToast.append(label, progress);
  toasts.append(progressToast);
  try {
    const result = await uploadFile(channelId, token, file, (loaded, total) => {
      progress.value = total > 0 ? Math.round((loaded / total) * 100) : 0;
      label.textContent = `Enviando ${file.name}… ${progress.value}%`;
    }, replyToId);
    appendMessage(result.message);
    label.textContent = `${file.name} enviado.`;
    progress.value = 100;
    window.setTimeout(() => progressToast.remove(), 1800);
    return result.message;
  } catch (error) {
    progressToast.remove();
    throw error;
  } finally {
    activeUploads.delete(key);
  }
}

function beginReply(message: MessageInfo): void {
  const channelId = message.channelId;
  if (editDrafts.has(channelId)) cancelEdit(channelId, false);
  replyDrafts.set(channelId, message);
  renderMain();
  focusComposer();
}

function cancelReply(channelId: string, rerender = true): void {
  replyDrafts.delete(channelId);
  if (rerender) {
    renderMain();
    focusComposer();
  }
}

const editPreviousDrafts = new Map<string, string>();

function beginEdit(message: MessageInfo): void {
  const state = getState();
  const session = state.session;
  if (!session || session.displayName !== message.authorName || message.kind !== 'user') return;
  if ((pendingAttachments.get(message.channelId)?.length ?? 0) > 0) {
    toast('Envie ou remova os anexos preparados antes de editar uma mensagem.', true);
    return;
  }
  if (!editDrafts.has(message.channelId)) editPreviousDrafts.set(message.channelId, chatDrafts.get(message.channelId) ?? '');
  replyDrafts.delete(message.channelId);
  editDrafts.set(message.channelId, message);
  chatDrafts.set(message.channelId, message.content);
  renderMain();
  focusComposer();
}

function cancelEdit(channelId: string, rerender = true): void {
  editDrafts.delete(channelId);
  const previous = editPreviousDrafts.get(channelId) ?? '';
  editPreviousDrafts.delete(channelId);
  if (previous) chatDrafts.set(channelId, previous);
  else chatDrafts.delete(channelId);
  if (rerender) {
    renderMain();
    focusComposer();
  }
}

function finishEdit(channelId: string): void {
  editDrafts.delete(channelId);
  const previous = editPreviousDrafts.get(channelId) ?? '';
  editPreviousDrafts.delete(channelId);
  if (previous) chatDrafts.set(channelId, previous);
  else chatDrafts.delete(channelId);
  renderMain();
  focusComposer();
}

function focusComposer(): void {
  requestAnimationFrame(() => {
    const area = mainEl.querySelector<HTMLTextAreaElement>('.composer textarea');
    if (!area || area.disabled) return;
    area.focus({ preventScroll: true });
    const end = area.value.length;
    area.setSelectionRange(end, end);
  });
}

function messagePreviewText(message: Pick<MessageInfo, 'content' | 'attachment'>): string {
  const content = message.content.replace(/\s+/g, ' ').trim();
  if (content) return content.length > 100 ? `${content.slice(0, 97)}…` : content;
  if (message.attachment) return `Anexo: ${message.attachment.originalName}`;
  return 'Mensagem';
}

async function downloadAttachment(fileId: string): Promise<void> {
  const session = getState().session;
  if (!session) return;

  // Nunca navegue o documento principal para baixar anexos. Em alguns
  // navegadores isso fecha o WebSocket/WebRTC por um instante e derruba a tela.
  const frame = createBackgroundDownloadFrame(document);
  try {
    const grant = await api.downloadGrant(fileId, session.token);
    navigateBackgroundDownload(frame, grant.url);
    // O frame permanece oculto até a página encerrar. Removê-lo por timer pode
    // abortar downloads grandes/lentos em alguns navegadores.
  } catch (error) {
    frame.remove();
    toast(errorMessage(error), true);
  }
}

function isPreviewableAttachmentMime(mime: string): boolean {
  const normalized = mime.toLowerCase().split(';', 1)[0]?.trim() ?? '';
  return normalized.startsWith('image/')
    || normalized === 'text/plain'
    || normalized === 'application/pdf'
    || normalized.startsWith('audio/')
    || normalized.startsWith('video/');
}

async function addInlineAttachmentImage(
  host: HTMLElement,
  attachment: NonNullable<MessageInfo['attachment']>
): Promise<void> {
  const session = getState().session;
  if (!session) return;

  // O wrapper ainda NÃO está conectado ao DOM quando renderAttachment() chama
  // esta função. A versão 0.3.5 abortava aqui por causa de host.isConnected,
  // portanto nenhuma imagem aparecia automaticamente. Inserimos a imagem
  // primeiro e resolvemos o grant logo em seguida.
  const image = document.createElement('img');
  image.className = 'attachment-inline-image';
  image.loading = 'eager';
  image.alt = attachment.originalName;
  image.title = 'Clique para ampliar';
  image.addEventListener('click', () => void openFilePreview(attachment));
  host.prepend(image);

  try {
    const grant = await api.previewGrant(attachment.id, session.token);
    if (!host.isConnected) return;
    image.addEventListener('load', () => {
      const messages = mainEl.querySelector<HTMLElement>('#messages');
      if (!messages || !scrollPinned) return;
      messages.scrollTop = messages.scrollHeight;
    }, { once: true });
    image.src = grant.url;
    image.addEventListener('error', () => image.remove(), { once: true });
  } catch {
    image.remove();
    // Preview inline é opcional; o cartão e o download continuam utilizáveis.
  }
}

async function openFilePreview(file: Pick<IndexedFileInfo, 'id' | 'originalName' | 'size' | 'mime'>): Promise<void> {
  const session = getState().session;
  if (!session) return;
  filePreviewDialog.replaceChildren();
  const card = el('div', 'modal-card preview-card');
  const head = el('div', 'preview-head');
  const copy = el('div');
  copy.append(el('h2', '', file.originalName), el('p', '', `${formatBytes(file.size)} · ${file.mime}`));
  const close = el('button', 'icon-button', '×');
  close.type = 'button';
  close.title = 'Fechar pré-visualização';
  close.addEventListener('click', () => filePreviewDialog.close());
  head.append(copy, close);
  const body = el('div', 'preview-body');
  body.append(el('div', 'preview-loading', 'Carregando pré-visualização…'));
  const actions = el('div', 'form-actions');
  const download = el('button', 'secondary-button', 'Baixar arquivo');
  download.type = 'button';
  download.addEventListener('click', () => void downloadAttachment(file.id));
  actions.append(download);
  card.append(head, body, actions);
  filePreviewDialog.append(card);
  if (!filePreviewDialog.open) filePreviewDialog.showModal();

  try {
    if (!isPreviewableAttachmentMime(file.mime)) throw new Error('Este tipo de arquivo não possui pré-visualização segura.');
    if (file.mime.toLowerCase().startsWith('text/plain') && file.size > 2 * 1024 * 1024) {
      throw new Error('Arquivo TXT grande demais para a pré-visualização. Faça o download para abrir o conteúdo completo.');
    }
    const grant = await api.previewGrant(file.id, session.token);
    if (!filePreviewDialog.open) return;
    body.replaceChildren();
    const normalized = file.mime.toLowerCase().split(';', 1)[0]?.trim() ?? '';
    if (normalized.startsWith('image/')) {
      const image = document.createElement('img');
      image.className = 'file-preview-image';
      image.alt = file.originalName;
      image.src = grant.url;
      body.append(image);
    } else if (normalized === 'text/plain') {
      const response = await fetch(grant.url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Falha ao abrir TXT: HTTP ${response.status}`);
      const text = await response.text();
      const pre = el('pre', 'file-preview-text');
      pre.textContent = text.slice(0, 1_500_000);
      body.append(pre);
    } else if (normalized === 'application/pdf') {
      const frame = document.createElement('iframe');
      frame.className = 'file-preview-frame';
      frame.src = grant.url;
      frame.title = `Pré-visualização de ${file.originalName}`;
      body.append(frame);
    } else if (normalized.startsWith('audio/')) {
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.src = grant.url;
      body.append(audio);
    } else if (normalized.startsWith('video/')) {
      const video = document.createElement('video');
      video.controls = true;
      video.playsInline = true;
      video.className = 'file-preview-video';
      video.src = grant.url;
      body.append(video);
    }
  } catch (error) {
    body.replaceChildren(el('div', 'voice-notice warn', errorMessage(error)));
  }
}

async function openFilesDialog(): Promise<void> {
  const state = getState();
  if (!state.server || !state.session) return;
  filesDialog.replaceChildren();
  const card = el('div', 'modal-card files-card');
  const head = el('div', 'files-dialog-head');
  const copy = el('div');
  copy.append(el('h2', '', 'Arquivos do servidor'), el('p', '', 'Pesquise pelo nome do arquivo ou pelo conteúdo de arquivos TXT indexados.'));
  const close = el('button', 'icon-button', '×');
  close.type = 'button';
  close.title = 'Fechar';
  close.addEventListener('click', () => filesDialog.close());
  head.append(copy, close);

  const form = el('form', 'files-search-form');
  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = 'Nome ou trecho de um TXT…';
  input.setAttribute('aria-label', 'Pesquisar arquivos');
  const submit = el('button', 'primary-button', 'Pesquisar');
  submit.type = 'submit';
  form.append(input, submit);
  const results = el('div', 'files-search-results');
  card.append(head, form, results);
  filesDialog.append(card);
  if (!filesDialog.open) filesDialog.showModal();

  const load = async () => {
    results.replaceChildren(el('div', 'preview-loading', 'Procurando arquivos…'));
    try {
      const response = await api.searchFiles(state.server!.id, state.session!.token, input.value);
      results.replaceChildren();
      if (!response.files.length) {
        results.append(el('div', 'empty-file-results', 'Nenhum arquivo encontrado.'));
        return;
      }
      for (const file of response.files) results.append(renderIndexedFile(file));
    } catch (error) {
      results.replaceChildren(el('div', 'voice-notice error', errorMessage(error)));
    }
  };
  form.addEventListener('submit', event => {
    event.preventDefault();
    void load();
  });
  await load();
  requestAnimationFrame(() => input.focus());
}

function renderIndexedFile(file: IndexedFileInfo): HTMLElement {
  const row = el('article', 'indexed-file');
  const icon = el('div', 'attachment-icon', file.mime.startsWith('image/') ? '▧' : file.mime.startsWith('text/plain') ? 'TXT' : '⇩');
  const meta = el('div', 'indexed-file-meta');
  meta.append(
    el('strong', '', file.originalName),
    el('span', '', `#${file.channelName} · ${file.uploaderName} · ${formatBytes(file.size)}`)
  );
  if (file.excerpt?.trim()) meta.append(el('pre', 'indexed-file-excerpt', file.excerpt.trim()));
  const actions = el('div', 'attachment-actions');
  if (isPreviewableAttachmentMime(file.mime)) {
    const preview = el('button', 'secondary-button attachment-download', 'Ver');
    preview.type = 'button';
    preview.addEventListener('click', () => void openFilePreview(file));
    actions.append(preview);
  }
  const download = el('button', 'secondary-button attachment-download', 'Baixar');
  download.type = 'button';
  download.addEventListener('click', () => void downloadAttachment(file.id));
  actions.append(download);
  row.append(icon, meta, actions);
  return row;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function renderMembers(): void {
  const previousScrollTop = membersEl.querySelector<HTMLElement>('.member-list')?.scrollTop ?? 0;
  const { server, presence, session } = getState();
  membersEl.replaceChildren();
  const header = el('div', 'member-header', server ? `PARTICIPANTES — ${presence.length}/6` : 'PARTICIPANTES');
  const list = el('div', 'member-list');

  for (const member of presence) {
    const row = el('div', `member${member.connected ? '' : ' offline'}`);
    row.append(renderAvatar(member.displayName, 'member-avatar'));
    const meta = el('div');
    meta.append(
      el('div', 'member-name', member.displayName),
      el('div', 'member-state', `${roleLabel(member.role)} · ${member.connected ? 'online' : 'reconectando'}`)
    );
    row.append(meta);
    if (session?.role === 'owner' && member.role !== 'owner' && member.displayName !== session.displayName) {
      row.title = 'Clique com botão direito para alterar cargo';
      row.addEventListener('contextmenu', event => {
        event.preventDefault();
        void toggleMemberRole(member.displayName, member.role === 'moderator' ? 'member' : 'moderator');
      });
    }
    list.append(row);
  }
  membersEl.append(header, list);
  list.scrollTop = Math.min(previousScrollTop, Math.max(0, list.scrollHeight - list.clientHeight));
}

function renderLanding(): void {
  mainEl.replaceChildren();
  const header = el('header', 'main-header');
  const heading = el('div', 'main-heading');
  heading.append(el('span', '', '⌂'), el('h1', '', 'Verdant LAN'));
  const badges = el('div', 'header-status');
  const secure = window.isSecureContext;
  badges.append(el('span', `badge ${secure ? 'ok' : 'warn'}`, secure ? 'Contexto seguro' : 'Chat disponível · mídia exige HTTPS'));
  header.append(heading, badges);

  const empty = el('div', 'empty-state');
  const card = el('div', 'empty-state-card');
  card.append(el('h2', '', 'Comunicação privada, primeiro na sua rede.'));
  card.append(el('p', '', 'Selecione um servidor à esquerda ou crie um novo. O chat, os canais e o histórico ficam no computador host; não há conta externa nem telemetria.'));
  const actions = el('div', 'form-actions');
  const create = el('button', 'primary-button', 'Criar servidor');
  create.type = 'button';
  create.addEventListener('click', () => openEntryDialog('create'));
  actions.append(create);
  card.append(actions);
  empty.append(card);
  mainEl.append(header, empty);
}

function renderFatal(message: string): void {
  mainEl.replaceChildren();
  const empty = el('div', 'empty-state');
  empty.append(cardText('Não foi possível iniciar', message));
  mainEl.append(empty);
  toast(message, true);
}

async function openSettingsDialog(): Promise<void> {
  renderSettingsDialog();
  if (!settingsDialog.open) settingsDialog.showModal();
}

function renderSettingsDialog(): void {
  settingsDialog.replaceChildren();
  const shell = el('div', 'modal-card settings-card settings-shell');

  const sidebar = el('aside', 'settings-sidebar');
  const sidebarTitle = el('div', 'settings-sidebar-title');
  sidebarTitle.append(el('strong', '', 'Configurações'), el('span', '', 'Perfil e preferências'));
  sidebar.append(sidebarTitle);
  const nav = el('nav', 'settings-nav');
  const pages: Array<[SettingsPage, string, string]> = [
    ['profile', 'Perfil', '●'],
    ['general', 'Geral', '⌂'],
    ['audio', 'Áudio', '♪'],
    ['notifications', 'Notificações', '◉'],
    ['appearance', 'Aparência', '✦']
  ];
  for (const [page, label, icon] of pages) {
    const button = el('button', `settings-nav-button${settingsPage === page ? ' active' : ''}`);
    button.type = 'button';
    button.append(el('span', 'settings-nav-icon', icon), el('span', '', label));
    button.addEventListener('click', () => { settingsPage = page; renderSettingsDialog(); });
    nav.append(button);
  }
  sidebar.append(nav);

  const content = el('section', 'settings-content');
  const head = el('div', 'settings-head');
  const copy = el('div');
  const pageCopy: Record<SettingsPage, [string, string]> = {
    profile: ['Perfil', 'Sua foto fica armazenada no host deste servidor e aparece para os demais participantes.'],
    general: ['Geral', 'Preferências locais e comportamento básico deste cliente.'],
    audio: ['Áudio', 'Microfone, supressão de ruído, detecção de voz e efeitos locais.'],
    notifications: ['Notificações', 'Escolha quais eventos tocam, qual som usar e o volume de cada um.'],
    appearance: ['Aparência', 'Tema, blur, brilho de fala e escala ficam somente neste navegador.']
  };
  copy.append(el('h2', '', pageCopy[settingsPage][0]), el('p', '', pageCopy[settingsPage][1]));
  const close = el('button', 'icon-button settings-close', '×');
  close.type = 'button';
  close.title = 'Fechar configurações';
  close.setAttribute('aria-label', close.title);
  close.addEventListener('click', () => settingsDialog.close());
  head.append(copy, close);
  content.append(head);

  if (settingsPage === 'profile') content.append(renderProfileSettings());
  else if (settingsPage === 'general') content.append(renderGeneralSettings());
  else if (settingsPage === 'audio') content.append(renderAudioSettings());
  else if (settingsPage === 'notifications') content.append(renderNotificationSettings());
  else content.append(renderAppearanceSettings());

  const actions = el('div', 'form-actions settings-actions');
  const done = el('button', 'primary-button', 'Concluído');
  done.type = 'button';
  done.addEventListener('click', () => settingsDialog.close());
  actions.append(done);
  content.append(actions);

  shell.append(sidebar, content);
  settingsDialog.append(shell);
}

function renderProfileSettings(): HTMLElement {
  const group = el('div', 'settings-page-sections');
  const state = getState();
  const session = state.session;
  const server = state.server;
  const section = el('section', 'settings-section settings-section-first profile-settings-section');
  section.append(el('h3', '', 'Foto de perfil'));

  if (!session || !server) {
    section.append(el('p', 'settings-note', 'Entre em um servidor para configurar sua foto de perfil.'));
    group.append(section);
    return group;
  }

  const profile = memberProfiles.get(profileKey(session.displayName));
  const row = el('div', 'profile-editor');
  const preview = renderAvatar(session.displayName, 'profile-avatar-preview');
  const copy = el('div', 'profile-editor-copy');
  copy.append(
    el('strong', '', session.displayName),
    el('span', '', 'A imagem é reduzida no navegador antes de ser enviada e fica armazenada apenas no host deste servidor.'),
    el('small', '', 'Formatos aceitos: PNG, JPEG ou WebP. O cliente gera uma miniatura quadrada WebP de até 256×256.')
  );

  const actions = el('div', 'profile-editor-actions');
  const choose = el('button', 'primary-button', profile?.avatarDataUrl ? 'Trocar foto' : 'Escolher foto');
  choose.type = 'button';
  choose.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) void updateOwnProfileAvatar(file);
    }, { once: true });
    input.click();
  });

  const remove = el('button', 'secondary-button', 'Remover foto');
  remove.type = 'button';
  remove.disabled = !profile?.avatarDataUrl;
  remove.addEventListener('click', () => void removeOwnProfileAvatar());

  actions.append(choose, remove);
  copy.append(actions);
  row.append(preview, copy);
  section.append(row);

  const privacy = el('section', 'settings-section');
  privacy.append(
    el('h3', '', 'Como funciona'),
    el('p', 'settings-note', 'A foto é vinculada ao seu nome normalizado dentro deste servidor. Ela não cria conta online, não sai do host Verdant e não altera voz, transmissão ou mídia WebRTC.')
  );

  group.append(section, privacy);
  return group;
}

async function updateOwnProfileAvatar(file: File): Promise<void> {
  const state = getState();
  if (!state.server || !state.session) return;
  if (file.size > 12 * 1024 * 1024) {
    toast('Escolha uma imagem de até 12 MB; ela será reduzida antes do envio.', true);
    return;
  }
  try {
    const avatarDataUrl = await prepareAvatarImage(file);
    const result = await api.updateProfile(state.server.id, state.session.token, avatarDataUrl);
    memberProfiles.set(profileKey(result.profile.displayName), result.profile);
    lastMainRenderSignature = '';
    scheduleRender();
    renderSettingsDialog();
    toast('Foto de perfil atualizada.');
  } catch (error) {
    toast(errorMessage(error), true);
  }
}

async function removeOwnProfileAvatar(): Promise<void> {
  const state = getState();
  if (!state.server || !state.session) return;
  try {
    const result = await api.updateProfile(state.server.id, state.session.token, null);
    memberProfiles.set(profileKey(result.profile.displayName), result.profile);
    lastMainRenderSignature = '';
    scheduleRender();
    renderSettingsDialog();
    toast('Foto de perfil removida.');
  } catch (error) {
    toast(errorMessage(error), true);
  }
}

async function prepareAvatarImage(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/i.test(file.type)) throw new Error('Use uma imagem PNG, JPEG ou WebP.');
  const bitmap = await createImageBitmap(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    if (!side) throw new Error('Não foi possível ler essa imagem.');
    const sourceX = Math.floor((bitmap.width - side) / 2);
    const sourceY = Math.floor((bitmap.height - side) / 2);
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Seu navegador não disponibilizou o canvas necessário para preparar a foto.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, sourceX, sourceY, side, side, 0, 0, 256, 256);
    const dataUrl = canvas.toDataURL('image/webp', 0.84);
    if (!dataUrl.startsWith('data:image/webp;base64,')) throw new Error('Falha ao converter a foto para WebP.');
    if (dataUrl.length > 520 * 1024) throw new Error('A foto continuou grande demais após a redução.');
    return dataUrl;
  } finally {
    bitmap.close();
  }
}

function renderGeneralSettings(): HTMLElement {
  const group = el('div', 'settings-page-sections');
  const local = el('section', 'settings-section settings-section-first');
  local.append(el('h3', '', 'Preferências locais'));
  local.append(el('p', 'settings-note', 'Tema, volumes de participantes e sons de notificação ficam salvos neste navegador. Essas escolhas não alteram o volume nem as preferências das outras pessoas.'));

  const external = el('label', 'settings-check');
  const externalInput = document.createElement('input');
  externalInput.type = 'checkbox';
  externalInput.checked = clientPreferences.externalMediaPreviews;
  externalInput.addEventListener('change', () => {
    updateClientPreferences({ externalMediaPreviews: externalInput.checked });
    lastMainRenderSignature = '';
    scheduleRender();
  });
  const externalCopy = el('span');
  externalCopy.append(el('strong', '', 'Pré-visualizar imagens/GIFs de links externos'), el('small', '', 'Desligado por padrão. Ao ativar, seu navegador conecta diretamente ao endereço externo para carregar a mídia.'));
  external.append(externalInput, externalCopy);
  local.append(external);

  const call = el('section', 'settings-section');
  call.append(el('h3', '', 'Chamada'));
  call.append(el('p', 'settings-note', 'O volume de cada participante continua sendo ajustado diretamente no card daquela pessoa na chamada. Os efeitos de interface abaixo não passam pelo mediasoup e não alteram microfone, Producer, Consumer ou Opus.'));
  group.append(local, call);
  return group;
}

function renderAudioSettings(): HTMLElement {
  const group = el('div', 'settings-page-sections');

  const microphone = el('section', 'settings-section settings-section-first');
  microphone.append(
    el('h3', '', 'Processamento do microfone'),
    el('p', 'settings-note', 'O modelo Padrão prioriza o processamento nativo do Chromium/WebRTC e acrescenta apenas um expander/gate leve. O modelo Verdant usa o próprio DSP do cliente para atacar ruído contínuo, respiração e transientes de teclado sem depender de um modelo neural pesado.')
  );

  microphone.append(settingsCheckbox(
    'Supressor de ruído',
    'Filtra ruído de fundo antes do áudio seguir para o Producer do microfone.',
    voiceAudioPreferences.noiseSuppression,
    checked => void updateVoiceAudioPreferences({ noiseSuppression: checked }, true)
  ));

  microphone.append(settingsChoice(
    'Modelo do supressor',
    [
      { value: 'standard', label: 'Padrão · Chromium + filtro leve' },
      { value: 'verdant', label: 'Verdant · intenso e adaptativo' }
    ],
    voiceAudioPreferences.suppressorModel,
    value => void updateVoiceAudioPreferences({ suppressorModel: value as NoiseSuppressorModel }, true),
    !voiceAudioPreferences.noiseSuppression
  ));

  microphone.append(settingsChoice(
    'Nível de supressão',
    (['low', 'medium', 'high', 'maximum'] as NoiseSuppressionLevel[]).map(value => ({ value, label: suppressionLevelLabel(value) })),
    voiceAudioPreferences.suppressionLevel,
    value => void updateVoiceAudioPreferences({ suppressionLevel: value as NoiseSuppressionLevel }),
    !voiceAudioPreferences.noiseSuppression
  ));

  if (voiceAudioPreferences.suppressorModel === 'verdant' && voiceAudioPreferences.noiseSuppression) {
    const verdant = el('div', 'audio-processing-note verdant');
    verdant.append(
      el('strong', '', 'Verdant Voice DSP'),
      el('span', '', 'High-pass adaptativo + estimação de piso de ruído + downward expander + supressão de respiração + detector de transientes para teclas. Quanto maior o nível, mais agressivo o corte e maior o risco de aparar sons muito baixos da fala.')
    );
    microphone.append(verdant);
  }

  const detection = el('section', 'settings-section');
  detection.append(el('h3', '', 'Detecção de voz'));
  detection.append(settingsCheckbox(
    'Ativar detecção de voz',
    'Fecha suavemente o microfone durante silêncio/ruído e reabre com ataque curto quando a fala aparece.',
    voiceAudioPreferences.voiceDetection,
    checked => void updateVoiceAudioPreferences({ voiceDetection: checked }, true)
  ));

  detection.append(settingsChoice(
    'Sensibilidade',
    [
      { value: 'auto', label: 'Automática · aprende o ruído do ambiente' },
      { value: 'manual', label: 'Manual · limite em dBFS' }
    ],
    voiceAudioPreferences.voiceDetectionMode,
    value => void updateVoiceAudioPreferences({ voiceDetectionMode: value as VoiceDetectionMode }, true),
    !voiceAudioPreferences.voiceDetection
  ));

  if (voiceAudioPreferences.voiceDetection && voiceAudioPreferences.voiceDetectionMode === 'manual') {
    detection.append(settingsRange(
      'Limite manual',
      -60,
      -20,
      Math.round(voiceAudioPreferences.manualThresholdDb),
      1,
      ' dBFS',
      value => void updateVoiceAudioPreferences({ manualThresholdDb: value })
    ));
    detection.append(el('p', 'settings-note', 'Mais perto de −20 dBFS = precisa falar mais alto para abrir. Mais perto de −60 dBFS = capta fala mais baixa, mas deixa mais ruído passar.'));
  } else if (voiceAudioPreferences.voiceDetection) {
    const diagnostic = voice.microphoneDiagnostic;
    detection.append(el('p', 'settings-note', diagnostic
      ? `Automático agora: piso de ruído ${diagnostic.noiseFloorDb.toFixed(1)} dBFS · abertura ${diagnostic.thresholdDb.toFixed(1)} dBFS.`
      : 'No modo automático o limite é calculado continuamente a partir do piso de ruído do ambiente. Ele começa a aprender assim que você entra na chamada.'));
  }

  const sounds = el('section', 'settings-section');
  sounds.append(el('h3', '', 'Sons da interface'));
  sounds.append(settingsCheckbox(
    'Ativar sons da interface',
    'Controla mensagens, saídas e avisos de transmissão. Não interfere no áudio da chamada.',
    uiSoundPreferences.enabled,
    checked => updateUiSoundPreferences({ enabled: checked })
  ));
  sounds.append(settingsRange('Volume geral dos efeitos', 0, 100, uiSoundPreferences.masterVolume, 1, '%', value => updateUiSoundPreferences({ masterVolume: value })));

  const reset = el('section', 'settings-section');
  reset.append(el('h3', '', 'Restaurar'));
  const resetProcessing = el('button', 'secondary-button settings-reset-button', 'Restaurar processamento de voz');
  resetProcessing.type = 'button';
  resetProcessing.addEventListener('click', () => void restoreVoiceAudioPreferences());
  const resetSounds = el('button', 'secondary-button settings-reset-button', 'Restaurar sons padrão');
  resetSounds.type = 'button';
  resetSounds.addEventListener('click', () => {
    uiSoundPreferences = uiSounds.reset();
    renderSettingsDialog();
  });
  const buttons = el('div', 'settings-button-row');
  buttons.append(resetProcessing, resetSounds);
  reset.append(buttons);

  group.append(microphone, detection, sounds, reset);
  return group;
}

function renderNotificationSettings(): HTMLElement {
  const group = el('div', 'settings-page-sections');
  const section = el('section', 'settings-section settings-section-first');
  section.append(el('h3', '', 'Eventos com som'));
  section.append(
    soundEventSetting('messageReceived', 'Mensagem recebida', 'Toca somente quando outra pessoa envia uma mensagem de usuário.'),
    soundEventSetting('voiceLeave', 'Saída do canal de voz', 'Toca quando outro participante sai do canal de voz em que você continua conectado.'),
    soundEventSetting('serverLeave', 'Saída do servidor', 'Toca quando outro participante permanece desconectado do servidor após uma pequena tolerância contra quedas rápidas.'),
    soundEventSetting('screenStart', 'Começou a transmitir', 'Toca para quem já está na chamada quando uma transmissão de tela começa.'),
    soundEventSetting('screenStop', 'Parou de transmitir', 'Toca para quem continua na chamada quando a transmissão de tela termina.')
  );
  group.append(section);
  return group;
}

function renderAppearanceSettings(): HTMLElement {
  const group = el('div', 'settings-page-sections');

  const appearance = el('section', 'settings-section settings-section-first');
  appearance.append(el('h3', '', 'Tema do cliente'));

  const colorField = el('div', 'settings-field');
  colorField.append(el('label', '', 'Cor base'));
  const customRow = el('div', 'theme-color-custom-row');
  const color = document.createElement('input');
  color.type = 'color';
  color.value = clientPreferences.backgroundColor;
  color.setAttribute('aria-label', 'Cor de fundo personalizada');
  color.addEventListener('input', () => updateClientPreferences({ backgroundColor: color.value }));
  customRow.append(color, el('span', 'settings-note-inline', 'Escolha livremente ou use um preset.'));
  colorField.append(customRow, renderColorPresetMenu(THEME_PRESETS, clientPreferences.backgroundColor, value => {
    color.value = value;
    updateClientPreferences({ backgroundColor: value });
  }));
  appearance.append(colorField);

  const overlay = el('label', 'settings-check');
  const overlayInput = document.createElement('input');
  overlayInput.type = 'checkbox';
  overlayInput.checked = clientPreferences.overlay;
  overlayInput.addEventListener('change', () => updateClientPreferences({ overlay: overlayInput.checked }));
  const overlayCopy = el('span');
  overlayCopy.append(el('strong', '', 'Modo semi-transparente (Overlay)'), el('small', '', 'Deixa os painéis translúcidos. Em Chromium, backdrop-filter é usado para o blur.'));
  overlay.append(overlayInput, overlayCopy);
  appearance.append(overlay);
  appearance.append(settingsRange('Opacidade do overlay', 45, 95, Math.round(clientPreferences.overlayOpacity * 100), 1, '%', value => updateClientPreferences({ overlayOpacity: value / 100 })));
  appearance.append(settingsRange('Blur dos painéis', 0, 32, Math.round(clientPreferences.panelBlur), 1, ' px', value => updateClientPreferences({ panelBlur: value })));
  appearance.append(settingsRange('Tamanho da interface', 80, 135, Math.round(clientPreferences.uiScale * 100), 5, '%', value => updateClientPreferences({ uiScale: value / 100 })));

  const speaking = el('section', 'settings-section');
  speaking.append(
    el('h3', '', 'Luz de quem está falando'),
    el('p', 'settings-note', 'Essa preferência é local: você escolhe como o destaque de qualquer participante falando aparece no seu navegador.')
  );
  const speakingColorField = el('div', 'settings-field');
  speakingColorField.append(el('label', '', 'Cor do brilho'));
  const speakingCustom = el('div', 'theme-color-custom-row');
  const speakingColor = document.createElement('input');
  speakingColor.type = 'color';
  speakingColor.value = clientPreferences.speakingColor;
  speakingColor.setAttribute('aria-label', 'Cor da borda de quem está falando');
  speakingColor.addEventListener('input', () => updateClientPreferences({ speakingColor: speakingColor.value }));
  speakingCustom.append(speakingColor, el('span', 'settings-note-inline', 'Aplicada aos cards, avatares e lista do canal de voz.'));
  speakingColorField.append(speakingCustom, renderColorPresetMenu(SPEAKING_PRESETS, clientPreferences.speakingColor, value => {
    speakingColor.value = value;
    updateClientPreferences({ speakingColor: value });
  }));
  speaking.append(speakingColorField);
  speaking.append(settingsRange('Intensidade do brilho', 0, 100, Math.round(clientPreferences.speakingGlow * 100), 1, '%', value => updateClientPreferences({ speakingGlow: value / 100 })));

  const preview = el('div', 'speaking-preview speaking');
  preview.append(renderAvatar(getState().session?.displayName ?? 'Você', 'voice-avatar'));
  const previewCopy = el('div', 'speaking-preview-copy');
  previewCopy.append(el('strong', '', 'Prévia do destaque'), el('span', '', 'A cor e intensidade mudam em tempo real.'));
  preview.append(previewCopy);
  speaking.append(preview);

  const reset = el('button', 'secondary-button settings-reset-button', 'Restaurar aparência');
  reset.type = 'button';
  reset.addEventListener('click', () => {
    clientPreferences = resetClientPreferences();
    lastMainRenderSignature = '';
    scheduleRender();
    renderSettingsDialog();
  });
  speaking.append(reset);

  group.append(appearance, speaking);
  return group;
}

function renderColorPresetMenu(
  presets: ReadonlyArray<{ name: string; color: string }>,
  current: string,
  onSelect: (value: string) => void
): HTMLElement {
  const menu = el('div', 'color-preset-menu');
  for (const preset of presets) {
    const button = el('button', `color-preset-swatch${preset.color.toLowerCase() === current.toLowerCase() ? ' active' : ''}`);
    button.type = 'button';
    button.title = `${preset.name} — ${preset.color}`;
    button.setAttribute('aria-label', button.title);
    button.style.setProperty('--preset-color', preset.color);
    button.append(el('span', 'color-preset-dot'), el('span', 'color-preset-name', preset.name));
    button.addEventListener('click', () => onSelect(preset.color));
    menu.append(button);
  }
  return menu;
}

function soundEventSetting(event: UiSoundEvent, title: string, description: string): HTMLElement {
  const preference = uiSoundPreferences.events[event];
  const row = el('div', 'sound-event-card');
  const top = el('div', 'sound-event-head');
  const enabled = document.createElement('input');
  enabled.type = 'checkbox';
  enabled.checked = preference.enabled;
  enabled.setAttribute('aria-label', `Ativar som: ${title}`);
  enabled.addEventListener('change', () => setUiSoundEventPreference(event, { enabled: enabled.checked }));
  const copy = el('div', 'sound-event-copy');
  copy.append(el('strong', '', title), el('span', '', description));
  top.append(enabled, copy);
  row.append(top);

  const controls = el('div', 'sound-event-controls');
  const selectField = el('label', 'sound-select-field');
  selectField.append(el('span', '', 'Som'));
  const select = document.createElement('select');
  for (const soundId of EVENT_SOUND_OPTIONS[event]) {
    const definition = UI_SOUND_LIBRARY[soundId];
    const option = document.createElement('option');
    option.value = soundId;
    option.textContent = definition.label;
    option.selected = soundId === preference.soundId;
    select.append(option);
  }
  select.addEventListener('change', () => setUiSoundEventPreference(event, { soundId: select.value as any }));
  selectField.append(select);

  const preview = el('button', 'secondary-button sound-preview-button', 'Testar');
  preview.type = 'button';
  preview.addEventListener('click', () => uiSounds.preview(event));
  controls.append(selectField, preview);
  row.append(controls);
  row.append(settingsRange('Volume deste evento', 0, 100, preference.volume, 1, '%', value => setUiSoundEventPreference(event, { volume: value })));
  return row;
}

function settingsCheckbox(title: string, description: string, checked: boolean, onChange: (checked: boolean) => void): HTMLElement {
  const label = el('label', 'settings-check');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  const copy = el('span');
  copy.append(el('strong', '', title), el('small', '', description));
  label.append(input, copy);
  return label;
}

function updateUiSoundPreferences(patch: Partial<Pick<UiSoundPreferences, 'enabled' | 'masterVolume'>>): void {
  uiSoundPreferences = uiSounds.setPreferences({ ...uiSoundPreferences, ...patch });
}

function setUiSoundEventPreference(event: UiSoundEvent, patch: Partial<UiSoundPreferences['events'][UiSoundEvent]>): void {
  uiSoundPreferences = uiSounds.setPreferences({
    ...uiSoundPreferences,
    events: {
      ...uiSoundPreferences.events,
      [event]: { ...uiSoundPreferences.events[event], ...patch }
    }
  });
}


function settingsChoice(
  labelText: string,
  options: ReadonlyArray<{ value: string; label: string }>,
  value: string,
  onChange: (value: string) => void,
  disabled = false
): HTMLElement {
  const field = el('label', 'settings-field settings-choice-field');
  field.append(el('span', 'settings-choice-label', labelText));
  const select = document.createElement('select');
  select.disabled = disabled;
  for (const option of options) {
    const item = document.createElement('option');
    item.value = option.value;
    item.textContent = option.label;
    item.selected = option.value === value;
    select.append(item);
  }
  select.addEventListener('change', () => onChange(select.value));
  field.append(select);
  return field;
}

async function updateVoiceAudioPreferences(patch: Partial<VoiceAudioPreferences>, rerender = false): Promise<void> {
  const previous = voiceAudioPreferences;
  const next = sanitizeVoiceAudioPreferences({ ...voiceAudioPreferences, ...patch });
  try {
    await voice.applyAudioPreferences(next);
    voiceAudioPreferences = saveVoiceAudioPreferences(next);
    if (rerender) renderSettingsDialog();
  } catch {
    voiceAudioPreferences = previous;
    if (rerender) renderSettingsDialog();
  }
}

async function restoreVoiceAudioPreferences(): Promise<void> {
  const previous = voiceAudioPreferences;
  const defaults = resetVoiceAudioPreferences();
  try {
    await voice.applyAudioPreferences(defaults);
    voiceAudioPreferences = saveVoiceAudioPreferences(defaults);
  } catch {
    voiceAudioPreferences = saveVoiceAudioPreferences(previous);
  }
  renderSettingsDialog();
}


function settingsRange(
  labelText: string,
  min: number,
  max: number,
  value: number,
  step: number,
  suffix: string,
  onInput: (value: number) => void
): HTMLElement {
  const field = el('div', 'settings-field');
  const head = el('div', 'settings-range-head');
  const label = el('label', '', labelText);
  const output = el('output', 'range-value', `${value}${suffix}`);
  head.append(label, output);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.addEventListener('input', () => {
    const next = Number(input.value);
    output.textContent = `${next}${suffix}`;
    onInput(next);
  });
  field.append(head, input);
  return field;
}

function updateClientPreferences(patch: Partial<ClientPreferences>): void {
  clientPreferences = saveClientPreferences({ ...clientPreferences, ...patch });
}

function openEntryDialog(mode: 'join' | 'create', server?: ServerInfo): void {
  entryMode = mode;
  entryTargetServer = server;
  renderEntryDialog();
  if (!entryDialog.open) entryDialog.showModal();
}

function renderEntryDialog(): void {
  entryDialog.replaceChildren();
  const card = el('div', 'modal-card');
  const isCreate = entryMode === 'create';
  const head = el('div', 'entry-dialog-head');
  const headCopy = el('div');
  headCopy.append(el('h2', '', isCreate ? 'Criar servidor local' : `Entrar em ${entryTargetServer?.name ?? 'servidor'}`));
  headCopy.append(el('p', '', isCreate
    ? 'O servidor ficará hospedado neste computador e poderá ser acessado pela LAN ou Hamachi.'
    : 'Escolha um nome. Ele precisa ser único entre os participantes ativos deste servidor.'));
  const close = el('button', 'icon-button', '×');
  close.type = 'button';
  close.title = 'Fechar';
  close.setAttribute('aria-label', 'Fechar janela');
  close.addEventListener('click', () => {
    entryDialog.close();
    if (!getState().server) renderLanding();
  });
  head.append(headCopy, close);
  card.append(head);

  const form = el('form', 'form-grid');
  const error = el('div', 'form-error');

  let serverInput: HTMLInputElement | undefined;
  if (isCreate) {
    serverInput = textField(form, 'Nome do servidor', 'Ex.: Madrugada', 64, 'server-name');
  }
  const nameInput = textField(form, isCreate ? 'Seu nome' : 'Nome', 'Ex.: Uriel', 32, 'user-name');
  const passwordInput = document.createElement('input');
  passwordInput.type = 'password';
  passwordInput.autocomplete = isCreate ? 'new-password' : 'current-password';
  passwordInput.maxLength = 128;
  passwordInput.placeholder = isCreate ? 'Opcional · mínimo de 8 caracteres' : 'Senha do servidor';
  const passwordField = el('label', 'field');
  passwordField.append(el('span', '', isCreate ? 'Senha do servidor (opcional)' : 'Senha do servidor'), passwordInput);
  if (isCreate || entryTargetServer?.passwordProtected) form.append(passwordField);

  if (!isCreate && entryTargetServer) {
    const code = el('span', 'badge', `Convite ${entryTargetServer.inviteCode}`);
    form.append(code);
  }
  form.append(error);

  const actions = el('div', 'form-actions');
  if (!isCreate && (getState().bootstrap?.servers.length ?? 0) > 0) {
    const cancel = el('button', 'secondary-button', 'Cancelar');
    cancel.type = 'button';
    cancel.addEventListener('click', () => entryDialog.close());
    actions.append(cancel);
  }
  const submit = el('button', 'primary-button', isCreate ? 'Criar' : 'Entrar');
  submit.type = 'submit';
  actions.append(submit);
  form.append(actions);

  form.addEventListener('submit', async event => {
    event.preventDefault();
    error.textContent = '';
    submit.setAttribute('disabled', '');
    try {
      if (isCreate) {
        const result = await api.createServer(serverInput!.value, nameInput.value, '', passwordInput.value);
        const bootstrap = await api.bootstrap();
        updateState({ bootstrap });
        activateServer(result.server, result.channels, result.session);
      } else if (entryTargetServer) {
        const stored = readStoredSession(entryTargetServer.id);
        const result = await api.joinServer(entryTargetServer.id, nameInput.value, stored?.displayName === nameInput.value ? stored.token : undefined, passwordInput.value);
        activateServer(result.server, result.channels, result.session);
      }
    } catch (err) {
      error.textContent = errorMessage(err);
    } finally {
      submit.removeAttribute('disabled');
    }
  });

  card.append(form);
  entryDialog.append(card);
  requestAnimationFrame(() => (serverInput ?? nameInput).focus());
}

function openChannelDialog(type: 'text' | 'voice'): void {
  const state = getState();
  if (!state.server || !state.session) return;
  channelDialog.replaceChildren();
  const card = el('div', 'modal-card');
  card.append(el('h2', '', type === 'text' ? 'Criar canal de texto' : 'Criar canal de voz'));
  card.append(el('p', '', 'O canal será criado neste servidor e ficará salvo no host.'));
  const form = el('form', 'form-grid');
  const input = textField(form, 'Nome do canal', type === 'text' ? 'jogos' : 'Jogando', 48, 'channel-name');
  const error = el('div', 'form-error');
  form.append(error);
  const actions = el('div', 'form-actions');
  const cancel = el('button', 'secondary-button', 'Cancelar');
  cancel.type = 'button';
  cancel.addEventListener('click', () => channelDialog.close());
  const submit = el('button', 'primary-button', 'Criar');
  submit.type = 'submit';
  actions.append(cancel, submit);
  form.append(actions);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    try {
      await api.createChannel(state.server!.id, state.session!.token, input.value, type);
      await refreshChannels();
      channelDialog.close();
    } catch (err) {
      error.textContent = errorMessage(err);
    }
  });
  card.append(form);
  channelDialog.append(card);
  channelDialog.showModal();
  requestAnimationFrame(() => input.focus());
}

async function deleteCurrentServer(): Promise<void> {
  const state = getState();
  if (!state.server || !state.session || state.session.role !== 'owner') return;
  const typed = window.prompt(`Esta ação apaga o servidor, canais, mensagens e arquivos enviados.\n\nDigite exatamente o nome do servidor para confirmar:\n${state.server.name}`);
  if (typed !== state.server.name) {
    if (typed !== null) toast('Nome diferente. O servidor não foi excluído.', true);
    return;
  }
  try {
    await api.deleteServer(state.server.id, state.session.token);
    await handleDeletedServer(state.server.id);
  } catch (error) {
    toast(errorMessage(error), true);
  }
}

async function deleteChannel(channel: ChannelInfo): Promise<void> {
  const state = getState();
  if (!state.session || state.session.role !== 'owner') return;
  if (!window.confirm(`Excluir o canal ${channel.type === 'text' ? '#' : '◖'} ${channel.name}? O histórico e arquivos desse canal também serão apagados.`)) return;
  try {
    if (state.voice.joinedChannelId === channel.id) {
      toast('Saia deste canal de voz antes de excluí-lo.', true);
      return;
    }
    const wasActive = state.activeChannel?.id === channel.id;
    await api.deleteChannel(channel.id, state.session.token);
    await refreshChannels();
    if (wasActive && getState().activeChannel) {
      await selectChannel(getState().activeChannel!);
    }
    toast(`Canal ${channel.name} excluído.`);
  } catch (error) {
    toast(errorMessage(error), true);
  }
}

async function deleteMessage(message: MessageInfo): Promise<void> {
  const state = getState();
  if (!state.session || state.session.role !== 'owner') return;
  if (!window.confirm(`Apagar esta mensagem de ${message.authorName}${message.attachment ? ` e o arquivo ${message.attachment.originalName}` : ''}?`)) return;
  try {
    await api.deleteMessage(message.id, state.session.token);
    removeMessage(message.id);
  } catch (error) {
    toast(errorMessage(error), true);
  }
}

async function handleDeletedServer(serverId: string): Promise<void> {
  localStorage.removeItem(sessionStorageKey(serverId));
  const current = getState().server?.id === serverId;
  if (current) {
    realtime.stop();
    await voice.leave().catch(() => {});
    lastMainRenderSignature = '';
    updateState({
      server: undefined, session: undefined, channels: [], activeChannel: undefined,
      messages: [], presence: [], typing: new Set()
    });
  }
  try {
    const bootstrap = await api.bootstrap();
    updateState({ bootstrap });
    if (current) {
      if (bootstrap.servers.length === 0) openEntryDialog('create');
      else renderLanding();
    }
  } catch (error) {
    if (current) toast(errorMessage(error), true);
  }
}

async function toggleMemberRole(name: string, role: 'moderator' | 'member'): Promise<void> {
  const state = getState();
  if (!state.server || !state.session) return;
  try {
    await api.setRole(state.server.id, state.session.token, name, role);
    toast(`${name} agora é ${roleLabel(role)}.`);
  } catch (error) {
    toast(errorMessage(error), true);
  }
}

async function copyInvite(server: ServerInfo): Promise<void> {
  const url = `${location.origin}/?invite=${encodeURIComponent(server.inviteCode)}`;
  try {
    await navigator.clipboard.writeText(url);
    toast(`Convite copiado: ${server.inviteCode}`);
  } catch {
    toast(`Código de convite: ${server.inviteCode}`);
  }
}

function textField(form: HTMLElement, labelText: string, placeholder: string, maxLength: number, id: string): HTMLInputElement {
  const field = el('div', 'field');
  const label = el('label', '', labelText);
  label.htmlFor = id;
  const input = document.createElement('input');
  input.id = id;
  input.type = 'text';
  input.maxLength = maxLength;
  input.placeholder = placeholder;
  input.autocomplete = 'off';
  input.required = true;
  field.append(label, input);
  form.append(field);
  return input;
}

function cardText(title: string, description: string): HTMLElement {
  const card = el('div', 'empty-state-card');
  card.append(el('h2', '', title), el('p', '', description));
  return card;
}

function toast(message: string, error = false): void {
  const item = el('div', `toast${error ? ' error' : ''}`, message);
  toasts.append(item);
  window.setTimeout(() => item.remove(), 4200);
}

function patchTypingIndicator(typing: HTMLElement): void {
  const state = getState();
  const channelId = typing.dataset.channelId;
  if (!channelId || state.activeChannel?.id !== channelId) return;
  const typers = [...state.typing].filter(name => name !== state.session?.displayName);
  typing.textContent = typers.length === 1
    ? `${typers[0]} está digitando…`
    : typers.length > 1
      ? `${typers.slice(0, 2).join(' e ')} estão digitando…`
      : '';
}

function scrollMessagesToBottom(): void {
  const messages = document.querySelector<HTMLElement>('#messages');
  if (!messages) return;
  messages.scrollTop = messages.scrollHeight;
  scrollPinned = true;
}

function captureMessageScrollState(): MessageScrollSnapshot | undefined {
  const messages = mainEl.querySelector<HTMLElement>('#messages');
  const channelId = messages?.dataset.channelId;
  if (!messages || !channelId) return undefined;
  return {
    channelId,
    scrollTop: messages.scrollTop,
    scrollHeight: messages.scrollHeight,
    clientHeight: messages.clientHeight,
    pinned: isMessageScrollPinned(messages.scrollHeight, messages.scrollTop, messages.clientHeight)
  };
}

function restoreMessageScrollState(
  messages: HTMLElement,
  snapshot: MessageScrollSnapshot | undefined,
  channelId: string
): void {
  requestAnimationFrame(() => {
    if (!messages.isConnected) return;
    messages.scrollTop = nextMessageScrollTop(snapshot, channelId, messages.scrollHeight, messages.clientHeight);
    scrollPinned = isMessageScrollPinned(messages.scrollHeight, messages.scrollTop, messages.clientHeight);
  });
}

function captureVoiceScrollState(): PanelScrollSnapshot | undefined {
  const stage = mainEl.querySelector<HTMLElement>('.voice-stage');
  const channelId = stage?.dataset.channelId;
  if (!stage || !channelId) return undefined;
  return {
    key: channelId,
    scrollTop: stage.scrollTop,
    scrollHeight: stage.scrollHeight,
    clientHeight: stage.clientHeight,
    pinnedToBottom: isPanelNearBottom(stage.scrollHeight, stage.scrollTop, stage.clientHeight)
  };
}

function restoreVoiceScrollState(
  stage: HTMLElement,
  snapshot: PanelScrollSnapshot | undefined,
  channelId: string
): void {
  // Restauração síncrona: um callback tardio não pode sobrescrever o scroll
  // que o usuário acabou de iniciar depois do rerender.
  stage.scrollTop = nextPanelScrollTop(snapshot, channelId, stage.scrollHeight, stage.clientHeight);
}

interface ComposerStateSnapshot {
  channelId?: string;
  value: string;
  focused: boolean;
  selectionStart: number;
  selectionEnd: number;
}

function captureComposerState(): ComposerStateSnapshot | undefined {
  const area = mainEl.querySelector<HTMLTextAreaElement>('.composer textarea');
  if (!area) return undefined;
  const channelId = area.dataset.channelId;
  if (channelId) chatDrafts.set(channelId, area.value);
  return {
    channelId,
    value: area.value,
    focused: document.activeElement === area,
    selectionStart: area.selectionStart ?? area.value.length,
    selectionEnd: area.selectionEnd ?? area.value.length
  };
}

function restoreComposerState(area: HTMLTextAreaElement, snapshot: ComposerStateSnapshot | undefined, channelId: string): void {
  if (!snapshot || snapshot.channelId !== channelId || !snapshot.focused) return;
  requestAnimationFrame(() => {
    if (!area.isConnected || area.disabled) return;
    area.focus({ preventScroll: true });
    const length = area.value.length;
    area.setSelectionRange(Math.min(snapshot.selectionStart, length), Math.min(snapshot.selectionEnd, length));
  });
}

function autoGrow(textarea: HTMLTextAreaElement): void {
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.min(160, textarea.scrollHeight)}px`;
}

function roleLabel(role: string): string {
  return role === 'owner' ? 'Dono' : role === 'moderator' ? 'Moderador' : 'Membro';
}

function formatTime(value: string): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(date);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return `${parts[0]?.[0] ?? ''}${parts.length > 1 ? parts.at(-1)?.[0] ?? '' : ''}`.toLocaleUpperCase('pt-BR');
}

function readStoredSession(serverId: string): { token: string; displayName: string } | undefined {
  try {
    const raw = localStorage.getItem(sessionStorageKey(serverId));
    if (!raw) return undefined;
    const value = JSON.parse(raw);
    if (typeof value.token !== 'string' || typeof value.displayName !== 'string') return undefined;
    return value;
  } catch {
    return undefined;
  }
}

function sessionStorageKey(serverId: string): string { return `verdant.session.${serverId}`; }

function errorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return 'Erro desconhecido.';
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function must<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Elemento ausente: ${selector}`);
  return node;
}
