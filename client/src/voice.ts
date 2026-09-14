import { Device } from 'mediasoup-client';
import { SCREEN_RESOLUTIONS, recommendedScreenBitrateKbps } from './screen-config.js';
import { getState, updateScreen, updateVoice } from './state.js';
import type { RemoteScreenInfo, ScreenFps, ScreenResolutionName, ScreenSourcePreference, VoiceMemberInfo } from './types.js';
import type { RealtimeClient } from './ws.js';
import { applyNativeProcessingConstraints, createMicrophonePipeline, nativeMicrophoneConstraints, needsAudioWorklet, type MicrophoneDiagnostic, type MicrophonePipeline } from './microphone-processing.js';
import { loadVoiceAudioPreferences, type VoiceAudioPreferences } from './voice-audio-preferences.js';
import { RemotePlaybackBoostManager, clampRemoteVolumePercent, needsRemoteBoost, type RemoteBoostHandle } from './remote-playback-boost.js';
import { buildScreenSimulcastEncodings, priorityForMode, screenVideoMode, spatialLayerForMode, type ScreenVideoMode } from './screen-multistream.js';

interface RemoteAudio {
  producerId: string;
  displayName: string;
  consumer: any;
  audio: HTMLAudioElement;
  boost?: RemoteBoostHandle;
  boostAudio?: HTMLAudioElement;
  requestedVolumePercent: number;
  volumeRevision: number;
}

interface RemoteScreenMedia {
  shareId: string;
  displayName: string;
  videoProducerId?: string;
  audioProducerId?: string;
  videoConsumer?: any;
  audioConsumer?: any;
  video: HTMLVideoElement;
  audio?: HTMLAudioElement;
  videoPaused: boolean;
  audioMuted: boolean;
  preferredSpatialLayer?: number;
  appliedVideoMode?: ScreenVideoMode;
  audioConsumerPaused?: boolean;
  info: RemoteScreenInfo;
}

export class VoiceController {
  #realtime: RealtimeClient;
  #notify: (message: string, error?: boolean) => void;
  #device?: any;
  #sendTransport?: any;
  #recvTransport?: any;
  #producer?: any;
  #micTrack?: MediaStreamTrack;
  #micSourceTrack?: MediaStreamTrack;
  #micPipeline?: MicrophonePipeline;
  #audioPreferences: VoiceAudioPreferences = loadVoiceAudioPreferences();
  #micDiagnostic?: MicrophoneDiagnostic;
  #remote = new Map<string, RemoteAudio>();
  #locallyMuted = new Set<string>();
  #remoteVolumes = new Map<string, number>();
  #remoteBoost = new RemotePlaybackBoostManager();
  #muteAllRemote = false;
  #joining = false;
  #recovering = false;
  #statsTimer?: number;
  #audioRoot: HTMLElement;
  #screenParking: HTMLElement;
  #screenStream?: MediaStream;
  #screenVideoProducer?: any;
  #screenAudioProducer?: any;
  #screenLocalVideo?: HTMLVideoElement;
  #screenRemotes = new Map<string, RemoteScreenMedia>();
  #screenStopping = false;

