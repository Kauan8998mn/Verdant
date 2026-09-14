import { SCREEN_BITRATE_OPTIONS_KBPS, SCREEN_RESOLUTIONS } from './screen-config.js';
import { getState } from './state.js';
import type { RemoteScreenInfo, ScreenFps, ScreenResolutionName, ScreenSourcePreference } from './types.js';
import type { VoiceController } from './voice.js';

export function renderScreenStage(voice: VoiceController): HTMLElement {
  const state = getState();
  const screen = state.voice.screen;
  const stage = el('section', `screen-stage phase6${screen.focusedShareId ? ' has-focus' : ''}`);
  const head = el('div', 'screen-stage-head');
  const copy = el('div');
  const count = screen.remotes.length + (screen.localActive ? 1 : 0);
  copy.append(
    el('strong', '', `${count} transmissão${count === 1 ? '' : 'ões'} ao vivo`),
    el('span', 'screen-stage-meta', screen.focusedShareId
      ? 'Modo foco · streams não focadas ficam pausadas para economizar banda'
      : count > 1
        ? 'Grade econômica · vídeos remotos ficam em espera; clique em uma tela para recebê-la'
        : 'Qualidade máxima disponível')
  );
  head.append(copy);

  const actions = el('div', 'screen-stage-actions');
  if (screen.focusedShareId) {
    const grid = el('button', 'secondary-button', 'Voltar para grade');
    grid.type = 'button';
    grid.addEventListener('click', () => voice.focusScreen(undefined));
    actions.append(grid);
  }
  if (screen.remotes.some(remote => remote.audio)) {
    const globalAudio = el('button', `secondary-button${screen.allAudioMuted ? ' danger-button' : ''}`, screen.allAudioMuted ? 'Ouvir transmissões' : 'Silenciar transmissões');
    globalAudio.type = 'button';
    globalAudio.title = 'Mute global somente do áudio das transmissões; vozes da chamada não são afetadas.';
    globalAudio.addEventListener('click', () => void voice.muteAllScreenAudio(!screen.allAudioMuted));
    actions.append(globalAudio);
  }
  if (actions.childElementCount) head.append(actions);

  const grid = el('div', `screen-grid${screen.focusedShareId ? ' focused-layout' : ''}`);
  if (screen.localActive && screen.localShareId) {
    grid.append(renderLocalScreenTile(voice, screen.localShareId));
  }
  for (const remote of screen.remotes) grid.append(renderRemoteScreenTile(voice, remote));
  stage.append(head, grid);
  return stage;
}

function renderLocalScreenTile(voice: VoiceController, shareId: string): HTMLElement {
  const screen = getState().voice.screen;
  const focused = screen.focusedShareId === shareId;
  const tile = el('article', `screen-tile local${focused ? ' focused' : ''}`);
  tile.dataset.shareId = shareId;

  const head = el('div', 'screen-tile-head');
  const copy = el('div', 'screen-tile-copy');
  copy.append(
    el('strong', '', 'Sua transmissão'),
    el('span', '', `${screen.actualWidth ?? SCREEN_RESOLUTIONS[screen.resolution].width}×${screen.actualHeight ?? SCREEN_RESOLUTIONS[screen.resolution].height} · ${Math.round(screen.actualFps ?? screen.fps)} FPS${screen.audioCaptured ? ' · áudio' : ''}`)
  );
  const actions = el('div', 'screen-tile-actions');
  if (!focused) {
    const focus = el('button', 'icon-button', '⛶');
    focus.type = 'button';
    focus.title = 'Focar sua transmissão';
    focus.addEventListener('click', () => voice.focusScreen(shareId));
    actions.append(focus);
  }
  actions.append(fullscreenButton(tile, 'Abrir sua transmissão em tela cheia'));
  const stop = el('button', 'icon-button danger', '■');
  stop.type = 'button';
  stop.title = 'Parar transmissão';
  stop.addEventListener('click', () => void voice.stopScreenShare());
  actions.append(stop);
  head.append(copy, actions);

  const viewport = el('div', 'screen-viewport');
  viewport.title = focused ? 'Transmissão em foco' : 'Clique para focar';
  viewport.addEventListener('click', () => { if (!focused) voice.focusScreen(shareId); });
  if (!voice.mountLocalScreenVideo(viewport)) viewport.append(el('div', 'screen-placeholder', 'Preparando preview local…'));
  tile.append(head, viewport);
  return tile;
}

