import { formatRemoteVolumeLabel } from './remote-playback-boost.js';
import { isMemberScreenSharing, renderScreenControls, renderScreenStage } from './screen-ui.js';
import { getState } from './state.js';
import type { ChannelInfo, VoiceMemberInfo } from './types.js';
import type { VoiceController } from './voice.js';

export interface VoiceUiOptions {
  renderAvatar: (displayName: string, className: string) => HTMLElement;
}

export function renderVoicePanel(channel: ChannelInfo, voice: VoiceController, options: VoiceUiOptions): HTMLElement {
  const state = getState();
  const wrapper = el('section', 'voice-stage');
  wrapper.dataset.channelId = channel.id;
  const top = el('div', 'voice-stage-top');
  const title = el('div', 'voice-stage-title');
  title.append(el('h2', '', `◖ ${channel.name}`));
  const channelMembers = state.voice.members.filter(member => member.channelId === channel.id);
  title.append(el('span', 'badge', `${channelMembers.length}/6 na chamada`));
  top.append(title);

  const actions = el('div', 'voice-toolbar');
  const joinedHere = state.voice.joinedChannelId === channel.id;
  const joinedAnotherServer = Boolean(state.voice.joinedServerId && state.voice.joinedServerId !== channel.serverId);
  if (!joinedHere) {
    const join = el('button', 'primary-button', joinedAnotherServer
      ? `Sair de ${state.voice.joinedServerName ?? 'outra chamada'} e entrar aqui`
      : state.voice.joinedChannelId ? 'Mover para este canal' : 'Entrar na chamada');
    join.type = 'button';
    join.disabled = state.voice.status === 'joining' || state.wsStatus !== 'connected';
    join.addEventListener('click', () => void voice.resumePlayback().then(() => voice.join(channel.id)));
    actions.append(join);
  } else {
    const leave = el('button', 'secondary-button danger-button', 'Sair da chamada');
    leave.type = 'button';
    leave.addEventListener('click', () => void voice.leave());
    actions.append(leave);
  }
  top.append(actions);
  wrapper.append(top);

  if (joinedAnotherServer) {
    const persistent = el('div', 'voice-notice ok');
    persistent.append(
      el('strong', '', `Você continua em voz em ${state.voice.joinedServerName ?? 'outro servidor'}`),
      el('span', '', 'Navegue e leia este servidor sem abandonar sua chamada atual.')
    );
    wrapper.append(persistent);
  }

  if (!state.bootstrap?.media?.enabled) {
    const warning = el('div', 'voice-notice error');
    warning.append(el('strong', '', 'SFU indisponível'), el('span', '', 'O host iniciou com a mídia desativada. Reinicie sem MEDIA_DISABLED=1.'));
    wrapper.append(warning);
  } else if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    const warning = el('div', 'voice-notice warn');
    warning.append(el('strong', '', 'HTTPS necessário para microfone remoto'), el('span', '', 'localhost pode usar HTTP, mas outro computador precisa abrir o Verdant por HTTPS com o certificado do host confiável.'));
    wrapper.append(warning);
  }

  if (state.voice.status === 'error' && state.voice.lastError) {
    const warning = el('div', 'voice-notice error');
    warning.append(el('strong', '', 'Falha na chamada'), el('span', '', state.voice.lastError));
    wrapper.append(warning);
  }

  if (joinedHere && (state.voice.screen.localActive || state.voice.screen.remotes.length)) {
    wrapper.append(renderScreenStage(voice));
  }

  const cards = el('div', 'voice-members-grid');
  if (channelMembers.length === 0) {
    const empty = el('div', 'voice-empty');
    empty.append(el('div', 'voice-empty-icon', '◖'), el('h3', '', 'Canal vazio'), el('p', '', 'Entre na chamada para começar a conversar.'));
    cards.append(empty);
  } else {
    for (const member of channelMembers) cards.append(renderVoiceMemberCard(member, voice, options));
  }
  wrapper.append(cards);

  if (joinedHere) wrapper.append(renderVoiceControlPanel(voice));
  return wrapper;
}