  constructor(realtime: RealtimeClient, notify: (message: string, error?: boolean) => void) {
    this.#realtime = realtime;
    this.#notify = notify;
    this.#audioRoot = document.createElement('div');
    this.#audioRoot.id = 'verdant-remote-audio';
    this.#audioRoot.hidden = true;
    document.body.append(this.#audioRoot);

    this.#screenParking = document.createElement('div');
    this.#screenParking.id = 'verdant-screen-parking';
    this.#screenParking.setAttribute('aria-hidden', 'true');
    Object.assign(this.#screenParking.style, {
      position: 'fixed', left: '-10000px', top: '0', width: '2px', height: '2px', overflow: 'hidden', opacity: '0.01', pointerEvents: 'none'
    });
    document.body.append(this.#screenParking);

    realtime.onMediaEvent = (event, data) => void this.handleMediaEvent(event, data);
    realtime.onConnectionLost = () => {
      if (getState().voice.joinedChannelId) updateVoice({ status: 'reconnecting', transportState: 'sinalização perdida' });
    };
    realtime.onConnectionOpen = reconnected => {
      if (reconnected && getState().voice.joinedChannelId) void this.recover();
    };
    navigator.mediaDevices?.addEventListener?.('devicechange', () => void this.refreshDevices());
  }

  get isJoined(): boolean { return Boolean(getState().voice.joinedChannelId); }
  get isScreenSharing(): boolean { return getState().voice.screen.localActive; }
  get microphoneDiagnostic(): MicrophoneDiagnostic | undefined { return this.#micDiagnostic ? { ...this.#micDiagnostic } : undefined; }
  isLocallyMuted(displayName: string): boolean { return this.#muteAllRemote || this.#locallyMuted.has(normalize(displayName)); }

  async applyAudioPreferences(preferences: VoiceAudioPreferences): Promise<void> {
    const previous = this.#audioPreferences;
    const next = { ...preferences };
    this.#audioPreferences = next;
    const sourceTrack = this.#micSourceTrack;
    if (!sourceTrack || !this.#producer) return;

    let nextPipeline: MicrophonePipeline | undefined;
    try {
      const nativeChanged = previous.noiseSuppression !== next.noiseSuppression || previous.suppressorModel !== next.suppressorModel;
      if (nativeChanged) await applyNativeProcessingConstraints(sourceTrack, next);
      const previousNeedsWorklet = needsAudioWorklet(previous);
      const nextNeedsWorklet = needsAudioWorklet(next);

      if (previousNeedsWorklet === nextNeedsWorklet && this.#micPipeline) {
        this.#micPipeline.update(next);
        return;
      }

      nextPipeline = await this.#createMicPipeline(sourceTrack);
      const nextTrack = nextPipeline.outputTrack;
      await this.#producer.replaceTrack({ track: nextTrack });

      const previousPipeline = this.#micPipeline;
      this.#micPipeline = nextPipeline;
      this.#micTrack = nextTrack;
      this.#applyMicTrackState();
      if (previousPipeline && previousPipeline !== nextPipeline) await previousPipeline.dispose();
    } catch (error) {
      if (nextPipeline && nextPipeline !== this.#micPipeline) await nextPipeline.dispose().catch(() => {});
      this.#audioPreferences = previous;
      if (previous.noiseSuppression !== next.noiseSuppression || previous.suppressorModel !== next.suppressorModel) {
        await applyNativeProcessingConstraints(sourceTrack, previous).catch(() => {});
      }
      this.#micPipeline?.update(previous);
      this.#notify(`Não foi possível aplicar o processamento do microfone: ${errorMessage(error)}`, true);
      throw error;
    }
  }

  getLocalVolume(displayName: string): number {
    const key = normalize(displayName);
    const cached = this.#remoteVolumes.get(key);
    if (typeof cached === 'number') return cached;
    const stored = this.#readStoredVolume(displayName);
    this.#remoteVolumes.set(key, stored);
    return stored;
  }

  setLocalVolume(displayName: string, volumePercent: number): void {
    const value = clampVolumePercent(volumePercent);
    const key = normalize(displayName);
    this.#remoteVolumes.set(key, value);
    this.#writeStoredVolume(displayName, value);
    for (const item of this.#remote.values()) {
      if (normalize(item.displayName) !== key) continue;
      void this.#applyRemotePlaybackVolume(item, value, true);
    }
  }

  async join(channelId: string): Promise<void> {
    if (this.#joining) return;
    if (getState().voice.joinedChannelId === channelId && getState().voice.status === 'connected') return;
    this.#assertMediaReady();
    const browsing = getState();
    if (!browsing.session || !browsing.server) throw new Error('Entre no servidor antes de iniciar a chamada.');
    if (browsing.voice.joinedServerId && browsing.voice.joinedServerId !== browsing.server.id) {
      await this.leave();
    }
    if (!this.#realtime.connected) {
      this.#realtime.start(browsing.session.token);
      await this.#realtime.waitUntilOpen();
    }
    this.#joining = true;
    const previousChannel = getState().voice.joinedChannelId;
    if (previousChannel && previousChannel !== channelId) await this.leave();

    updateVoice({
      status: 'joining', joinedChannelId: channelId,
      joinedServerId: browsing.server.id, joinedServerName: browsing.server.name,
      joinedDisplayName: browsing.session.displayName,
      lastError: undefined, transportState: 'preparando SFU'
    });
    try {
      const joined = await this.#realtime.requestMedia('voice.join', { channelId });
      this.#device = new Device();
      await this.#device.load({ routerRtpCapabilities: joined.routerRtpCapabilities });

      await this.#createTransports();
      await this.#openMicrophone();

      for (const producer of Array.isArray(joined.producers) ? joined.producers : []) {
        await this.#consumeProducer(producer);
      }
      updateVoice({
        status: 'connected',
        members: Array.isArray(joined.members) ? joined.members as VoiceMemberInfo[] : [],
        transportState: 'conectado'
      });
      await this.refreshDevices();
      this.#startStats();
      this.#notify('Conectado ao canal de voz.');
    } catch (error) {
      const message = errorMessage(error);
      await this.#cleanupLocal();
      updateVoice({ status: 'error', joinedChannelId: undefined, lastError: message, transportState: 'erro' });
      try { await this.#realtime.requestMedia('voice.leave'); } catch {}
      this.#notify(message, true);
      throw error;
    } finally {
      this.#joining = false;
    }
  }

  async leave(): Promise<void> {
    const wasJoined = Boolean(getState().voice.joinedChannelId);
    await this.#cleanupLocal();
    updateVoice({
      status: 'idle',
      joinedChannelId: undefined,
      joinedServerId: undefined,
      joinedServerName: undefined,
      joinedDisplayName: undefined,
      members: [],
      speaking: new Set(),
      adminMuted: false,
      transportState: undefined,
      lastError: undefined
    });
    if (wasJoined) {
      try { await this.#realtime.requestMedia('voice.leave'); } catch {}
    }
    this.#realtime.stop();
  }

  async toggleMute(): Promise<void> {
    if (!this.isJoined) return this.#notify('Entre em um canal de voz primeiro.', true);
    const next = !getState().voice.muted;
    updateVoice({ muted: next });
    this.#applyMicTrackState();
    try {
      if (this.#producer) {
        if (next) this.#producer.pause();
        else if (!getState().voice.adminMuted) this.#producer.resume();
      }
      await this.#realtime.requestMedia(next ? 'producer.pause' : 'producer.resume', { source: 'microphone' });
    } catch (error) {
      updateVoice({ muted: !next });
      this.#applyMicTrackState();
      this.#notify(errorMessage(error), true);
    }
  }

  async toggleDeafen(): Promise<void> {
    if (!this.isJoined) return this.#notify('Entre em um canal de voz primeiro.', true);
    const next = !getState().voice.deafened;
    updateVoice({ deafened: next });
    await this.#applyDeafenToConsumers(next);
    try {
      await this.#realtime.requestMedia('voice.deafen', { deafened: next });
    } catch (error) {
      updateVoice({ deafened: !next });
      await this.#applyDeafenToConsumers(!next);
      this.#notify(errorMessage(error), true);
    }
  }

  async adminMute(displayName: string, muted: boolean): Promise<void> {
    try {
      await this.#realtime.requestMedia('voice.adminMute', { displayName, muted });
    } catch (error) {
      this.#notify(errorMessage(error), true);
    }
  }

  async setInputDevice(deviceId: string): Promise<void> {
    if (!this.isJoined || !this.#producer) {
      updateVoice({ inputDeviceId: deviceId || undefined });
      return;
    }
    let nextSource: MediaStreamTrack | undefined;
    let nextPipeline: MicrophonePipeline | undefined;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: nativeMicrophoneConstraints(this.#audioPreferences, deviceId) });
      nextSource = stream.getAudioTracks()[0];
      if (!nextSource) throw new Error('O dispositivo selecionado não forneceu áudio.');
      nextPipeline = await this.#createMicPipeline(nextSource);
      await this.#producer.replaceTrack({ track: nextPipeline.outputTrack });

      const previousSource = this.#micSourceTrack;
      const previousPipeline = this.#micPipeline;
      this.#micSourceTrack = nextSource;
      this.#micPipeline = nextPipeline;
      this.#micTrack = nextPipeline.outputTrack;
      updateVoice({ inputDeviceId: deviceId || nextSource.getSettings().deviceId });
      this.#applyMicTrackState();

      if (previousPipeline) await previousPipeline.dispose();
      if (previousSource && previousSource !== nextSource) previousSource.stop();
      await this.refreshDevices();
    } catch (error) {
      if (nextPipeline && nextPipeline !== this.#micPipeline) await nextPipeline.dispose().catch(() => {});
      if (nextSource && nextSource !== this.#micSourceTrack) nextSource.stop();
      this.#notify(`Não foi possível trocar o microfone: ${errorMessage(error)}`, true);
    }
  }

  async setOutputDevice(deviceId: string): Promise<void> {
    updateVoice({ outputDeviceId: deviceId || undefined });
    for (const item of this.#remote.values()) {
      await applySink(item.audio, deviceId).catch(() => {});
      if (item.boostAudio) await applySink(item.boostAudio, deviceId).catch(() => {});
    }
    for (const remote of this.#screenRemotes.values()) {
      if (remote.audio) await applySink(remote.audio, deviceId).catch(() => {});
    }
  }

  async requestOutputDevice(): Promise<void> {
    const select = (navigator.mediaDevices as any)?.selectAudioOutput;
    if (typeof select !== 'function') {
      this.#notify('Este navegador não oferece seleção direta de saída de áudio. Use a saída padrão do sistema.', true);
      return;
    }
    try {
      const info = await select.call(navigator.mediaDevices);
      if (info?.deviceId) await this.setOutputDevice(info.deviceId);
      await this.refreshDevices();
    } catch (error) {
      this.#notify(`Seleção de saída cancelada ou indisponível: ${errorMessage(error)}`, true);
    }
  }

  async setLocalMuted(displayName: string, muted: boolean): Promise<void> {
    const key = normalize(displayName);
    if (muted) this.#locallyMuted.add(key);
    else this.#locallyMuted.delete(key);
    for (const item of this.#remote.values()) {
      if (normalize(item.displayName) !== key) continue;
      await this.#setRemotePaused(item, muted || getState().voice.deafened || this.#muteAllRemote);
    }
    updateVoice({ members: [...getState().voice.members] });
  }

  async muteAllRemotes(muted: boolean): Promise<void> {
    this.#muteAllRemote = muted;
    for (const member of getState().voice.members) {
      if (member.displayName === getState().session?.displayName) continue;
      const key = normalize(member.displayName);
      if (muted) this.#locallyMuted.add(key);
      else this.#locallyMuted.delete(key);
    }
    for (const item of this.#remote.values()) await this.#setRemotePaused(item, muted || getState().voice.deafened);
    updateVoice({ members: [...getState().voice.members] });
  }

  async refreshDevices(): Promise<void> {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputDevices = devices.filter(device => device.kind === 'audioinput');
      const outputDevices = devices.filter(device => device.kind === 'audiooutput');
      updateVoice({ inputDevices, outputDevices });
    } catch {}
  }

  setScreenResolution(value: ScreenResolutionName): void { updateScreen({ resolution: value }); }
  setScreenFps(value: ScreenFps): void { updateScreen({ fps: value }); }
  setScreenAudio(value: boolean): void { updateScreen({ includeAudio: value }); }
  setScreenSourcePreference(value: ScreenSourcePreference): void { updateScreen({ sourcePreference: value }); }
  setScreenBitrate(value: number): void { updateScreen({ bitrateKbps: Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0 }); }

  async startScreenShare(): Promise<void> {
    try {
      this.#assertScreenReady();
    } catch (error) {
      this.#notify(errorMessage(error), true);
      return;
    }
    if (getState().voice.screen.localActive || getState().voice.screen.status === 'starting') return;
    if (!this.#sendTransport || !this.#device) throw new Error('Transporte de envio não está pronto.');

    const config = { ...getState().voice.screen };
    const preset = SCREEN_RESOLUTIONS[config.resolution];
    const shareId = createShareId();
    updateScreen({ status: 'starting', lastError: undefined });

    let stream: MediaStream | undefined;
    try {
      const displayConstraints = buildDisplayConstraints(config.resolution, config.fps, config.includeAudio, config.sourcePreference);
      const captured = await (navigator.mediaDevices as any).getDisplayMedia(displayConstraints) as MediaStream;
      stream = captured;
      const videoTrack = captured.getVideoTracks()[0];
      if (!videoTrack) throw new Error('O navegador não forneceu uma faixa de vídeo para a transmissão.');
      const audioTrack = captured.getAudioTracks()[0];
      videoTrack.contentHint = 'detail';

      try {
        await videoTrack.applyConstraints({
          width: { ideal: preset.width },
          height: { ideal: preset.height },
          frameRate: { ideal: config.fps, max: config.fps }
        });
      } catch {
        // O navegador pode manter a resolução nativa da fonte; exibimos os valores reais abaixo.
      }

      const settings = videoTrack.getSettings();
      const maxBitrateKbps = config.bitrateKbps || recommendedScreenBitrateKbps(config.resolution, config.fps);
      const vp8 = this.#device.rtpCapabilities?.codecs?.find((codec: any) => String(codec.mimeType).toLowerCase() === 'video/vp8');
      this.#screenVideoProducer = await this.#sendTransport.produce({
        track: videoTrack,
        streamId: shareId,
        stopTracks: false,
        // Chromium negocia três encodings VP8. Em grade usamos a camada baixa;
        // ao focar uma transmissão o servidor sobe para a camada alta.
        encodings: buildScreenSimulcastEncodings(maxBitrateKbps, config.fps),
        ...(vp8 ? { codec: vp8 } : {}),
        appData: {
          source: 'screen-video',
          shareId,
          resolution: config.resolution,
          fps: config.fps,
          width: settings.width ?? preset.width,
          height: settings.height ?? preset.height,
          sourceType: settings.displaySurface ?? config.sourcePreference,
          audio: Boolean(audioTrack)
        }
      });

      if (audioTrack) {
        try {
          this.#screenAudioProducer = await this.#sendTransport.produce({
            track: audioTrack,
            streamId: shareId,
            stopTracks: false,
            codecOptions: { opusDtx: false, opusFec: true, opusStereo: true },
            appData: {
              source: 'screen-audio',
              shareId,
              resolution: config.resolution,
              fps: config.fps,
              width: settings.width ?? preset.width,
              height: settings.height ?? preset.height,
              sourceType: settings.displaySurface ?? config.sourcePreference,
              audio: true
            }
          });
        } catch (error) {
          this.#notify(`A tela foi compartilhada, mas o áudio não pôde ser enviado: ${errorMessage(error)}`, true);
          try { audioTrack.stop(); } catch {}
        }
      } else if (config.includeAudio) {
        this.#notify('A tela foi compartilhada, mas este navegador/fonte não forneceu áudio. Isso pode variar entre Linux, Windows, janela, aba e tela inteira.', true);
      }

      this.#screenStream = stream;
      this.#screenLocalVideo = createVideoElement('local');
      this.#screenLocalVideo.muted = true;
      this.#screenLocalVideo.srcObject = new MediaStream([videoTrack]);
      this.#screenParking.append(this.#screenLocalVideo);
      await this.#screenLocalVideo.play().catch(() => {});

      const stop = () => void this.stopScreenShare();
      videoTrack.addEventListener('ended', stop, { once: true });
      this.#screenVideoProducer.on?.('trackended', stop);
      this.#screenVideoProducer.on?.('transportclose', () => void this.#finishLocalScreen(false));

      const actual = videoTrack.getSettings();
      updateScreen({
        status: 'sharing',
        localActive: true,
        localShareId: shareId,
        audioCaptured: Boolean(this.#screenAudioProducer),
        actualWidth: actual.width ?? preset.width,
        actualHeight: actual.height ?? preset.height,
        actualFps: actual.frameRate ?? config.fps,
        sourceType: actual.displaySurface ?? config.sourcePreference,
        lastError: undefined
      });
      this.#notify(`Transmitindo ${config.resolution} a ${config.fps} FPS${this.#screenAudioProducer ? ' com áudio' : ''}.`);
    } catch (error) {
      if (stream) for (const track of stream.getTracks()) try { track.stop(); } catch {}
      if (this.#screenAudioProducer) {
        try { await this.#realtime.requestMedia('producer.close', { source: 'screen-audio' }); } catch {}
      }
      if (this.#screenVideoProducer) {
        try { await this.#realtime.requestMedia('producer.close', { source: 'screen-video' }); } catch {}
      }
      await this.#finishLocalScreen(true);
      const message = errorMessage(error);
      const cancelled = isDisplayCaptureCancelled(error);
      updateScreen({
        status: getState().voice.screen.remotes.length ? 'receiving' : 'idle',
        localActive: false,
        lastError: cancelled ? undefined : message
      });
      if (!cancelled) this.#notify(`Falha ao compartilhar tela: ${message}`, true);
      if (!cancelled) throw error;
    }
  }

  async stopScreenShare(): Promise<void> {
    if (this.#screenStopping) return;
    this.#screenStopping = true;
    try {
      if (this.#screenAudioProducer) {
        try { await this.#realtime.requestMedia('producer.close', { source: 'screen-audio' }); } catch {}
      }
      if (this.#screenVideoProducer) {
        try { await this.#realtime.requestMedia('producer.close', { source: 'screen-video' }); } catch {}
      }
      await this.#finishLocalScreen(true);
      this.#notify('Transmissão de tela encerrada.');
    } finally {
      this.#screenStopping = false;
    }
  }

  async adminStopScreen(displayName: string): Promise<void> {
    try {
      await this.#realtime.requestMedia('screen.adminStop', { displayName });
      this.#notify(`Transmissão de ${displayName} encerrada.`);
    } catch (error) {
      this.#notify(errorMessage(error), true);
    }
  }

  mountLocalScreenVideo(host: HTMLElement): boolean {
    const video = this.#screenLocalVideo;
    if (!video) return false;
    if (video.parentElement !== host) host.append(video);
    void video.play().catch(() => {});
    return true;
  }

  mountRemoteScreenVideo(shareId: string, host: HTMLElement): boolean {
    const remote = this.#screenRemotes.get(shareId);
    if (!remote?.video) return false;
    if (remote.video.parentElement !== host) host.append(remote.video);
    if (!remote.videoPaused) void remote.video.play().catch(() => {});
    return true;
  }

  focusScreen(shareId?: string): void {
    const screen = getState().voice.screen;
    const valid = !shareId || shareId === screen.localShareId || this.#screenRemotes.has(shareId);
    updateScreen({ focusedShareId: valid ? shareId : undefined });
    void this.#applyScreenSubscriptionPolicy();
  }

  async setScreenAudioMuted(shareId: string, muted: boolean): Promise<void> {
    const remote = this.#screenRemotes.get(shareId);
    if (!remote) return;
    remote.audioMuted = muted;
    await this.#applyScreenAudioState(remote);
    this.#publishRemoteScreens();
  }

  async muteAllScreenAudio(muted: boolean): Promise<void> {
    updateScreen({ allAudioMuted: muted });
    for (const remote of this.#screenRemotes.values()) await this.#applyScreenAudioState(remote);
    this.#publishRemoteScreens();
  }

  async recover(): Promise<void> {
    if (this.#recovering || this.#joining) return;
    const channelId = getState().voice.joinedChannelId;
    if (!channelId) return;
    this.#recovering = true;
    const { muted, deafened, inputDeviceId, outputDeviceId } = getState().voice;
    updateVoice({ status: 'reconnecting', transportState: 'recriando transportes' });
    try {
      await this.#cleanupLocal();
      updateVoice({ muted, deafened, inputDeviceId, outputDeviceId, joinedChannelId: channelId });
      await this.join(channelId);
    } catch {
      // join() já atualiza estado e informa o usuário.
    } finally {
      this.#recovering = false;
    }
  }

  async handleMediaEvent(event: string, data: any): Promise<void> {
    if (event === 'voice.state') {
      const members = Array.isArray(data?.members) ? data.members as VoiceMemberInfo[] : [];
      const self = members.find(member => member.displayName === getState().session?.displayName);
      const joining = getState().voice.status === 'joining';
      updateVoice({
        members,
        ...(self ? {
          ...(joining ? {} : { muted: self.selfMuted, deafened: self.deafened }),
          adminMuted: self.adminMuted
        } : {})
      });
      this.#applyMicTrackState();
      return;
    }
    if (event === 'voice.producerAvailable') {
      if (data?.channelId !== getState().voice.joinedChannelId) return;
      if (data?.displayName === getState().session?.displayName) return;
      await this.#consumeProducer(data).catch(error => this.#notify(`Falha ao receber ${data?.displayName ?? 'participante'}: ${errorMessage(error)}`, true));
      return;
    }
    if (event === 'voice.producerClosed') {
      if (typeof data?.producerId !== 'string') return;
      if (data?.source === 'screen-video' || data?.source === 'screen-audio') this.#closeRemoteScreenProducer(data.producerId, data?.source);
      else this.#closeRemote(data.producerId);
      return;
    }
    if (event === 'voice.speaking') {
      const channel = getState().voice.joinedChannelId;
      if (data?.channelId && data.channelId !== channel) return;
      const names = new Set<string>();
      for (const speaker of Array.isArray(data?.speakers) ? data.speakers : []) {
        if (typeof speaker?.displayName === 'string') names.add(speaker.displayName);
      }
      if (!sameStringSet(names, getState().voice.speaking)) updateVoice({ speaking: names });
      return;
    }
    if (event === 'voice.adminMute') {
      const muted = Boolean(data?.muted);
      updateVoice({ adminMuted: muted });
      this.#applyMicTrackState();
      if (this.#producer) {
        if (muted) this.#producer.pause();
        else if (!getState().voice.muted) this.#producer.resume();
      }
      this.#notify(muted ? `${data?.by ?? 'Um moderador'} silenciou seu microfone no servidor.` : 'Seu mute administrativo foi removido.');
      return;
    }
    if (event === 'voice.screenAdminStopped') {
      await this.#finishLocalScreen(true);
      this.#notify(`${data?.by ?? 'Um moderador'} encerrou sua transmissão de tela.`, true);
      return;
    }
    if (event === 'voice.transportState') {
      if (typeof data?.iceState === 'string') updateVoice({ transportState: `${data.direction ?? 'transporte'}: ${data.iceState}` });
    }
  }

  async resumePlayback(): Promise<void> {
    const boostRunning = await this.#remoteBoost.resume().catch(() => false);
    for (const item of this.#remote.values()) {
      if (item.boost && !boostRunning) this.#fallbackRemoteToDirect(item);
      if (needsRemoteBoost(item.requestedVolumePercent) && !item.boost) {
        await this.#applyRemotePlaybackVolume(item, item.requestedVolumePercent, false);
      }
      if (!item.audio.muted) await item.audio.play().catch(() => {});
      if (item.boostAudio && !item.boostAudio.muted) {
        const boostedReady = await item.boostAudio.play().then(() => true).catch(() => false);
        if (!boostedReady) {
          this.#fallbackRemoteToDirect(item);
          if (!item.audio.muted) await item.audio.play().catch(() => {});
        }
      }
    }
    for (const remote of this.#screenRemotes.values()) {
      if (remote.audio && !remote.audio.muted) await remote.audio.play().catch(() => {});
      if (!remote.videoPaused) await remote.video.play().catch(() => {});
    }
  }

  async #createTransports(): Promise<void> {
    if (!this.#device) throw new Error('Dispositivo WebRTC não carregado.');
    const sendOptions = await this.#realtime.requestMedia('transport.create', { direction: 'send' });
    this.#sendTransport = this.#device.createSendTransport(sendOptions);
    this.#wireTransport(this.#sendTransport, 'send');
    this.#sendTransport.on('produce', ({ kind, rtpParameters, appData }: any, callback: any, errback: any) => {
      this.#realtime.requestMedia('producer.create', {
        transportId: this.#sendTransport.id,
        kind,
        rtpParameters,
        appData
      }).then((response: any) => callback({ id: response.id })).catch(errback);
    });

    const recvOptions = await this.#realtime.requestMedia('transport.create', { direction: 'recv' });
    this.#recvTransport = this.#device.createRecvTransport(recvOptions);
    this.#wireTransport(this.#recvTransport, 'recv');
  }

  #wireTransport(transport: any, direction: 'send' | 'recv'): void {
    transport.on('connect', ({ dtlsParameters }: any, callback: any, errback: any) => {
      this.#realtime.requestMedia('transport.connect', { transportId: transport.id, dtlsParameters })
        .then(() => callback())
        .catch(errback);
    });
    transport.on('connectionstatechange', (state: string) => {
      updateVoice({ transportState: `${direction}: ${state}` });
      if (state === 'failed') void this.#restartTransportIce(transport);
    });
  }

  async #restartTransportIce(transport: any): Promise<void> {
    try {
      const response = await this.#realtime.requestMedia('transport.restartIce', { transportId: transport.id });
      await transport.restartIce({ iceParameters: response.iceParameters });
    } catch {
      updateVoice({ status: 'reconnecting', transportState: 'ICE falhou; aguardando reconexão' });
    }
  }

  async #openMicrophone(): Promise<void> {
    const selected = getState().voice.inputDeviceId;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: nativeMicrophoneConstraints(this.#audioPreferences, selected) });
    const sourceTrack = stream.getAudioTracks()[0];
    if (!sourceTrack) throw new Error('Nenhuma faixa de microfone foi fornecida pelo navegador.');

    let pipeline: MicrophonePipeline | undefined;
    try {
      pipeline = await this.#createMicPipeline(sourceTrack);
      this.#micSourceTrack = sourceTrack;
      this.#micPipeline = pipeline;
      this.#micTrack = pipeline.outputTrack;
      updateVoice({ inputDeviceId: sourceTrack.getSettings().deviceId ?? selected });
      this.#producer = await this.#sendTransport.produce({
        track: pipeline.outputTrack,
        stopTracks: false,
        codecOptions: { opusDtx: true, opusFec: true },
        appData: { source: 'microphone' }
      });
      this.#applyMicTrackState();
      if (getState().voice.muted) {
        this.#producer.pause();
        await this.#realtime.requestMedia('producer.pause', { source: 'microphone' });
      }
    } catch (error) {
      if (pipeline) await pipeline.dispose().catch(() => {});
      sourceTrack.stop();
      this.#micSourceTrack = undefined;
      this.#micPipeline = undefined;
      this.#micTrack = undefined;
      throw error;
    }
  }

  async #createMicPipeline(sourceTrack: MediaStreamTrack): Promise<MicrophonePipeline> {
    return createMicrophonePipeline(sourceTrack, this.#audioPreferences, diagnostic => {
      this.#micDiagnostic = diagnostic;
    });
  }

  async #consumeProducer(source: any): Promise<void> {
    const producerId = typeof source?.producerId === 'string' ? source.producerId : '';
    if (!producerId || !this.#recvTransport || !this.#device) return;
    const mediaSource = typeof source?.source === 'string' ? source.source : 'microphone';
    if (mediaSource === 'microphone' && this.#remote.has(producerId)) return;
    if ((mediaSource === 'screen-video' || mediaSource === 'screen-audio') && this.#screenProducerKnown(producerId)) return;

    const data = await this.#realtime.requestMedia('consumer.create', {
      transportId: this.#recvTransport.id,
      producerId,
      rtpCapabilities: this.#device.recvRtpCapabilities
    });
    const consumeOptions: any = {
      id: data.id,
      producerId: data.producerId,
      kind: data.kind,
      rtpParameters: data.rtpParameters,
      appData: data.appData
    };
    if ((mediaSource === 'screen-video' || mediaSource === 'screen-audio') && data.appData?.shareId) {
      consumeOptions.streamId = `screen-${data.appData.shareId}`;
    }
    const consumer = await this.#recvTransport.consume(consumeOptions);
    const resolvedSource = String(data.appData?.source ?? mediaSource);
    if (resolvedSource === 'screen-video' || resolvedSource === 'screen-audio') {
      await this.#attachScreenConsumer(consumer, data, source);
      return;
    }
    await this.#attachMicrophoneConsumer(consumer, data, source);
  }

  #volumeStorageKey(displayName: string): string {
    const serverId = getState().voice.joinedServerId ?? getState().server?.id ?? 'no-server';
    return `verdant:voice-volume:${serverId}:${normalize(displayName)}`;
  }

  #readStoredVolume(displayName: string): number {
    try {
      const raw = localStorage.getItem(this.#volumeStorageKey(displayName));
      if (raw == null) return 100;
      return clampVolumePercent(Number(raw));
    } catch {
      return 100;
    }
  }

  #writeStoredVolume(displayName: string, value: number): void {
    try {
      localStorage.setItem(this.#volumeStorageKey(displayName), String(clampVolumePercent(value)));
    } catch {}
  }

  async #attachMicrophoneConsumer(consumer: any, data: any, source: any): Promise<void> {
    const producerId = data.producerId as string;
    const displayName = String(data.appData?.producerDisplayName ?? source.displayName ?? 'Participante');
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.setAttribute('playsinline', '');
    // O caminho 0–100% continua sendo o Consumer direto. Nenhum AudioContext
    // fica entre o Consumer e o alto-falante enquanto boost não é necessário.
    audio.srcObject = new MediaStream([consumer.track]);
    audio.dataset.producerId = producerId;
    audio.dataset.displayName = displayName;
    audio.dataset.source = 'microphone';
    this.#audioRoot.append(audio);

    const storedVolume = this.getLocalVolume(displayName);
    const remote: RemoteAudio = {
      producerId,
      displayName,
      consumer,
      audio,
      requestedVolumePercent: storedVolume,
      volumeRevision: 0
    };
    this.#remote.set(producerId, remote);

    // Primeiro deixa a reprodução direta funcional. Boost >100% só substitui
    // a saída depois que o caminho auxiliar estiver realmente tocando.
    audio.volume = Math.min(1, storedVolume / 100);
    const outputId = getState().voice.outputDeviceId;
    if (outputId) await applySink(audio, outputId).catch(() => {});
    await this.#setRemotePaused(remote, getState().voice.deafened || this.isLocallyMuted(displayName));
    if (!audio.muted) {
      await audio.play().catch(() => this.#notify('O navegador bloqueou a reprodução automática. Clique em qualquer controle da chamada para liberar o áudio.', true));
    }
    if (needsRemoteBoost(storedVolume)) {
      await this.#applyRemotePlaybackVolume(remote, storedVolume, false);
    }
  }

  async #applyRemotePlaybackVolume(item: RemoteAudio, volumePercent: number, userInitiated: boolean): Promise<void> {
    const value = clampVolumePercent(volumePercent);
    item.requestedVolumePercent = value;
    const revision = ++item.volumeRevision;

    if (!needsRemoteBoost(value)) {
      this.#disposeRemoteBoost(item);
      item.audio.volume = value / 100;
      if (!item.audio.muted) await item.audio.play().catch(() => {});
      return;
    }

    if (item.boost && item.boostAudio) {
      this.#remoteBoost.update(item.boost, value);
      item.audio.volume = 0;
      item.boostAudio.volume = 1;
      return;
    }

    // Segurança contra silêncio: até o boost estar pronto, a track recebida
    // continua tocando diretamente em 100%.
    item.audio.volume = 1;

    const handle = await this.#remoteBoost.create(item.consumer.track, value);
    if (!handle || revision !== item.volumeRevision || !needsRemoteBoost(item.requestedVolumePercent)) {
      this.#remoteBoost.dispose(handle);
      if (revision === item.volumeRevision) item.audio.volume = 1;
      if (userInitiated && !handle) {
        this.#notify('O boost acima de 100% não pôde ser ativado agora. Mantive este participante em 100% para não perder o áudio.', true);
      }
      return;
    }

    const boostedAudio = document.createElement('audio');
    boostedAudio.autoplay = true;
    boostedAudio.setAttribute('playsinline', '');
    boostedAudio.dataset.producerId = item.producerId;
    boostedAudio.dataset.displayName = item.displayName;
    boostedAudio.dataset.source = 'remote-volume-boost';
    boostedAudio.srcObject = handle.destination.stream;
    boostedAudio.volume = 1;
    boostedAudio.muted = item.audio.muted;
    this.#audioRoot.append(boostedAudio);

    const outputId = getState().voice.outputDeviceId;
    if (outputId) await applySink(boostedAudio, outputId).catch(() => {});

    let playbackReady = boostedAudio.muted;
    if (!boostedAudio.muted) {
      playbackReady = await boostedAudio.play().then(() => true).catch(() => false);
    }

    if (!playbackReady || revision !== item.volumeRevision || !needsRemoteBoost(item.requestedVolumePercent)) {
      try { boostedAudio.pause(); } catch {}
      boostedAudio.srcObject = null;
      boostedAudio.remove();
      this.#remoteBoost.dispose(handle);
      if (revision === item.volumeRevision) item.audio.volume = 1;
      if (userInitiated && !playbackReady) {
        this.#notify('O Chromium bloqueou o boost de volume. Mantive este participante em 100%; clique em um controle da chamada e tente novamente.', true);
      }
      return;
    }

    item.boost = handle;
    item.boostAudio = boostedAudio;
    // Só silencia a reprodução direta depois que o caminho boost está pronto.
    item.audio.volume = 0;
  }

  #disposeRemoteBoost(item: RemoteAudio): void {
    if (item.boostAudio) {
      try { item.boostAudio.pause(); } catch {}
      item.boostAudio.srcObject = null;
      item.boostAudio.remove();
      item.boostAudio = undefined;
    }
    if (item.boost) {
      this.#remoteBoost.dispose(item.boost);
      item.boost = undefined;
    }
  }

  #fallbackRemoteToDirect(item: RemoteAudio): void {
    this.#disposeRemoteBoost(item);
    // O HTMLAudioElement é limitado a 100%. Se Web Audio falhar/suspender,
    // priorizamos áudio audível em vez de manter o participante silencioso.
    item.audio.volume = Math.min(1, item.requestedVolumePercent / 100);
  }

  async #attachScreenConsumer(consumer: any, data: any, source: any): Promise<void> {
    const shareId = String(data.appData?.shareId ?? source.shareId ?? 'screen');
    const displayName = String(data.appData?.producerDisplayName ?? source.displayName ?? 'Participante');
    let remote = this.#screenRemotes.get(shareId);
    if (!remote) {
      remote = {
        shareId,
        displayName,
        video: createVideoElement('remote'),
        videoPaused: true,
        audioMuted: false,
        info: {
          shareId,
          displayName,
          audio: false,
          videoPaused: true,
          audioMuted: false
        }
      };
      this.#screenParking.append(remote.video);
      this.#screenRemotes.set(shareId, remote);
    }
    remote.displayName = displayName;

    const resolvedSource = String(data.appData?.source ?? source.source ?? '');
    if (resolvedSource === 'screen-video') {
      if (remote.videoConsumer && remote.videoConsumer !== consumer) {
        try { remote.videoConsumer.close(); } catch {}
      }
      remote.videoProducerId = data.producerId;
      remote.videoConsumer = consumer;
      remote.appliedVideoMode = undefined;
      remote.preferredSpatialLayer = undefined;
      remote.video.srcObject = new MediaStream([consumer.track]);
      remote.videoPaused = true;
      remote.info = {
        ...remote.info,
        shareId,
        displayName,
        videoProducerId: data.producerId,
        sourceType: data.appData?.sourceType ?? source.sourceType ?? remote.info.sourceType,
        resolution: data.appData?.resolution ?? source.resolution ?? remote.info.resolution,
        fps: data.appData?.fps ?? source.fps ?? remote.info.fps,
        width: data.appData?.width ?? source.width ?? remote.info.width,
        height: data.appData?.height ?? source.height ?? remote.info.height,
        videoPaused: true,
        preferredSpatialLayer: undefined
      };
    } else {
      if (remote.audioConsumer && remote.audioConsumer !== consumer) {
        try { remote.audioConsumer.close(); } catch {}
      }
      if (remote.audio) {
        try { remote.audio.pause(); } catch {}
        remote.audio.srcObject = null;
        remote.audio.remove();
      }
      remote.audioProducerId = data.producerId;
      remote.audioConsumer = consumer;
      remote.audioConsumerPaused = undefined;
      const audio = document.createElement('audio');
      audio.autoplay = true;
      audio.setAttribute('playsinline', '');
      audio.dataset.source = 'screen-audio';
      audio.dataset.producerId = data.producerId;
      audio.dataset.shareId = shareId;
      audio.srcObject = new MediaStream([consumer.track]);
      this.#audioRoot.append(audio);
      remote.audio = audio;
      const outputId = getState().voice.outputDeviceId;
      if (outputId) await applySink(audio, outputId).catch(() => {});
      remote.info = {
        ...remote.info,
        shareId,
        displayName,
        audioProducerId: data.producerId,
        audio: true,
        audioMuted: remote.audioMuted,
        sourceType: data.appData?.sourceType ?? source.sourceType ?? remote.info.sourceType,
        resolution: data.appData?.resolution ?? source.resolution ?? remote.info.resolution,
        fps: data.appData?.fps ?? source.fps ?? remote.info.fps,
        width: data.appData?.width ?? source.width ?? remote.info.width,
        height: data.appData?.height ?? source.height ?? remote.info.height
      };
    }

    this.#publishRemoteScreens();
    await this.#applyScreenSubscriptionPolicy();
  }