function renderRemoteScreenTile(voice: VoiceController, remote: RemoteScreenInfo): HTMLElement {
  const state = getState();
  const screen = state.voice.screen;
  const focused = screen.focusedShareId === remote.shareId;
  const tile = el('article', `screen-tile remote${focused ? ' focused' : ''}${remote.videoPaused ? ' bandwidth-paused' : ''}`);
  tile.dataset.shareId = remote.shareId;

  const head = el('div', 'screen-tile-head');
  const copy = el('div', 'screen-tile-copy');
  const dimensions = remote.width && remote.height ? `${remote.width}×${remote.height}` : remote.resolution ?? 'Tela';
  const quality = remote.videoPaused
    ? 'vídeo pausado'
    : remote.preferredSpatialLayer === 0
      ? 'preview econômico'
      : 'alta qualidade';
  copy.append(
    el('strong', '', remote.displayName),
    el('span', '', `${dimensions}${remote.fps ? ` · ${remote.fps} FPS` : ''} · ${quality}${remote.audio ? ' · áudio' : ''}`)
  );

  const actions = el('div', 'screen-tile-actions');
  if (!focused) {
    const focus = el('button', 'icon-button', '⛶');
    focus.type = 'button';
    focus.title = `Focar transmissão de ${remote.displayName}`;
    focus.addEventListener('click', () => voice.focusScreen(remote.shareId));
    actions.append(focus);
  }
  if (remote.audio) {
    const muted = screen.allAudioMuted || remote.audioMuted || state.voice.deafened;
    const audio = el('button', `icon-button${muted ? ' active danger' : ''}`, muted ? '🔇' : '🔊');
    audio.type = 'button';
    audio.title = remote.audioMuted ? `Ouvir transmissão de ${remote.displayName}` : `Mutar transmissão de ${remote.displayName}`;
    audio.setAttribute('aria-label', audio.title);
    audio.disabled = screen.allAudioMuted || state.voice.deafened;
    audio.addEventListener('click', () => void voice.setScreenAudioMuted(remote.shareId, !remote.audioMuted));
    actions.append(audio);
  }
  actions.append(fullscreenButton(tile, `Abrir transmissão de ${remote.displayName} em tela cheia`));

  const targetRole = state.voice.members.find(member => member.displayName === remote.displayName)?.role;
  const sessionRole = state.session?.role;
  const canManage = sessionRole === 'owner' || (sessionRole === 'moderator' && targetRole !== 'owner');
  if (canManage) {
    const stop = el('button', 'icon-button danger', '■');
    stop.type = 'button';
    stop.title = `Encerrar transmissão de ${remote.displayName}`;
    stop.addEventListener('click', () => void voice.adminStopScreen(remote.displayName));
    actions.append(stop);
  }
  head.append(copy, actions);

  const viewport = el('div', 'screen-viewport');
  viewport.title = focused ? `${remote.displayName} em foco` : `Focar ${remote.displayName}`;
  viewport.addEventListener('click', () => { if (!focused) voice.focusScreen(remote.shareId); });
  if (!voice.mountRemoteScreenVideo(remote.shareId, viewport)) {
    viewport.append(el('div', 'screen-placeholder', 'Aguardando vídeo…'));
  }
  if (remote.videoPaused) {
    const paused = el('div', 'screen-bandwidth-overlay');
    paused.append(el('strong', '', 'Vídeo em espera'), el('span', '', 'Clique para focar e receber esta transmissão.'));
    viewport.append(paused);
  }
  tile.append(head, viewport);
  return tile;
}

function fullscreenButton(target: HTMLElement, label: string): HTMLButtonElement {
  const button = el('button', 'icon-button screen-fullscreen-button', '⛶');
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.addEventListener('click', event => {
    event.stopPropagation();
    const active = document.fullscreenElement;
    if (active === target) void document.exitFullscreen();
    else void target.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  });
  target.addEventListener('fullscreenchange', () => {
    const active = document.fullscreenElement === target;
    button.textContent = active ? '⤢' : '⛶';
    button.title = active ? 'Sair da tela cheia' : label;
    button.setAttribute('aria-label', button.title);
  });
  return button;
}