export function patchVoiceDynamicState(root: ParentNode, voice: VoiceController): void {
  const state = getState();
  const line = root.querySelector<HTMLElement>('.voice-connection-line');
  if (line) line.replaceWith(renderVoiceConnectionLine());

  for (const card of root.querySelectorAll<HTMLElement>('.voice-member-card[data-member-name]')) {
    const displayName = card.dataset.memberName;
    if (!displayName) continue;
    const member = state.voice.members.find(item => item.displayName === displayName);
    if (!member) continue;

    const speaking = isVoiceMemberSpeaking(member);
    card.classList.toggle('speaking', speaking);

    const avatar = card.querySelector<HTMLElement>('.voice-avatar');
    if (avatar) {
      if (speaking) avatar.setAttribute('aria-label', `${member.displayName} está falando`);
      else avatar.removeAttribute('aria-label');
    }

    const status = card.querySelector<HTMLElement>('.voice-member-status');
    if (status) status.replaceWith(renderVoiceMemberStatus(member, speaking));

    const localMute = card.querySelector<HTMLButtonElement>('button[data-local-mute-name]');
    if (localMute) {
      const locallyMuted = voice.isLocallyMuted(member.displayName);
      localMute.textContent = locallyMuted ? '🔈' : '🔇';
      localMute.title = locallyMuted ? `Ouvir ${member.displayName}` : `Mutar ${member.displayName} só para mim`;
      localMute.setAttribute('aria-label', localMute.title);
    }
  }
}

function renderVoiceMemberCard(member: VoiceMemberInfo, voice: VoiceController, options: VoiceUiOptions): HTMLElement {
  const state = getState();
  const self = member.displayName === state.session?.displayName;
  const effectiveRole = state.presence.find(item => item.displayName === member.displayName)?.role ?? member.role;
  const speaking = isVoiceMemberSpeaking(member);
  const card = el('article', `voice-member-card${speaking ? ' speaking' : ''}`);
  card.dataset.memberName = member.displayName;
  const avatar = options.renderAvatar(member.displayName, 'voice-avatar');
  if (speaking) avatar.setAttribute('aria-label', `${member.displayName} está falando`);
  const meta = el('div', 'voice-member-meta');
  meta.append(el('strong', '', member.displayName), el('span', '', roleLabel(effectiveRole)));
  meta.append(renderVoiceMemberStatus(member, speaking));
  card.append(avatar, meta);

  if (!self) {
    const controls = el('div', 'voice-card-controls');

    const volume = el('label', 'voice-member-volume');
    const currentVolume = voice.getLocalVolume(member.displayName);
    const volumeValue = el('span', `voice-member-volume-value${currentVolume > 100 ? ' boosted' : ''}`, formatRemoteVolumeLabel(currentVolume));
    const volumeSlider = document.createElement('input');
    volumeSlider.type = 'range';
    volumeSlider.min = '0';
    volumeSlider.max = '200';
    volumeSlider.step = '1';
    volumeSlider.value = String(currentVolume);
    volumeSlider.dataset.localVolumeName = member.displayName;
    volumeSlider.setAttribute('aria-label', `Volume de ${member.displayName}`);
    volumeSlider.title = `Volume de ${member.displayName} só para você · acima de 100% usa boost local`;
    volumeSlider.addEventListener('input', () => {
      const next = Number(volumeSlider.value);
      voice.setLocalVolume(member.displayName, next);
      volumeValue.textContent = formatRemoteVolumeLabel(next);
      volumeValue.classList.toggle('boosted', next > 100);
    });
    volume.append(el('span', 'voice-member-volume-label', 'Volume'), volumeSlider, volumeValue);
    controls.append(volume);

    const localMuted = voice.isLocallyMuted(member.displayName);
    const local = el('button', 'icon-button', localMuted ? '🔈' : '🔇');
    local.type = 'button';
    local.dataset.localMuteName = member.displayName;
    local.title = localMuted ? `Ouvir ${member.displayName}` : `Mutar ${member.displayName} só para mim`;
    local.setAttribute('aria-label', local.title);
    local.addEventListener('click', () => void voice.resumePlayback().then(() => voice.setLocalMuted(member.displayName, !voice.isLocallyMuted(member.displayName))));
    controls.append(local);

    const canAdminMute = state.session?.role === 'owner' || (state.session?.role === 'moderator' && effectiveRole !== 'owner');
    if (canAdminMute) {
      const admin = el('button', `icon-button${member.adminMuted ? ' active danger' : ''}`, '⚑');
      admin.type = 'button';
      admin.title = member.adminMuted ? 'Remover mute administrativo' : 'Mutar no servidor';
      admin.setAttribute('aria-label', `${admin.title}: ${member.displayName}`);
      admin.addEventListener('click', () => void voice.adminMute(member.displayName, !member.adminMuted));
      controls.append(admin);
    }
    card.append(controls);
  }
  return card;
}

