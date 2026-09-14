import * as mediasoup from 'mediasoup';
import { hasPermission } from '../../shared/src/domain.ts';
import { isScreenFps, isScreenResolution } from '../../shared/src/screen.ts';
import type { AppDatabase } from './database.ts';
import type { Logger } from './logger.ts';
import type { MediaBackend, MediaSignalSink, VoiceMemberState } from './media-contract.ts';
import type { Session } from './sessions.ts';
import { VoiceRegistry } from './voice-registry.ts';

export class MediaError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

type ProducerSource = 'microphone' | 'screen-video' | 'screen-audio';

const MAX_SCREEN_SHARES_PER_CHANNEL = 4;

interface RoomMedia {
  router: any;
  audioObserver: any;
}

interface PeerMedia {
  token: string;
  serverId: string;
  sendTransport?: any;
  recvTransport?: any;
  producers: Map<ProducerSource, any>;
  consumers: Map<string, any>;
}

interface MediaServiceOptions {
  db: AppDatabase;
  logger: Logger;
  listenAddresses: string[];
  mediaPort: number;
  announcedAddress?: string;
  exposeInternalIp?: boolean;
}

export class MediaService implements MediaBackend {
  readonly enabled = true;
  readonly mediaPort: number;
  readonly listenAddresses: string[];

  #db: AppDatabase;
  #logger: Logger;
  #worker: any;
  #webRtcServer: any;
  #rooms = new Map<string, RoomMedia>();
  #peers = new Map<string, PeerMedia>();
  #voice = new VoiceRegistry();
  #sink?: MediaSignalSink;

  private constructor(options: MediaServiceOptions, worker: any, webRtcServer: any) {
    this.#db = options.db;
    this.#logger = options.logger;
    this.listenAddresses = [...options.listenAddresses];
    this.mediaPort = options.mediaPort;
    this.#worker = worker;
    this.#webRtcServer = webRtcServer;
  }

  static async create(options: MediaServiceOptions): Promise<MediaService> {
    if (!options.listenAddresses.length) throw new Error('Nenhum endereço disponível para o SFU.');

    const worker = await mediasoup.createWorker({
      logLevel: 'warn',
      logTags: ['ice', 'dtls', 'rtp', 'rtcp']
    });
    worker.on('died', (error: Error) => {
      options.logger.error('Worker mediasoup encerrou inesperadamente', { error: error.message });
    });

    const listenInfos = options.listenAddresses.flatMap(ip => [
      { protocol: 'udp' as const, ip, port: options.mediaPort, ...(options.announcedAddress ? { announcedAddress: options.announcedAddress, exposeInternalIp: Boolean(options.exposeInternalIp) } : {}) },
      { protocol: 'tcp' as const, ip, port: options.mediaPort, ...(options.announcedAddress ? { announcedAddress: options.announcedAddress, exposeInternalIp: Boolean(options.exposeInternalIp) } : {}) }
    ]);

    const webRtcServer = await worker.createWebRtcServer({ listenInfos });
    options.logger.media('SFU mediasoup iniciado', {
      workerPid: worker.pid,
      mediaPort: options.mediaPort,
      addresses: options.listenAddresses.join(','),
      announcedAddress: options.announcedAddress ?? null
    });
    return new MediaService(options, worker, webRtcServer);
  }

  setSignalSink(sink: MediaSignalSink): void {
    this.#sink = sink;
  }

  async handleRequest(session: Session, action: string, data: any): Promise<any> {
    this.#voice.syncSession(session.token, { displayName: session.displayName, role: session.role });
    switch (action) {
      case 'voice.join': return await this.#joinVoice(session, data);
      case 'voice.leave': return await this.#leaveVoice(session.token, true);
      case 'voice.list': return this.#voiceSnapshot(session.serverId);
      case 'voice.deafen': return this.#setDeafen(session, data);
      case 'voice.adminMute': return await this.#adminMute(session, data);
      case 'transport.create': return await this.#createTransport(session, data);
      case 'transport.connect': return await this.#connectTransport(session, data);
      case 'transport.restartIce': return await this.#restartIce(session, data);
      case 'producer.create': return await this.#createProducer(session, data);
      case 'producer.pause': return await this.#setProducerPaused(session, data, true);
      case 'producer.resume': return await this.#setProducerPaused(session, data, false);
      case 'producer.close': return await this.#closeProducerRequest(session, data);
      case 'screen.adminStop': return await this.#adminStopScreen(session, data);
      case 'consumer.create': return await this.#createConsumer(session, data);
      case 'consumer.resume': return await this.#setConsumerPaused(session, data, false);
      case 'consumer.pause': return await this.#setConsumerPaused(session, data, true);
      case 'consumer.quality': return await this.#setConsumerQuality(session, data);
      default: throw new MediaError('UNKNOWN_MEDIA_ACTION', 'Ação de mídia desconhecida.');
    }
  }

