import { appendMessage, getState, mutateState, removeMessage, updateMessage, updateState } from './state.js';
import type { MessageInfo, PresenceInfo } from './types.js';

interface PendingMediaRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: number;
}
interface OpenWaiter { resolve: () => void; reject: (error: Error) => void; timer: number }

export class RealtimeClient {
  #ws?: WebSocket;
  #token?: string;
  #stopped = true;
  #attempt = 0;
  #pingTimer?: number;
  #lastPing = 0;
  #everOpened = false;
  #pendingMedia = new Map<string, PendingMediaRequest>();
  #purpose: 'app' | 'voice';
  #openWaiters = new Set<OpenWaiter>();
  onServerStateChanged?: () => void;
  onServerDeleted?: (serverId: string) => void;
  onSystem?: (text: string) => void;
  onError?: (message: string) => void;
  onMediaEvent?: (event: string, data: any) => void;
  onConnectionOpen?: (reconnected: boolean) => void;
  onConnectionLost?: () => void;
  onChatMessage?: (message: MessageInfo) => void;
  onPresenceChanged?: (members: PresenceInfo[], initial: boolean) => void;

  constructor(purpose: 'app' | 'voice' = 'app') {
    this.#purpose = purpose;
  }

  start(token: string): void {
    this.stop();
    this.#token = token;
    this.#stopped = false;
    this.#attempt = 0;
    this.#everOpened = false;
    this.#connect(false);
  }