function isVoiceMemberSpeaking(member: VoiceMemberInfo): boolean {
  return getState().voice.speaking.has(member.displayName) && !member.selfMuted && !member.adminMuted;
}

function renderVoiceMemberStatus(member: VoiceMemberInfo, speaking = isVoiceMemberSpeaking(member)): HTMLElement {
  const status = el('div', 'voice-member-status');
  if (speaking) status.append(el('span', 'voice-status talking', 'Falando'));
  if (member.selfMuted) status.append(el('span', 'voice-status', '⌁ Mutado'));
  if (member.adminMuted) status.append(el('span', 'voice-status danger', '⌁ Mutado pelo servidor'));
  if (member.deafened) status.append(el('span', 'voice-status', '◉ Ensurdecido'));
  if (isMemberScreenSharing(member.displayName)) status.append(el('span', 'voice-status screen', '▣ Transmitindo'));
  if (!member.selfMuted && !member.adminMuted && !member.deafened && !speaking) {
    status.append(el('span', 'voice-status', 'Microfone ativo'));
  }
  return status;
}

function renderVoiceConnectionLine(): HTMLElement {
  const state = getState();
  const status = el('div', 'voice-connection-line');
  status.append(
    el('span', `status-dot ${state.voice.status === 'connected' ? 'connected' : 'connecting'}`),
    el('strong', '', voiceStatusLabel(state.voice.status)),
    el('span', '', state.voice.transportState ?? '')
  );
  if (typeof state.voice.mediaRtt === 'number') status.append(el('span', 'badge', `${state.voice.mediaRtt} ms mídia`));
  if (typeof state.rtt === 'number') status.append(el('span', 'badge', `${state.rtt} ms sinalização`));
  return status;
}