  async disconnectSession(token: string): Promise<void> {
    await this.#leaveVoice(token, true);
  }

  async close(): Promise<void> {
    for (const token of [...this.#peers.keys()]) await this.#leaveVoice(token, false);
    for (const room of this.#rooms.values()) {
      try { room.audioObserver.close(); } catch {}
      try { room.router.close(); } catch {}
    }
    this.#rooms.clear();
    try { this.#webRtcServer.close(); } catch {}
    try { this.#worker.close(); } catch {}
  }

  async #joinVoice(session: Session, data: any): Promise<any> {
    if (!hasPermission(session.role, 'voice.join')) throw new MediaError('FORBIDDEN', 'Sem permissão para entrar em canal de voz.', 403);
    const channelId = typeof data?.channelId === 'string' ? data.channelId : '';
    const channel = this.#db.getChannel(channelId);
    if (!channel || channel.serverId !== session.serverId || channel.type !== 'voice') {
      throw new MediaError('BAD_VOICE_CHANNEL', 'Canal de voz inválido.', 404);
    }

    const current = this.#voice.get(session.token);
    if (current && current.channelId !== channelId) await this.#leaveVoice(session.token, true);

    this.#voice.join({
      token: session.token,
      serverId: session.serverId,
      channelId,
      displayName: session.displayName,
      role: session.role
    });
    this.#ensurePeer(session);
    const room = await this.#ensureRoom(session.serverId);
    this.#broadcastVoiceState(session.serverId);
    this.#recordVoiceSystemMessage(session.serverId, session.displayName, session.role, `${session.displayName} entrou no canal de voz ${channel.name}.`);
    this.#logger.media('Usuário entrou em canal de voz', { serverId: session.serverId, channelId, user: session.displayName });

    return {
      channelId,
      routerRtpCapabilities: room.router.rtpCapabilities,
      producers: this.#listProducersForChannel(session.serverId, channelId, session.token),
      members: this.#publicMembers(session.serverId)
    };
  }

  async #leaveVoice(token: string, broadcast: boolean): Promise<{ left: boolean }> {
    const member = this.#voice.get(token);
    const peer = this.#peers.get(token);
    if (!member && !peer) return { left: false };

    if (peer) {
      await this.#closeAllProducers(peer, broadcast);
      for (const consumer of peer.consumers.values()) {
        try { consumer.close(); } catch {}
      }
      peer.consumers.clear();
      try { peer.sendTransport?.close(); } catch {}
      try { peer.recvTransport?.close(); } catch {}
      this.#peers.delete(token);
    }
    const left = this.#voice.leave(token);
    if (left && broadcast) {
      this.#broadcastVoiceState(left.serverId);
      const channel = this.#db.getChannel(left.channelId);
      this.#recordVoiceSystemMessage(left.serverId, left.displayName, left.role, `${left.displayName} saiu do canal de voz${channel ? ` ${channel.name}` : ''}.`);
      this.#logger.media('Usuário saiu do canal de voz', { serverId: left.serverId, channelId: left.channelId, user: left.displayName });
    }
    return { left: Boolean(left) };
  }

