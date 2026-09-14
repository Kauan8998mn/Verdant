import type { State } from './state.js';

/**
 * Assinatura apenas dos dados que realmente alteram o painel principal.
 *
 * Em um canal de texto, mudanças contínuas da chamada (speaker, RTT de mídia,
 * mute etc.) NÃO devem recriar o composer. Isso mantém foco, seleção e IME
 * estáveis enquanto a voz continua atualizando em paralelo.
 */
export function mainRenderSignature(state: State): string {
  const common = [
    state.server?.id ?? '',
    state.session?.token ?? '',
    state.activeChannel?.id ?? '',
    state.activeChannel?.name ?? '',
    state.activeChannel?.type ?? '',
    state.wsStatus
  ];

  if (state.activeChannel?.type === 'voice') {
    const screen = state.voice.screen ?? { status: 'idle', resolution: '720p', fps: 30, includeAudio: true, sourcePreference: 'any', bitrateKbps: 0, localActive: false, remotes: [], allAudioMuted: false };
    const members = state.voice.members
      .map(member => [member.displayName, member.channelId, member.selfMuted, member.deafened, member.adminMuted, member.role].join(':'))
      .sort()
      .join('|');
    common.push(
      state.voice.status,
      state.voice.joinedChannelId ?? '',
      String(state.voice.muted),
      String(state.voice.deafened),
      String(state.voice.adminMuted),
      state.voice.lastError ?? '',
      state.voice.inputDeviceId ?? '',
      state.voice.outputDeviceId ?? '',
      screen.status,
      screen.resolution,
      String(screen.fps),
      String(screen.includeAudio),
      screen.sourcePreference,
      String(screen.bitrateKbps),
      String(screen.localActive),
      screen.localShareId ?? '',
      String(screen.audioCaptured ?? ''),
      String(screen.actualWidth ?? ''),
      String(screen.actualHeight ?? ''),
      String(screen.actualFps ?? ''),
      screen.sourceType ?? '',
      screen.focusedShareId ?? '',
      String(screen.allAudioMuted),
      (screen.remotes ?? []).map(remote => [
        remote.shareId,
        remote.displayName,
        remote.videoProducerId ?? '',
        remote.audioProducerId ?? '',
        remote.sourceType ?? '',
        remote.resolution ?? '',
        remote.fps ?? '',
        remote.width ?? '',
        remote.height ?? '',
        remote.audio,
        remote.videoPaused,
        remote.audioMuted,
        remote.preferredSpatialLayer ?? ''
      ].join(':')).sort().join('|'),
      screen.lastError ?? '',
      members,
      state.voice.inputDevices.map(device => `${device.deviceId}:${device.label}`).join('|'),
      state.voice.outputDevices.map(device => `${device.deviceId}:${device.label}`).join('|'),
      state.bootstrap?.media?.enabled ? 'media:on' : 'media:off'
    );
  } else {
    // Mensagens são atualizadas dentro do próprio painel de histórico.
    // Não recriamos o composer a cada mensagem/arquivo recebido.
    common.push('text-channel');
  }

  return common.join('\u001f');
}

/**
 * A rail só muda quando a lista de servidores ou o servidor ativo muda.
 * RTT, speaking e mídia não devem reconstruí-la a cada frame de estado.
 */
export function railRenderSignature(state: State): string {
  return [
    state.server?.id ?? '',
    ...(state.bootstrap?.servers ?? [])
      .map(server => `${server.id}:${server.name}`)
      .sort()
  ].join('\u001f');
}

/**
 * A sidebar de canais contém bastante DOM. Speaking é propositalmente excluído
 * e aplicado por patch pontual em main.ts; assim os eventos frequentes do
 * audio observer não recriam todos os canais, avatares e handlers.
 */
export function channelsRenderSignature(state: State, profileRevision = 0): string {
  const screen = state.voice.screen;
  return [
    String(profileRevision),
    state.server?.id ?? '',
    state.server?.name ?? '',
    state.server?.inviteCode ?? '',
    state.session?.displayName ?? '',
    state.session?.role ?? '',
    state.activeChannel?.id ?? '',
    state.voice.joinedChannelId ?? '',
    String(state.voice.muted),
    String(state.voice.adminMuted),
    String(state.voice.deafened),
    String(screen?.localActive ?? false),
    screen?.status ?? '',
    ...(state.channels ?? [])
      .map(channel => `${channel.id}:${channel.type}:${channel.name}:${channel.position}`)
      .sort(),
    ...(state.voice.members ?? [])
      .map(member => `${member.channelId}:${member.displayName}:${member.role}:${member.selfMuted}:${member.adminMuted}:${member.deafened}`)
      .sort(),
    ...((screen?.remotes ?? []).map(remote => `screen:${remote.displayName}:${remote.videoProducerId ?? ''}`).sort())
  ].join('\u001f');
}

/** A lista lateral de participantes só depende de presença, cargos e avatares. */
export function membersRenderSignature(state: State, profileRevision = 0): string {
  return [
    String(profileRevision),
    state.server?.id ?? '',
    state.session?.displayName ?? '',
    state.session?.role ?? '',
    ...(state.presence ?? [])
      .map(member => `${member.displayName}:${member.role}:${member.connected}`)
      .sort()
  ].join('\u001f');
}