  stop(): void {
    this.#stopped = true;
    if (this.#pingTimer) window.clearInterval(this.#pingTimer);
    this.#pingTimer = undefined;
    this.#rejectPending('Conexão encerrada.');
    this.#rejectOpenWaiters('Conexão encerrada.');
    this.#ws?.close();
    this.#ws = undefined;
    if (this.#purpose === 'app') updateState({ wsStatus: 'offline', rtt: undefined });
  }

  get connected(): boolean { return this.#ws?.readyState === WebSocket.OPEN; }

  waitUntilOpen(timeoutMs = 10_000): Promise<void> {
    if (this.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const waiter: OpenWaiter = {
        resolve: () => { window.clearTimeout(waiter.timer); this.#openWaiters.delete(waiter); resolve(); },
        reject: (error: Error) => { window.clearTimeout(waiter.timer); this.#openWaiters.delete(waiter); reject(error); },
        timer: 0
      };
      waiter.timer = window.setTimeout(() => waiter.reject(new Error('Tempo esgotado ao conectar a sinalização.')), timeoutMs);
      this.#openWaiters.add(waiter);
    });
  }

  sendChat(channelId: string, content: string, replyToId?: string): boolean {
    return this.#send({ type: 'chat.send', channelId, content, ...(replyToId ? { replyToId } : {}) });
  }

  setTyping(channelId: string, active: boolean): boolean {
    return this.#send({ type: 'typing', channelId, active });
  }

  requestMedia(action: string, data: any = {}, timeoutMs = 10_000): Promise<any> {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      if (!this.#send({ type: 'media.request', requestId, action, data })) {
        reject(new Error('Sem conexão com o servidor para sinalização de mídia.'));
        return;
      }
      const timer = window.setTimeout(() => {
        this.#pendingMedia.delete(requestId);
        reject(new Error(`Tempo esgotado na operação de mídia: ${action}`));
      }, timeoutMs);
      this.#pendingMedia.set(requestId, { resolve, reject, timer });
    });
  }

  #connect(reconnecting: boolean): void {
    if (this.#stopped || !this.#token) return;
    if (this.#purpose === 'app') updateState({ wsStatus: reconnecting ? 'reconnecting' : 'connecting' });
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${scheme}//${location.host}/ws?token=${encodeURIComponent(this.#token)}&purpose=${this.#purpose}`);
    this.#ws = socket;

    socket.addEventListener('open', () => {
      const wasReconnect = this.#everOpened;
      this.#everOpened = true;
      this.#attempt = 0;
      if (this.#purpose === 'app') updateState({ wsStatus: 'connected' });
      for (const waiter of [...this.#openWaiters]) waiter.resolve();
      this.#startPing();
      this.onConnectionOpen?.(wasReconnect);
    });

    socket.addEventListener('message', event => this.#handle(event.data));
    socket.addEventListener('error', () => { /* close agenda reconexão */ });
    socket.addEventListener('close', () => {
      if (this.#pingTimer) window.clearInterval(this.#pingTimer);
      this.#pingTimer = undefined;
      this.#rejectPending('Conexão perdida durante operação de mídia.');
      if (this.#stopped) return;
      this.onConnectionLost?.();
      if (this.#purpose === 'app') updateState({ wsStatus: 'reconnecting' });
      const delay = Math.min(5000, 400 * 2 ** Math.min(this.#attempt++, 4));
      window.setTimeout(() => this.#connect(true), delay);
    });
  }

  #handle(raw: unknown): void {
    if (typeof raw !== 'string') return;
    let event: any;
    try { event = JSON.parse(raw); } catch { return; }

    if (event.type === 'media.response' && typeof event.requestId === 'string') {
      const pending = this.#pendingMedia.get(event.requestId);
      if (!pending) return;
      this.#pendingMedia.delete(event.requestId);
      window.clearTimeout(pending.timer);
      if (event.ok) pending.resolve(event.data);
      else pending.reject(new Error(typeof event.error?.message === 'string' ? event.error.message : 'Falha na operação de mídia.'));
      return;
    }
    if (event.type === 'media.event' && typeof event.event === 'string') {
      this.onMediaEvent?.(event.event, event.data);
      return;
    }
    if (event.type === 'ready') {
      const members = Array.isArray(event.presence) ? event.presence as PresenceInfo[] : [];
      updateState({ presence: members });
      this.onPresenceChanged?.(members, true);
      return;
    }
    if (event.type === 'presence') {
      const members = Array.isArray(event.members) ? event.members as PresenceInfo[] : [];
      updateState({ presence: members });
      this.onPresenceChanged?.(members, false);
      return;
    }
    if (event.type === 'chat.message.deleted' && typeof event.messageId === 'string') {
      const active = getState().activeChannel;
      if (active?.id === event.channelId) removeMessage(event.messageId);
      return;
    }
    if (event.type === 'chat.message.edited' && event.message) {
      const message = event.message as MessageInfo;
      const active = getState().activeChannel;
      if (active?.id === message.channelId) updateMessage(message);
      return;
    }
    if (event.type === 'chat.message' && event.message) {
      const message = event.message as MessageInfo;
      const active = getState().activeChannel;
      if (active?.id === message.channelId) appendMessage(message);
      this.onChatMessage?.(message);
      return;
    }
    if (event.type === 'typing' && typeof event.displayName === 'string') {
      const active = getState().activeChannel;
      if (!active || active.id !== event.channelId) return;
      mutateState(state => {
        if (event.active) state.typing.add(event.displayName);
        else state.typing.delete(event.displayName);
      });
      if (event.active) {
        window.setTimeout(() => mutateState(state => state.typing.delete(event.displayName)), 3500);
      }
      return;
    }
    if (event.type === 'server.deleted' && typeof event.serverId === 'string') {
      this.onServerDeleted?.(event.serverId);
      this.stop();
      return;
    }
    if (event.type === 'server.state.changed') {
      this.onServerStateChanged?.();
      return;
    }
    if (event.type === 'system' && typeof event.text === 'string') {
      this.onSystem?.(event.text);
      return;
    }
    if (event.type === 'error' && typeof event.message === 'string') {
      this.onError?.(event.message);
      return;
    }
    if (event.type === 'pong' && typeof event.sentAt === 'number') {
      if (this.#purpose === 'app') updateState({ rtt: Math.max(0, Date.now() - event.sentAt) });
    }
  }

  #startPing(): void {
    if (this.#pingTimer) window.clearInterval(this.#pingTimer);
    const ping = () => {
      this.#lastPing = Date.now();
      this.#send({ type: 'ping', sentAt: this.#lastPing });
    };
    ping();
    this.#pingTimer = window.setInterval(ping, 10_000);
  }

  #rejectPending(message: string): void {
    for (const pending of this.#pendingMedia.values()) {
      window.clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.#pendingMedia.clear();
  }

  #rejectOpenWaiters(message: string): void {
    for (const waiter of [...this.#openWaiters]) waiter.reject(new Error(message));
    this.#openWaiters.clear();
  }

  #send(payload: unknown): boolean {
    if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) return false;
    this.#ws.send(JSON.stringify(payload));
    return true;
  }
}