  #setDeafen(session: Session, data: any): any {
    const member = this.#voice.get(session.token);
    if (!member) throw new MediaError('NOT_IN_VOICE', 'Entre em um canal de voz primeiro.');
    const deafened = Boolean(data?.deafened);
    const updated = this.#voice.updateSelf(session.token, { deafened });
    this.#broadcastVoiceState(session.serverId);
    return { deafened: updated?.deafened ?? deafened };
  }

  async #adminMute(session: Session, data: any): Promise<any> {
    if (!hasPermission(session.role, 'members.adminMute')) throw new MediaError('FORBIDDEN', 'Sem permissão para mutar administrativamente.', 403);
    const targetName = typeof data?.displayName === 'string' ? data.displayName : '';
    const muted = Boolean(data?.muted);
    const target = this.#voice.findByName(session.serverId, targetName);
    if (!target) throw new MediaError('VOICE_MEMBER_NOT_FOUND', 'Participante não encontrado na chamada.', 404);
    if (target.role === 'owner' && session.role !== 'owner') throw new MediaError('FORBIDDEN', 'Moderadores não podem mutar o dono.', 403);

    const updated = this.#voice.setAdminMuted(target.token, muted)!;
    const peer = this.#peers.get(target.token);
    const mic = peer?.producers.get('microphone');
    if (mic) {
      if (muted || updated.selfMuted) await mic.pause();
      else await mic.resume();
    }
    this.#eventTo(target.token, 'voice.adminMute', { muted, by: session.displayName });
    this.#broadcastVoiceState(session.serverId);
    return { displayName: target.displayName, muted };
  }

  async #createTransport(session: Session, data: any): Promise<any> {
    const member = this.#requireVoiceMember(session);
    const direction = data?.direction === 'send' || data?.direction === 'recv' ? data.direction : undefined;
    if (!direction) throw new MediaError('BAD_DIRECTION', 'Direção de transporte inválida.');

    const room = await this.#ensureRoom(session.serverId);
    const peer = this.#ensurePeer(session);

    if (direction === 'send' && peer.sendTransport) {
      await this.#closeAllProducers(peer, true);
      try { peer.sendTransport.close(); } catch {}
      peer.sendTransport = undefined;
    }
    if (direction === 'recv' && peer.recvTransport) {
      for (const consumer of peer.consumers.values()) {
        try { consumer.close(); } catch {}
      }
      peer.consumers.clear();
      try { peer.recvTransport.close(); } catch {}
      peer.recvTransport = undefined;
    }

    const transport = await room.router.createWebRtcTransport({
      webRtcServer: this.#webRtcServer,
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate: 12_000_000,
      appData: { token: session.token, serverId: session.serverId, channelId: member.channelId, direction }
    });

    transport.on('dtlsstatechange', (state: string) => {
      if (state === 'closed') transport.close();
    });
    transport.on('icestatechange', (state: string) => {
      this.#eventTo(session.token, 'voice.transportState', { direction, iceState: state });
    });

    if (direction === 'send') peer.sendTransport = transport;
    else peer.recvTransport = transport;

    return this.#transportOptions(transport);
  }

  async #connectTransport(session: Session, data: any): Promise<{ connected: true }> {
    const peer = this.#requirePeer(session);
    const transport = this.#findTransport(peer, data?.transportId);
    if (!transport) throw new MediaError('TRANSPORT_NOT_FOUND', 'Transporte de mídia não encontrado.', 404);
    if (!data?.dtlsParameters) throw new MediaError('BAD_DTLS', 'Parâmetros DTLS ausentes.');
    await transport.connect({ dtlsParameters: data.dtlsParameters });
    return { connected: true };
  }

  async #restartIce(session: Session, data: any): Promise<any> {
    const peer = this.#requirePeer(session);
    const transport = this.#findTransport(peer, data?.transportId);
    if (!transport) throw new MediaError('TRANSPORT_NOT_FOUND', 'Transporte de mídia não encontrado.', 404);
    const iceParameters = await transport.restartIce();
    return { iceParameters };
  }

  async #createProducer(session: Session, data: any): Promise<any> {
    const member = this.#requireVoiceMember(session);
    const peer = this.#requirePeer(session);
    const transport = peer.sendTransport;
    if (!transport || transport.id !== data?.transportId) throw new MediaError('SEND_TRANSPORT_NOT_FOUND', 'Transporte de envio ausente.', 404);
    if (!data?.rtpParameters) throw new MediaError('BAD_RTP', 'Parâmetros RTP ausentes.');

    const source = this.#producerSource(data?.appData?.source, data?.kind);
    if (source === 'microphone' && data?.kind !== 'audio') throw new MediaError('BAD_MEDIA_KIND', 'Microfone deve usar uma faixa de áudio.');
    if (source === 'screen-video' && data?.kind !== 'video') throw new MediaError('BAD_MEDIA_KIND', 'Compartilhamento de tela deve usar uma faixa de vídeo.');
    if (source === 'screen-audio' && data?.kind !== 'audio') throw new MediaError('BAD_MEDIA_KIND', 'Áudio da transmissão deve usar uma faixa de áudio.');

    if (source !== 'microphone') {
      if (!hasPermission(session.role, 'screen.share')) throw new MediaError('FORBIDDEN', 'Sem permissão para transmitir tela.', 403);
      if (source === 'screen-audio' && !peer.producers.get('screen-video')) {
        throw new MediaError('SCREEN_VIDEO_REQUIRED', 'Inicie o vídeo da transmissão antes do áudio.');
      }
      if (source === 'screen-video' && !peer.producers.get('screen-video')) {
        const activeScreens = this.#countActiveScreenVideos(session.serverId, member.channelId);
        if (activeScreens >= MAX_SCREEN_SHARES_PER_CHANNEL) {
          throw new MediaError(
            'SCREEN_LIMIT_REACHED',
            `Este canal já atingiu o limite de ${MAX_SCREEN_SHARES_PER_CHANNEL} transmissões simultâneas.`,
            409
          );
        }
      }
    }

    await this.#closeProducerBySource(peer, source, true);
    const appData = {
      source,
      token: session.token,
      serverId: session.serverId,
      channelId: member.channelId,
      displayName: session.displayName,
      ...(source.startsWith('screen-') ? this.#screenAppData(data?.appData) : {})
    };
    const producer = await transport.produce({
      kind: data.kind,
      rtpParameters: data.rtpParameters,
      appData
    });
    peer.producers.set(source, producer);

    if (source === 'microphone' && (member.selfMuted || member.adminMuted)) await producer.pause();
    if (source === 'microphone') {
      const room = await this.#ensureRoom(session.serverId);
      try { await room.audioObserver.addProducer({ producerId: producer.id }); } catch {}
    }

    producer.on('transportclose', () => void this.#onProducerTransportClosed(peer, producer.id));

    this.#eventBroadcast(session.serverId, 'voice.producerAvailable', this.#producerPublicInfo(producer), session.token);
    if (source === 'microphone') this.#broadcastVoiceState(session.serverId);
    if (source === 'screen-video') {
      this.#recordVoiceSystemMessage(session.serverId, session.displayName, session.role, `${session.displayName} iniciou uma transmissão de tela.`);
    }
    this.#logger.media('Producer criado', {
      serverId: session.serverId,
      channelId: member.channelId,
      user: session.displayName,
      source,
      kind: data.kind
    });
    return { id: producer.id, source };
  }

  async #setProducerPaused(session: Session, data: any, paused: boolean): Promise<any> {
    const member = this.#requireVoiceMember(session);
    const peer = this.#requirePeer(session);
    const source = this.#producerSource(data?.source ?? data?.appData?.source ?? 'microphone', undefined);
    const producer = peer.producers.get(source);
    if (source === 'microphone') this.#voice.updateSelf(session.token, { selfMuted: paused });
    if (producer) {
      if (source === 'microphone' && member.adminMuted && !paused) await producer.pause();
      else if (paused) await producer.pause();
      else await producer.resume();
    }
    if (source === 'microphone') this.#broadcastVoiceState(session.serverId);
    return source === 'microphone' ? { muted: paused, adminMuted: member.adminMuted } : { paused };
  }

  async #closeProducerRequest(session: Session, data: any): Promise<{ closed: boolean }> {
    this.#requireVoiceMember(session);
    const peer = this.#requirePeer(session);
    const source = this.#producerSource(data?.source, undefined);
    const exists = Boolean(peer.producers.get(source));
    await this.#closeProducerBySource(peer, source, true);
    return { closed: exists };
  }

  async #adminStopScreen(session: Session, data: any): Promise<{ closed: boolean; displayName: string }> {
    if (!hasPermission(session.role, 'streams.manage')) throw new MediaError('FORBIDDEN', 'Sem permissão para administrar transmissões.', 403);
    const requester = this.#requireVoiceMember(session);
    const targetName = typeof data?.displayName === 'string' ? data.displayName : '';
    const target = this.#voice.findByName(session.serverId, targetName);
    if (!target || target.channelId !== requester.channelId) throw new MediaError('SCREEN_OWNER_NOT_FOUND', 'Participante da transmissão não encontrado neste canal.', 404);
    if (target.token === session.token) {
      const ownPeer = this.#requirePeer(session);
      const existed = Boolean(ownPeer.producers.get('screen-video'));
      await this.#closeProducerBySource(ownPeer, 'screen-video', true);
      return { closed: existed, displayName: target.displayName };
    }
    if (target.role === 'owner' && session.role !== 'owner') throw new MediaError('FORBIDDEN', 'Moderadores não podem encerrar a transmissão do dono.', 403);
    const targetPeer = this.#peers.get(target.token);
    if (!targetPeer?.producers.get('screen-video')) throw new MediaError('SCREEN_NOT_ACTIVE', 'Esse participante não possui uma transmissão ativa.', 404);
    await this.#closeProducerBySource(targetPeer, 'screen-video', true, `${target.displayName} teve sua transmissão encerrada por ${session.displayName}.`);
    this.#eventTo(target.token, 'voice.screenAdminStopped', { by: session.displayName });
    this.#logger.media('Transmissão encerrada administrativamente', {
      serverId: session.serverId,
      channelId: requester.channelId,
      target: target.displayName,
      by: session.displayName
    });
    return { closed: true, displayName: target.displayName };
  }

  async #createConsumer(session: Session, data: any): Promise<any> {
    const member = this.#requireVoiceMember(session);
    const peer = this.#requirePeer(session);
    const transport = peer.recvTransport;
    if (!transport || transport.id !== data?.transportId) throw new MediaError('RECV_TRANSPORT_NOT_FOUND', 'Transporte de recepção ausente.', 404);
    const producerId = typeof data?.producerId === 'string' ? data.producerId : '';
    const room = await this.#ensureRoom(session.serverId);
    const producer = this.#findProducerById(session.serverId, producerId);
    if (!producer) throw new MediaError('PRODUCER_NOT_FOUND', 'Fonte de mídia não encontrada.', 404);
    if (producer.appData?.channelId !== member.channelId) throw new MediaError('DIFFERENT_VOICE_CHANNEL', 'A fonte está em outro canal de voz.', 403);
    if (producer.appData?.token === session.token) throw new MediaError('SELF_CONSUME', 'Não é necessário consumir a própria fonte.');
    if (!data?.rtpCapabilities || !room.router.canConsume({ producerId, rtpCapabilities: data.rtpCapabilities })) {
      throw new MediaError('CANNOT_CONSUME', 'Este navegador não consegue consumir essa fonte de mídia.');
    }

    const consumer = await transport.consume({
      producerId,
      rtpCapabilities: data.rtpCapabilities,
      paused: true,
      appData: {
        producerDisplayName: producer.appData?.displayName,
        channelId: member.channelId,
        source: producer.appData?.source,
        shareId: producer.appData?.shareId,
        resolution: producer.appData?.resolution,
        fps: producer.appData?.fps,
        width: producer.appData?.width,
        height: producer.appData?.height,
        sourceType: producer.appData?.sourceType,
        audio: producer.appData?.audio,
      simulcastLayers: producer.kind === 'video' ? Math.max(1, producer.rtpParameters?.encodings?.length ?? 1) : 1
      }
    });
    peer.consumers.set(consumer.id, consumer);
    consumer.on('transportclose', () => peer.consumers.delete(consumer.id));
    consumer.on('producerclose', () => {
      peer.consumers.delete(consumer.id);
      this.#eventTo(session.token, 'voice.producerClosed', { producerId, source: producer.appData?.source, shareId: producer.appData?.shareId });
    });
    consumer.on('producerpause', () => this.#eventTo(session.token, 'voice.producerPaused', { producerId, source: producer.appData?.source }));
    consumer.on('producerresume', () => this.#eventTo(session.token, 'voice.producerResumed', { producerId, source: producer.appData?.source }));

    return {
      id: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
      type: consumer.type,
      producerPaused: consumer.producerPaused,
      appData: consumer.appData
    };
  }

  async #setConsumerPaused(session: Session, data: any, paused: boolean): Promise<{ paused: boolean }> {
    const peer = this.#requirePeer(session);
    const id = typeof data?.consumerId === 'string' ? data.consumerId : '';
    const consumer = peer.consumers.get(id);
    if (!consumer) throw new MediaError('CONSUMER_NOT_FOUND', 'Consumer de mídia não encontrado.', 404);
    if (paused) await consumer.pause();
    else await consumer.resume();
    return { paused };
  }

  async #setConsumerQuality(session: Session, data: any): Promise<{ applied: boolean; spatialLayer?: number; priority?: number }> {
    const peer = this.#requirePeer(session);
    const id = typeof data?.consumerId === 'string' ? data.consumerId : '';
    const consumer = peer.consumers.get(id);
    if (!consumer) throw new MediaError('CONSUMER_NOT_FOUND', 'Consumer de mídia não encontrado.', 404);
    if (consumer.kind !== 'video') return { applied: false };

    const spatialLayer = Math.max(0, Math.min(2, Math.round(Number(data?.spatialLayer) || 0)));
    const priority = Math.max(1, Math.min(255, Math.round(Number(data?.priority) || 1)));
    let applied = false;

    // setPreferredLayers só é válido para consumers simulcast/SVC. O fallback
    // simples continua funcionando mesmo quando um navegador não negocia layers.
    if ((consumer.type === 'simulcast' || consumer.type === 'svc') && typeof consumer.setPreferredLayers === 'function') {
      try {
        await consumer.setPreferredLayers({ spatialLayer });
        applied = true;
      } catch {}
    }
    if (typeof consumer.setPriority === 'function') {
      try { await consumer.setPriority(priority); } catch {}
    }
    return { applied, spatialLayer, priority };
  }

  async #ensureRoom(serverId: string): Promise<RoomMedia> {
    const existing = this.#rooms.get(serverId);
    if (existing) return existing;

    const router = await this.#worker.createRouter({
      mediaCodecs: [
        {
          kind: 'audio',
          mimeType: 'audio/opus',
          clockRate: 48_000,
          channels: 2,
          parameters: { useinbandfec: 1, minptime: 10 }
        },
        {
          kind: 'video',
          mimeType: 'video/VP8',
          clockRate: 90_000,
          parameters: {}
        },
        {
          kind: 'video',
          mimeType: 'video/H264',
          clockRate: 90_000,
          parameters: {
            'packetization-mode': 1,
            'profile-level-id': '42e01f',
            'level-asymmetry-allowed': 1
          }
        }
      ]
    });
    const audioObserver = await router.createAudioLevelObserver({ maxEntries: 6, threshold: -58, interval: 350 });
    audioObserver.on('volumes', (volumes: Array<{ producer: any; volume: number }>) => {
      const byChannel = new Map<string, Array<{ displayName: string; volume: number }>>();
      for (const entry of volumes) {
        if (entry.producer.appData?.source !== 'microphone') continue;
        const channelId = entry.producer.appData?.channelId;
        const displayName = entry.producer.appData?.displayName;
        if (typeof channelId !== 'string' || typeof displayName !== 'string') continue;
        const list = byChannel.get(channelId) ?? [];
        list.push({ displayName, volume: entry.volume });
        byChannel.set(channelId, list);
      }
      for (const [channelId, speakers] of byChannel) {
        this.#eventBroadcast(serverId, 'voice.speaking', { channelId, speakers });
      }
    });
    audioObserver.on('silence', () => {
      this.#eventBroadcast(serverId, 'voice.speaking', { channelId: null, speakers: [] });
    });

    const room = { router, audioObserver };
    this.#rooms.set(serverId, room);
    return room;
  }

  #ensurePeer(session: Session): PeerMedia {
    let peer = this.#peers.get(session.token);
    if (!peer) {
      peer = { token: session.token, serverId: session.serverId, producers: new Map(), consumers: new Map() };
      this.#peers.set(session.token, peer);
    }
    return peer;
  }

  #requirePeer(session: Session): PeerMedia {
    const peer = this.#peers.get(session.token);
    if (!peer) throw new MediaError('MEDIA_SESSION_NOT_READY', 'Sessão de mídia não inicializada. Entre no canal de voz novamente.');
    return peer;
  }

  #requireVoiceMember(session: Session): VoiceMemberState {
    const member = this.#voice.get(session.token);
    if (!member || member.serverId !== session.serverId) throw new MediaError('NOT_IN_VOICE', 'Entre em um canal de voz primeiro.');
    return member;
  }

  #findTransport(peer: PeerMedia, transportId: unknown): any | undefined {
    if (typeof transportId !== 'string') return undefined;
    if (peer.sendTransport?.id === transportId) return peer.sendTransport;
    if (peer.recvTransport?.id === transportId) return peer.recvTransport;
    return undefined;
  }

  #countActiveScreenVideos(serverId: string, channelId: string): number {
    let count = 0;
    for (const peer of this.#peers.values()) {
      if (peer.serverId !== serverId) continue;
      const producer = peer.producers.get('screen-video');
      if (!producer || producer.closed || producer.appData?.channelId !== channelId) continue;
      count += 1;
    }
    return count;
  }

  #findProducerById(serverId: string, producerId: string): any | undefined {
    for (const peer of this.#peers.values()) {
      if (peer.serverId !== serverId) continue;
      for (const producer of peer.producers.values()) {
        if (producer?.id === producerId) return producer;
      }
    }
    return undefined;
  }

  #listProducersForChannel(serverId: string, channelId: string, excludeToken?: string): Array<Record<string, unknown>> {
    const output: Array<Record<string, unknown>> = [];
    for (const peer of this.#peers.values()) {
      if (peer.serverId !== serverId || peer.token === excludeToken) continue;
      for (const producer of peer.producers.values()) {
        if (!producer || producer.closed || producer.appData?.channelId !== channelId) continue;
        output.push(this.#producerPublicInfo(producer));
      }
    }
    return output;
  }

  async #closeAllProducers(peer: PeerMedia, broadcast: boolean): Promise<void> {
    for (const source of [...peer.producers.keys()]) await this.#closeProducerBySource(peer, source, broadcast);
  }

  async #closeProducerBySource(peer: PeerMedia, source: ProducerSource, broadcast: boolean, screenCloseContent?: string): Promise<void> {
    if (source === 'screen-video' && peer.producers.has('screen-audio')) {
      await this.#closeProducerBySource(peer, 'screen-audio', broadcast);
    }
    const producer = peer.producers.get(source);
    if (!producer) return;
    peer.producers.delete(source);
    const member = this.#voice.get(peer.token);
    if (source === 'microphone') {
      const room = this.#rooms.get(peer.serverId);
      try { await room?.audioObserver.removeProducer({ producerId: producer.id }); } catch {}
    }
    try { if (!producer.closed) producer.close(); } catch {}
    if (broadcast && member) {
      this.#eventBroadcast(peer.serverId, 'voice.producerClosed', {
        producerId: producer.id,
        channelId: member.channelId,
        displayName: member.displayName,
        source,
        shareId: producer.appData?.shareId
      }, peer.token);
      if (source === 'screen-video') {
        this.#recordVoiceSystemMessage(peer.serverId, member.displayName, member.role, screenCloseContent ?? `${member.displayName} encerrou a transmissão de tela.`);
      }
    }
  }

  async #onProducerTransportClosed(peer: PeerMedia, producerId: string): Promise<void> {
    let source: ProducerSource | undefined;
    for (const [candidate, producer] of peer.producers) {
      if (producer?.id === producerId) { source = candidate; break; }
    }
    if (!source) return;
    const producer = peer.producers.get(source);
    const member = this.#voice.get(peer.token);
    peer.producers.delete(source);
    if (source === 'microphone') {
      const room = this.#rooms.get(peer.serverId);
      try { await room?.audioObserver.removeProducer({ producerId }); } catch {}
    }
    if (source === 'screen-video' && peer.producers.has('screen-audio')) {
      await this.#closeProducerBySource(peer, 'screen-audio', true);
    }
    if (member) {
      this.#eventBroadcast(peer.serverId, 'voice.producerClosed', {
        producerId,
        channelId: member.channelId,
        displayName: member.displayName,
        source,
        shareId: producer?.appData?.shareId
      }, peer.token);
      if (source === 'microphone') this.#broadcastVoiceState(peer.serverId);
      if (source === 'screen-video') this.#recordVoiceSystemMessage(peer.serverId, member.displayName, member.role, `${member.displayName} encerrou a transmissão de tela.`);
    }
  }

  #producerSource(value: unknown, kind: unknown): ProducerSource {
    if (value === 'microphone' || value === 'screen-video' || value === 'screen-audio') return value;
    if (value == null && kind === 'audio') return 'microphone';
    throw new MediaError('BAD_MEDIA_SOURCE', 'Fonte de mídia inválida.');
  }

  #screenAppData(input: any): Record<string, unknown> {
    const shareId = typeof input?.shareId === 'string' && input.shareId.length <= 80 ? input.shareId : '';
    if (!shareId) throw new MediaError('BAD_SCREEN_SHARE', 'Identificador da transmissão ausente.');
    const resolution = isScreenResolution(input?.resolution) ? input.resolution : '720p';
    const fps = isScreenFps(input?.fps) ? input.fps : 30;
    const width = Number.isFinite(input?.width) ? Math.max(1, Math.min(3840, Math.round(input.width))) : undefined;
    const height = Number.isFinite(input?.height) ? Math.max(1, Math.min(2160, Math.round(input.height))) : undefined;
    const sourceType = typeof input?.sourceType === 'string' && input.sourceType.length <= 32 ? input.sourceType : undefined;
    return {
      shareId,
      resolution,
      fps,
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
      ...(sourceType ? { sourceType } : {}),
      audio: Boolean(input?.audio)
    };
  }

  #producerPublicInfo(producer: any): Record<string, unknown> {
    return {
      producerId: producer.id,
      channelId: producer.appData?.channelId,
      displayName: String(producer.appData?.displayName ?? 'Participante'),
      source: producer.appData?.source,
      shareId: producer.appData?.shareId,
      resolution: producer.appData?.resolution,
      fps: producer.appData?.fps,
      width: producer.appData?.width,
      height: producer.appData?.height,
      sourceType: producer.appData?.sourceType,
      audio: producer.appData?.audio,
      simulcastLayers: producer.kind === 'video' ? Math.max(1, producer.rtpParameters?.encodings?.length ?? 1) : 1
    };
  }

  #transportOptions(transport: any): any {
    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
      sctpParameters: transport.sctpParameters
    };
  }

  #voiceSnapshot(serverId: string): any {
    const producers: Array<Record<string, unknown>> = [];
    for (const peer of this.#peers.values()) {
      if (peer.serverId !== serverId) continue;
      for (const producer of peer.producers.values()) {
        if (!producer || producer.closed) continue;
        producers.push(this.#producerPublicInfo(producer));
      }
    }
    return { members: this.#publicMembers(serverId), producers };
  }

  #publicMembers(serverId: string): Array<Omit<VoiceMemberState, 'token' | 'serverId'>> {
    return this.#voice.listServer(serverId).map(({ token: _token, serverId: _serverId, ...member }) => member);
  }

  #recordVoiceSystemMessage(serverId: string, displayName: string, role: VoiceMemberState['role'], content: string): void {
    const textChannel = this.#db.listChannels(serverId).find(channel => channel.type === 'text');
    if (!textChannel) return;
    try {
      const message = this.#db.addMessage({
        serverId,
        channelId: textChannel.id,
        authorName: displayName,
        authorRole: role,
        content,
        kind: 'system'
      });
      this.#sink?.broadcastToServer(serverId, { type: 'chat.message', message });
    } catch (error) {
      this.#logger.warn('Não foi possível registrar evento da chamada no chat', {
        serverId,
        user: displayName,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  #broadcastVoiceState(serverId: string): void {
    this.#eventBroadcast(serverId, 'voice.state', { members: this.#publicMembers(serverId) });
  }

  #eventTo(token: string, event: string, data: unknown): void {
    this.#sink?.sendToSession(token, { type: 'media.event', event, data });
  }

  #eventBroadcast(serverId: string, event: string, data: unknown, excludeToken?: string): void {
    this.#sink?.broadcastToServer(serverId, { type: 'media.event', event, data }, excludeToken);
  }
}