function renderVoiceControlPanel(voice: VoiceController): HTMLElement {
  const state = getState();
  const panel = el('section', 'voice-control-panel');
  panel.append(renderVoiceConnectionLine());

  const primary = el('div', 'voice-big-controls');
  const mic = el('button', `voice-action${state.voice.muted || state.voice.adminMuted ? ' active danger' : ''}`);
  mic.type = 'button';
  mic.append(el('span', 'voice-action-icon', state.voice.muted || state.voice.adminMuted ? '⌁' : '🎙'), el('span', '', state.voice.adminMuted ? 'Mutado pelo servidor' : state.voice.muted ? 'Microfone desligado' : 'Microfone ligado'));
  mic.disabled = state.voice.adminMuted;
  mic.addEventListener('click', () => void voice.resumePlayback().then(() => voice.toggleMute()));

  const deafen = el('button', `voice-action${state.voice.deafened ? ' active danger' : ''}`);
  deafen.type = 'button';
  deafen.append(el('span', 'voice-action-icon', '🎧'), el('span', '', state.voice.deafened ? 'Ensurdecido' : 'Áudio ativo'));
  deafen.addEventListener('click', () => void voice.resumePlayback().then(() => voice.toggleDeafen()));

  const globalMute = el('button', `voice-action global-voice-toggle${state.voice.muted || state.voice.adminMuted ? ' active danger' : ''}`);
  globalMute.type = 'button';
  globalMute.title = state.voice.adminMuted
    ? 'Seu microfone está silenciado por um moderador'
    : state.voice.muted
      ? 'Clique para todos voltarem a ouvir você'
      : 'Clique para ninguém mais ouvir você';
  globalMute.setAttribute('aria-label', globalMute.title);
  globalMute.disabled = state.voice.adminMuted;
  globalMute.append(globeIcon(), el('span', '', state.voice.adminMuted ? 'Silenciado pelo servidor' : state.voice.muted ? 'Ninguém me ouve' : 'Todos me ouvem'));
  globalMute.addEventListener('click', () => void voice.resumePlayback().then(() => voice.toggleMute()));
  primary.append(mic, deafen, globalMute);
  panel.append(primary);

  const devices = el('div', 'voice-device-grid');
  devices.append(deviceSelect('Microfone', state.voice.inputDevices, state.voice.inputDeviceId, value => void voice.setInputDevice(value), 'audioinput'));
  devices.append(deviceSelect('Saída de áudio', state.voice.outputDevices, state.voice.outputDeviceId, value => void voice.setOutputDevice(value), 'audiooutput'));

  const chooseOutput = el('button', 'secondary-button voice-output-button', 'Escolher saída pelo navegador');
  chooseOutput.type = 'button';
  chooseOutput.addEventListener('click', () => void voice.requestOutputDevice());
  const outputField = el('div', 'voice-device-field');
  outputField.append(el('label', '', 'Permissão de saída'), chooseOutput);
  devices.append(outputField);
  panel.append(devices, renderScreenControls(voice));
  return panel;
}

function deviceSelect(
  labelText: string,
  devices: MediaDeviceInfo[],
  selected: string | undefined,
  onChange: (value: string) => void,
  kind: 'audioinput' | 'audiooutput'
): HTMLElement {
  const field = el('div', 'voice-device-field');
  const label = el('label', '', labelText);
  const select = document.createElement('select');
  select.setAttribute('aria-label', labelText);
  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = kind === 'audioinput' ? 'Microfone padrão' : 'Saída padrão';
  select.append(defaultOption);
  devices.forEach((device, index) => {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label || `${kind === 'audioinput' ? 'Microfone' : 'Saída'} ${index + 1}`;
    option.selected = Boolean(selected && device.deviceId === selected);
    select.append(option);
  });
  select.addEventListener('change', () => onChange(select.value));
  field.append(label, select);
  return field;
}

function voiceStatusLabel(status: string): string {
  if (status === 'connected') return 'Chamada conectada';
  if (status === 'joining') return 'Entrando na chamada';
  if (status === 'reconnecting') return 'Reconectando chamada';
  if (status === 'error') return 'Erro na chamada';
  return 'Fora da chamada';
}

function roleLabel(role: string): string {
  return role === 'owner' ? 'Dono' : role === 'moderator' ? 'Moderador' : 'Membro';
}

function globeIcon(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('voice-globe-icon');
  const circle = document.createElementNS(ns, 'circle');
  circle.setAttribute('cx', '12'); circle.setAttribute('cy', '12'); circle.setAttribute('r', '9');
  const vertical = document.createElementNS(ns, 'path');
  vertical.setAttribute('d', 'M12 3c2.4 2.5 3.7 5.5 3.7 9S14.4 18.5 12 21c-2.4-2.5-3.7-5.5-3.7-9S9.6 5.5 12 3Z');
  const horizontal = document.createElementNS(ns, 'path');
  horizontal.setAttribute('d', 'M3.5 9h17M3.5 15h17');
  for (const node of [circle, vertical, horizontal]) {
    node.setAttribute('fill', 'none');
    node.setAttribute('stroke', 'currentColor');
    node.setAttribute('stroke-width', '1.7');
    node.setAttribute('stroke-linecap', 'round');
    node.setAttribute('stroke-linejoin', 'round');
    svg.append(node);
  }
  return svg;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