  async #setRemotePaused(item: RemoteAudio, paused: boolean): Promise<void> {
    item.audio.muted = paused;
    if (item.boostAudio) item.boostAudio.muted = paused;
    try {
      if (paused) {
        if (!item.consumer.paused) item.consumer.pause();
        await this.#realtime.requestMedia('consumer.pause', { consumerId: item.consumer.id });
      } else {
        if (item.consumer.paused) item.consumer.resume();
        await this.#realtime.requestMedia('consumer.resume', { consumerId: item.consumer.id });
        if (needsRemoteBoost(item.requestedVolumePercent) && !item.boost) {
          await this.#applyRemotePlaybackVolume(item, item.requestedVolumePercent, false);
        }
        await item.audio.play().catch(() => {});
        if (item.boostAudio) {
          const boostedReady = await item.boostAudio.play().then(() => true).catch(() => false);
          if (!boostedReady) {
            this.#fallbackRemoteToDirect(item);
            await item.audio.play().catch(() => {});
          }
        }
      }
    } catch {
      // Fechamentos concorrentes de producer/consumer são esperados ao sair da chamada.
    }
  }

  async #setScreenVideoMode(remote: RemoteScreenMedia, mode: ScreenVideoMode): Promise<void> {
    const consumer = remote.videoConsumer;
    if (!consumer) return;

    if (mode === 'paused') {
      // Evita repetir sinalização pause a cada recalculo da política. O lado
      // cliente é pausado primeiro; se a sinalização falhar, appliedVideoMode
      // não avança e a próxima passagem tenta sincronizar o SFU novamente.
      if (remote.appliedVideoMode === 'paused' && consumer.paused) {
        remote.videoPaused = true;
        remote.preferredSpatialLayer = undefined;
        return;
      }
      try {
        if (!consumer.paused) consumer.pause();
        if (remote.appliedVideoMode !== 'paused') {
          await this.#realtime.requestMedia('consumer.pause', { consumerId: consumer.id });
        }
        remote.appliedVideoMode = 'paused';
      } catch {}
      remote.videoPaused = true;
      remote.preferredSpatialLayer = undefined;
      return;
    }

    const spatialLayer = spatialLayerForMode(mode);
    if (typeof spatialLayer === 'number' && remote.preferredSpatialLayer !== spatialLayer) {
      try {
        await this.#realtime.requestMedia('consumer.quality', {
          consumerId: consumer.id,
          spatialLayer,
          priority: priorityForMode(mode)
        });
        remote.preferredSpatialLayer = spatialLayer;
      } catch {
        // Qualidade é otimização. O vídeo ainda pode ser retomado na camada
        // disponível e a próxima política tentará aplicar a layer desejada.
      }
    }

    const needsServerResume = remote.appliedVideoMode === undefined || remote.appliedVideoMode === 'paused';
    try {
      if (consumer.paused) consumer.resume();
      if (needsServerResume) {
        await this.#realtime.requestMedia('consumer.resume', { consumerId: consumer.id });
      }
      remote.appliedVideoMode = mode;
      remote.videoPaused = false;
      await remote.video.play().catch(() => {});
    } catch {
      remote.videoPaused = true;
    }
  }

  async #applyScreenAudioState(remote: RemoteScreenMedia): Promise<void> {
    if (!remote.audio || !remote.audioConsumer) return;
    const paused = getState().voice.deafened || getState().voice.screen.allAudioMuted || remote.audioMuted;
    remote.audio.muted = paused;

    // Screen-audio é independente do vídeo. Também evitamos enviar pause/resume
    // redundante quando mute/foco/re-render recalculam a mesma política.
    if (remote.audioConsumerPaused === paused && Boolean(remote.audioConsumer.paused) === paused) {
      if (!paused) await remote.audio.play().catch(() => {});
      return;
    }

    try {
      if (paused) {
        if (!remote.audioConsumer.paused) remote.audioConsumer.pause();
        if (remote.audioConsumerPaused !== true) {
          await this.#realtime.requestMedia('consumer.pause', { consumerId: remote.audioConsumer.id });
        }
        remote.audioConsumerPaused = true;
      } else {
        if (remote.audioConsumer.paused) remote.audioConsumer.resume();
        if (remote.audioConsumerPaused !== false) {
          await this.#realtime.requestMedia('consumer.resume', { consumerId: remote.audioConsumer.id });
        }
        remote.audioConsumerPaused = false;
        await remote.audio.play().catch(() => {});
      }
    } catch {
      // Fechamentos/reconexões concorrentes são esperados; manter o estado
      // aplicado anterior faz a próxima passagem tentar sincronizar de novo.
    }
  }

  async #applyScreenSubscriptionPolicy(): Promise<void> {
    const screen = getState().voice.screen;
    const validFocus = screen.focusedShareId && (
      screen.focusedShareId === screen.localShareId || this.#screenRemotes.has(screen.focusedShareId)
    ) ? screen.focusedShareId : undefined;
    if (screen.focusedShareId && !validFocus) updateScreen({ focusedShareId: undefined });

    const remoteVideoCount = [...this.#screenRemotes.values()].filter(remote => Boolean(remote.videoConsumer)).length;
    const totalVideoCount = remoteVideoCount + (screen.localActive ? 1 : 0);
    for (const remote of this.#screenRemotes.values()) {
      const mode = screenVideoMode({
        shareId: remote.shareId,
        focusedShareId: validFocus,
        remoteVideoCount,
        totalVideoCount
      });
      await this.#setScreenVideoMode(remote, mode);
      await this.#applyScreenAudioState(remote);
    }
    this.#publishRemoteScreens();
  }

  async #applyDeafenToConsumers(deafened: boolean): Promise<void> {
    for (const item of this.#remote.values()) {
      await this.#setRemotePaused(item, deafened || this.isLocallyMuted(item.displayName));
    }
    for (const remote of this.#screenRemotes.values()) await this.#applyScreenAudioState(remote);
    this.#publishRemoteScreens();
  }

  #applyMicTrackState(): void {
    if (!this.#micTrack) return;
    const state = getState().voice;
    this.#micTrack.enabled = !(state.muted || state.adminMuted);
  }

  #closeRemote(producerId: string): void {
    const item = this.#remote.get(producerId);
    if (!item) return;
    this.#remote.delete(producerId);
    this.#disposeRemoteBoost(item);
    try { item.consumer.close(); } catch {}
    try { item.audio.pause(); } catch {}
    item.audio.srcObject = null;
    item.audio.remove();
  }

  #screenProducerKnown(producerId: string): boolean {
    for (const remote of this.#screenRemotes.values()) {
      if (remote.videoProducerId === producerId || remote.audioProducerId === producerId) return true;
    }
    return false;
  }

  #closeRemoteScreenProducer(producerId: string, source?: string): void {
    for (const remote of this.#screenRemotes.values()) {
      const videoMatch = remote.videoProducerId === producerId;
      const audioMatch = remote.audioProducerId === producerId;
      if (!videoMatch && !audioMatch) continue;
      if (source === 'screen-video' || videoMatch) {
        this.#closeRemoteScreen(remote.shareId);
        return;
      }
      if (source === 'screen-audio' || audioMatch) {
        try { remote.audioConsumer?.close(); } catch {}
        try { remote.audio?.pause(); } catch {}
        if (remote.audio) { remote.audio.srcObject = null; remote.audio.remove(); }
        remote.audio = undefined;
        remote.audioConsumer = undefined;
        remote.audioConsumerPaused = undefined;
        remote.audioProducerId = undefined;
        remote.info = { ...remote.info, audioProducerId: undefined, audio: false, audioMuted: false };
        remote.audioMuted = false;
        this.#publishRemoteScreens();
        return;
      }
    }
  }

  #closeRemoteScreen(shareId: string): void {
    const remote = this.#screenRemotes.get(shareId);
    if (!remote) return;
    try { remote.videoConsumer?.close(); } catch {}
    try { remote.audioConsumer?.close(); } catch {}
    try { remote.video.pause(); } catch {}
    try { remote.audio?.pause(); } catch {}
    remote.video.srcObject = null;
    remote.video.remove();
    if (remote.audio) { remote.audio.srcObject = null; remote.audio.remove(); }
    this.#screenRemotes.delete(shareId);
    if (getState().voice.screen.focusedShareId === shareId) updateScreen({ focusedShareId: undefined });
    this.#publishRemoteScreens();
    void this.#applyScreenSubscriptionPolicy();
  }

  #closeAllRemoteScreens(): void {
    for (const remote of this.#screenRemotes.values()) {
      try { remote.videoConsumer?.close(); } catch {}
      try { remote.audioConsumer?.close(); } catch {}
      try { remote.video.pause(); } catch {}
      try { remote.audio?.pause(); } catch {}
      remote.video.srcObject = null;
      remote.video.remove();
      if (remote.audio) { remote.audio.srcObject = null; remote.audio.remove(); }
    }
    this.#screenRemotes.clear();
    updateScreen({ remotes: [], focusedShareId: undefined, allAudioMuted: false });
  }

  #publishRemoteScreens(): void {
    const screen = getState().voice.screen;
    const remotes = [...this.#screenRemotes.values()]
      .map(remote => ({
        ...remote.info,
        shareId: remote.shareId,
        displayName: remote.displayName,
        videoProducerId: remote.videoProducerId,
        audioProducerId: remote.audioProducerId,
        audio: Boolean(remote.audioProducerId),
        videoPaused: remote.videoPaused,
        audioMuted: remote.audioMuted,
        preferredSpatialLayer: remote.preferredSpatialLayer
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'pt-BR'));
    const status = screen.localActive ? 'sharing' : remotes.length ? 'receiving' : 'idle';
    if (screen.status === status && screen.lastError === undefined && remoteScreenListsEqual(screen.remotes, remotes)) return;
    updateScreen({ remotes, status, lastError: undefined });
  }

  async #finishLocalScreen(resetStatus: boolean): Promise<void> {
    try { this.#screenVideoProducer?.close(); } catch {}
    try { this.#screenAudioProducer?.close(); } catch {}
    this.#screenVideoProducer = undefined;
    this.#screenAudioProducer = undefined;
    if (this.#screenStream) {
      for (const track of this.#screenStream.getTracks()) try { track.stop(); } catch {}
    }
    this.#screenStream = undefined;
    if (this.#screenLocalVideo) {
      try { this.#screenLocalVideo.pause(); } catch {}
      this.#screenLocalVideo.srcObject = null;
      this.#screenLocalVideo.remove();
      this.#screenLocalVideo = undefined;
    }
    const screenBefore = getState().voice.screen;
    const wasFocusedLocal = Boolean(screenBefore.localShareId && screenBefore.focusedShareId === screenBefore.localShareId);
    updateScreen({
      localActive: false,
      localShareId: undefined,
      audioCaptured: undefined,
      actualWidth: undefined,
      actualHeight: undefined,
      actualFps: undefined,
      sourceType: undefined,
      ...(wasFocusedLocal ? { focusedShareId: undefined } : {}),
      ...(resetStatus ? { status: screenBefore.remotes.length ? 'receiving' : 'idle', lastError: undefined } : {})
    });
    if (wasFocusedLocal) void this.#applyScreenSubscriptionPolicy();
  }

  async #cleanupLocal(): Promise<void> {
    if (this.#statsTimer) window.clearInterval(this.#statsTimer);
    this.#statsTimer = undefined;
    updateVoice({ mediaRtt: undefined });
    for (const producerId of [...this.#remote.keys()]) this.#closeRemote(producerId);
    await this.#remoteBoost.close();
    this.#closeAllRemoteScreens();
    await this.#finishLocalScreen(true);
    if (this.#producer) {
      try { this.#producer.close(); } catch {}
      this.#producer = undefined;
    }
    if (this.#sendTransport) {
      try { this.#sendTransport.close(); } catch {}
      this.#sendTransport = undefined;
    }
    if (this.#recvTransport) {
      try { this.#recvTransport.close(); } catch {}
      this.#recvTransport = undefined;
    }
    if (this.#micPipeline) await this.#micPipeline.dispose().catch(() => {});
    this.#micPipeline = undefined;
    if (this.#micSourceTrack) this.#micSourceTrack.stop();
    this.#micSourceTrack = undefined;
    if (this.#micTrack && this.#micTrack.readyState !== 'ended') this.#micTrack.stop();
    this.#micTrack = undefined;
    this.#micDiagnostic = undefined;
    this.#device = undefined;
  }

  #startStats(): void {
    if (this.#statsTimer) window.clearInterval(this.#statsTimer);
    const collect = () => void this.#collectMediaRtt();
    collect();
    this.#statsTimer = window.setInterval(collect, 3000);
  }

  async #collectMediaRtt(): Promise<void> {
    const values: number[] = [];
    for (const transport of [this.#sendTransport, this.#recvTransport]) {
      if (!transport || typeof transport.getStats !== 'function') continue;
      try {
        const report: RTCStatsReport = await transport.getStats();
        let selected: any;
        report.forEach((stat: any) => {
          if (stat.type === 'transport' && typeof stat.selectedCandidatePairId === 'string') {
            const pair = report.get(stat.selectedCandidatePairId) as any;
            if (pair) selected = pair;
          }
        });
        if (!selected) {
          report.forEach((stat: any) => {
            if (!selected && stat.type === 'candidate-pair' && stat.state === 'succeeded' && (stat.nominated || stat.selected)) selected = stat;
          });
        }
        if (selected && typeof selected.currentRoundTripTime === 'number' && Number.isFinite(selected.currentRoundTripTime)) {
          values.push(Math.max(0, selected.currentRoundTripTime * 1000));
        }
      } catch {
        // Estatísticas são auxiliares e não devem derrubar a chamada.
      }
    }
    if (values.length) updateVoice({ mediaRtt: Math.round(Math.min(...values)) });
  }

  #assertMediaReady(): void {
    const bootstrap = getState().bootstrap;
    if (!bootstrap?.media?.enabled) throw new Error('O host iniciou sem o SFU de mídia.');
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microfone exige contexto seguro. Em outro PC, abra o Verdant por HTTPS com o certificado confiável do host.');
    }
    if (getState().wsStatus !== 'connected') throw new Error('Aguarde a conexão com o servidor antes de entrar na chamada.');
  }

  #assertScreenReady(): void {
    this.#assertMediaReady();
    if (!this.isJoined || getState().voice.status !== 'connected') throw new Error('Entre em um canal de voz antes de compartilhar a tela.');
    if (typeof (navigator.mediaDevices as any)?.getDisplayMedia !== 'function') {
      throw new Error('Este navegador não oferece captura de tela via getDisplayMedia().');
    }
    if (!this.#device?.canProduce?.('video')) throw new Error('Este navegador não consegue produzir vídeo compatível com o SFU.');
  }
}

function sameStringSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

function remoteScreenListsEqual(a: RemoteScreenInfo[], b: RemoteScreenInfo[]): boolean {
  if (a.length !== b.length) return false;
  const keys: Array<keyof RemoteScreenInfo> = [
    'shareId', 'displayName', 'videoProducerId', 'audioProducerId', 'sourceType',
    'resolution', 'fps', 'width', 'height', 'audio', 'videoPaused', 'audioMuted',
    'preferredSpatialLayer'
  ];
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (!left || !right) return false;
    for (const key of keys) if (!Object.is(left[key], right[key])) return false;
  }
  return true;
}

function buildDisplayConstraints(
  resolution: ScreenResolutionName,
  fps: ScreenFps,
  includeAudio: boolean,
  sourcePreference: ScreenSourcePreference
): any {
  const preset = SCREEN_RESOLUTIONS[resolution];
  const video: Record<string, unknown> = {
    width: { ideal: preset.width },
    height: { ideal: preset.height },
    frameRate: { ideal: fps, max: fps }
  };
  if (sourcePreference !== 'any') video.displaySurface = sourcePreference;
  return {
    video,
    audio: includeAudio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false,
    systemAudio: includeAudio ? 'include' : 'exclude',
    windowAudio: includeAudio ? 'system' : 'exclude',
    surfaceSwitching: 'include',
    selfBrowserSurface: 'exclude',
    monitorTypeSurfaces: 'include'
  };
}

function createVideoElement(kind: 'local' | 'remote'): HTMLVideoElement {
  const video = document.createElement('video');
  video.autoplay = true;
  video.setAttribute('playsinline', '');
  video.dataset.screenKind = kind;
  video.className = 'screen-video';
  return video;
}

async function applySink(audio: HTMLAudioElement, deviceId: string): Promise<void> {
  const setSinkId = (audio as any).setSinkId;
  if (typeof setSinkId !== 'function') return;
  await setSinkId.call(audio, deviceId);
}

function createShareId(): string {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  return `screen-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isDisplayCaptureCancelled(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'AbortError');
}

function normalize(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('pt-BR');
}

function clampVolumePercent(value: number): number {
  return clampRemoteVolumePercent(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Erro de mídia desconhecido.';
}