export function renderScreenControls(voice: VoiceController): HTMLElement {
  const screen = getState().voice.screen;
  const box = el('section', 'screen-controls');
  const heading = el('div', 'screen-controls-heading');
  const title = el('div');
  title.append(el('strong', '', 'Compartilhamento de tela'), el('span', '', 'Multi-stream com vídeo sob demanda para reduzir banda e uso de CPU.'));
  heading.append(title);
  if (screen.status === 'starting') heading.append(el('span', 'badge warn', 'Selecionando fonte…'));
  else if (screen.localActive) heading.append(el('span', 'badge ok', 'Você está transmitindo'));
  else if (screen.remotes.length) heading.append(el('span', 'badge', `${screen.remotes.length} transmissão${screen.remotes.length === 1 ? '' : 'ões'} remota${screen.remotes.length === 1 ? '' : 's'}`));
  box.append(heading);

  if (!window.isSecureContext || typeof (navigator.mediaDevices as any)?.getDisplayMedia !== 'function') {
    const warning = el('div', 'voice-notice warn');
    warning.append(el('strong', '', 'Captura de tela indisponível'), el('span', '', 'Use HTTPS confiável e um navegador Chromium com Screen Capture API.'));
    box.append(warning);
  }
  if (screen.lastError) {
    const warning = el('div', 'voice-notice error');
    warning.append(el('strong', '', 'Falha na transmissão'), el('span', '', screen.lastError));
    box.append(warning);
  }

  const grid = el('div', 'screen-settings-grid');
  grid.append(simpleSelect('Resolução', Object.keys(SCREEN_RESOLUTIONS).map(value => ({ value, label: value })), screen.resolution, value => voice.setScreenResolution(value as ScreenResolutionName), screen.localActive));
  grid.append(simpleSelect('FPS', [{ value: '30', label: '30 FPS' }, { value: '60', label: '60 FPS' }], String(screen.fps), value => voice.setScreenFps(Number(value) as ScreenFps), screen.localActive));
  grid.append(simpleSelect('Preferência de fonte', [
    { value: 'any', label: 'Escolher no navegador' },
    { value: 'monitor', label: 'Tela / monitor' },
    { value: 'window', label: 'Janela' },
    { value: 'browser', label: 'Aba do navegador' }
  ], screen.sourcePreference, value => voice.setScreenSourcePreference(value as ScreenSourcePreference), screen.localActive));
  const bitrateOptions = SCREEN_BITRATE_OPTIONS_KBPS.map(value => ({ value: String(value), label: value === 0 ? 'Automático' : `${(value / 1000).toFixed(value % 1000 ? 1 : 0)} Mbps` }));
  grid.append(simpleSelect('Bitrate máximo', bitrateOptions, String(screen.bitrateKbps), value => voice.setScreenBitrate(Number(value)), screen.localActive));

  const audioField = el('label', 'screen-audio-toggle');
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = screen.includeAudio;
  checkbox.disabled = screen.localActive;
  checkbox.addEventListener('change', () => voice.setScreenAudio(checkbox.checked));
  audioField.append(checkbox, el('span', '', 'Compartilhar áudio quando a fonte/navegador oferecer'));
  grid.append(audioField);
  box.append(grid);

  const footer = el('div', 'screen-controls-footer');
  const note = el('span', 'screen-note', 'Chromium: a transmissão usa três camadas VP8. Com várias telas na grade, vídeo remoto fica pausado; ao focar, só a escolhida recebe vídeo em alta. O áudio continua independente.');
  const action = el('button', screen.localActive ? 'secondary-button danger-button' : 'primary-button', screen.localActive ? 'Parar transmissão' : 'Compartilhar tela');
  action.type = 'button';
  action.disabled = screen.status === 'starting';
  action.addEventListener('click', () => {
    if (screen.localActive) void voice.stopScreenShare();
    else void voice.startScreenShare().catch(() => {});
  });
  footer.append(note, action);
  box.append(footer);
  return box;
}

export function isMemberScreenSharing(displayName: string): boolean {
  const screen = getState().voice.screen;
  if (screen.localActive && displayName === getState().session?.displayName) return true;
  return screen.remotes.some(remote => remote.displayName === displayName && Boolean(remote.videoProducerId));
}

function simpleSelect(
  labelText: string,
  options: Array<{ value: string; label: string }>,
  selected: string,
  onChange: (value: string) => void,
  disabled = false
): HTMLElement {
  const field = el('div', 'voice-device-field');
  const label = el('label', '', labelText);
  const select = document.createElement('select');
  select.setAttribute('aria-label', labelText);
  select.disabled = disabled;
  for (const item of options) {
    const option = document.createElement('option');
    option.value = item.value;
    option.textContent = item.label;
    option.selected = item.value === selected;
    select.append(option);
  }
  select.addEventListener('change', () => onChange(select.value));
  field.append(label, select);
  return field;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
