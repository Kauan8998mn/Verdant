import { proxyPrincipal } from './proxy-auth.ts';
import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { MAX_MESSAGE_CHARS, MAX_WS_PAYLOAD_BYTES, hasPermission } from '../../shared/src/domain.ts';
import type { AppDatabase } from './database.ts';
import type { Logger } from './logger.ts';
import type { MediaBackend } from './media-contract.ts';
import type { Session, SessionManager } from './sessions.ts';

interface Peer {
  key: string;
  socket: Duplex;
  session: Session;
  buffer: Buffer;
  rateWindowStart: number;
  rateCount: number;
  closed: boolean;
}

export class WebSocketHub {
  #peers = new Map<string, Peer>();
  #db: AppDatabase;
  #sessions: SessionManager;
  #logger: Logger;
  #media?: MediaBackend;

  constructor(db: AppDatabase, sessions: SessionManager, logger: Logger, media?: MediaBackend) {
    this.#db = db;
    this.#sessions = sessions;
    this.#logger = logger;
    this.#media = media;
  }

  setMediaBackend(media: MediaBackend): void {
    this.#media = media;
  }

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== '/ws') return this.#reject(socket, 404, 'Not Found');
      const token = url.searchParams.get('token') ?? undefined;
      const session = this.#sessions.get(token);
      if (!session || (session.principal && session.principal !== proxyPrincipal(req))) return this.#reject(socket, 401, 'Unauthorized');

      const key = req.headers['sec-websocket-key'];
      const version = req.headers['sec-websocket-version'];
      if (typeof key !== 'string' || version !== '13') return this.#reject(socket, 400, 'Bad Request');

      const accept = createHash('sha1')
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest('base64');

      socket.write([
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '\r\n'
      ].join('\r\n'));

      const connected = this.#sessions.markConnected(session.token)!;
      const purpose = url.searchParams.get('purpose') === 'voice' ? 'voice' : 'app';
      const peerKey = `${session.token}:${purpose}`;
      const previous = this.#peers.get(peerKey);
      if (previous && !previous.closed) {
        previous.closed = true;
        try { previous.socket.end(); } catch {}
      }
      const peer: Peer = {
        key: peerKey,
        socket,
        session: connected,
        buffer: head?.length ? Buffer.from(head) : Buffer.alloc(0),
        rateWindowStart: Date.now(),
        rateCount: 0,
        closed: false
      };
      this.#peers.set(peerKey, peer);

      socket.on('data', chunk => this.#onData(peer, Buffer.from(chunk)));
      socket.on('error', err => this.#closePeer(peer, `socket error: ${err.message}`));
      socket.on('close', () => this.#closePeer(peer, 'socket closed'));
      socket.on('end', () => this.#closePeer(peer, 'socket ended'));

      this.#send(peer, {
        type: 'ready',
        user: { displayName: session.displayName, role: session.role },
        presence: this.#sessions.listPresence(session.serverId),
        mediaEnabled: this.#media?.enabled ?? false
      });
      if (this.#media?.enabled) {
        void this.#media.handleRequest(session, 'voice.list', {}).then(snapshot => {
          this.#send(peer, { type: 'media.event', event: 'voice.state', data: { members: snapshot?.members ?? [] } });
        }).catch(() => {});
      }
      this.#broadcastPresence(session.serverId);
      this.#broadcast(session.serverId, {
        type: 'system',
        level: 'info',
        text: `${session.displayName} entrou.`,
        at: new Date().toISOString()
      }, session.token);
      this.#logger.network('WebSocket conectado', { serverId: session.serverId, user: session.displayName });

      if (peer.buffer.length) this.#drain(peer);
    } catch (error) {
      this.#logger.error('Falha durante upgrade WebSocket', { error: error instanceof Error ? error.message : String(error) });
      socket.destroy();
    }
  }

  close(): void {
    for (const peer of this.#peers.values()) { peer.closed = true; peer.socket.destroy(); }
    this.#peers.clear();
  }

  broadcastServerState(serverId: string): void {
    this.#broadcast(serverId, { type: 'server.state.changed' });
  }

  broadcastChatMessage(serverId: string, message: unknown): void {
    this.#broadcast(serverId, { type: 'chat.message', message });
  }

  broadcastMessageDeleted(serverId: string, channelId: string, messageId: string): void {
    this.#broadcast(serverId, { type: 'chat.message.deleted', channelId, messageId });
  }

  broadcastMessageEdited(serverId: string, message: unknown): void {
    this.#broadcast(serverId, { type: 'chat.message.edited', message });
  }

  closeServer(serverId: string): void {
    for (const [token, peer] of [...this.#peers]) {
      if (peer.closed || peer.session.serverId !== serverId) continue;
      this.#send(peer, { type: 'server.deleted', serverId });
      peer.closed = true;
      this.#peers.delete(token);
      try {
        const reason = Buffer.from('Servidor excluído', 'utf8');
        const payload = Buffer.alloc(2 + Math.min(reason.length, 123));
        payload.writeUInt16BE(1008, 0);
        reason.subarray(0, 123).copy(payload, 2);
        this.#sendFrame(peer.socket, 0x8, payload);
        peer.socket.end();
      } catch {}
    }
  }

  broadcastPresence(serverId: string): void {
    this.#broadcastPresence(serverId);
  }

  sendToSession(token: string, payload: unknown): void {
    for (const peer of this.#peers.values()) {
      if (peer.session.token === token && !peer.closed) this.#send(peer, payload);
    }
  }

  broadcastToServer(serverId: string, payload: unknown, excludeToken?: string): void {
    this.#broadcast(serverId, payload, excludeToken);
  }

  #onData(peer: Peer, chunk: Buffer): void {
    if (peer.closed) return;
    peer.buffer = Buffer.concat([peer.buffer, chunk]);
    if (peer.buffer.length > MAX_WS_PAYLOAD_BYTES * 2) {
      this.#closeWithCode(peer, 1009, 'Payload muito grande');
      return;
    }
    this.#drain(peer);
  }

  #drain(peer: Peer): void {
    while (peer.buffer.length >= 2 && !peer.closed) {
      const first = peer.buffer[0];
      const second = peer.buffer[1];
      const fin = (first & 0x80) !== 0;
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;

      if ((first & 0x70) !== 0 || (opcode >= 8 && length > 125)) return this.#closeWithCode(peer, 1002, 'Frame inválido');
      if (!fin) return this.#closeWithCode(peer, 1003, 'Fragmentação não suportada');
      if (!masked) return this.#closeWithCode(peer, 1002, 'Frame do cliente deve ser mascarado');

      if (length === 126) {
        if (peer.buffer.length < 4) return;
        length = peer.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (peer.buffer.length < 10) return;
        const big = peer.buffer.readBigUInt64BE(2);
        if (big > BigInt(MAX_WS_PAYLOAD_BYTES)) return this.#closeWithCode(peer, 1009, 'Payload muito grande');
        length = Number(big);
        offset = 10;
      }

      if (length > MAX_WS_PAYLOAD_BYTES) return this.#closeWithCode(peer, 1009, 'Payload muito grande');
      if (peer.buffer.length < offset + 4 + length) return;

      const mask = peer.buffer.subarray(offset, offset + 4);
      offset += 4;
      const payload = Buffer.from(peer.buffer.subarray(offset, offset + length));
      for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
      peer.buffer = peer.buffer.subarray(offset + length);

      if (opcode === 0x8) {
        this.#sendFrame(peer.socket, 0x8, payload.subarray(0, 125));
        peer.socket.end();
        return;
      }
      if (opcode === 0x9) {
        this.#sendFrame(peer.socket, 0xA, payload.subarray(0, 125));
        continue;
      }
      if (opcode === 0xA) continue;
      if (opcode !== 0x1) {
        this.#closeWithCode(peer, 1003, 'Somente frames de texto são aceitos');
        return;
      }

      void this.#handleText(peer, payload.toString('utf8'));
    }
  }

  async #handleText(peer: Peer, text: string): Promise<void> {
    if (!this.#consumeRate(peer)) {
      this.#send(peer, { type: 'error', code: 'RATE_LIMIT', message: 'Muitos eventos em pouco tempo.' });
      return;
    }

    let event: any;
    try { event = JSON.parse(text); }
    catch { return this.#send(peer, { type: 'error', code: 'BAD_JSON', message: 'Evento inválido.' }); }

    if (!event || typeof event.type !== 'string') {
      return this.#send(peer, { type: 'error', code: 'BAD_EVENT', message: 'Evento sem tipo.' });
    }

    if (event.type === 'media.request') {
      const requestId = typeof event.requestId === 'string' ? event.requestId : '';
      const action = typeof event.action === 'string' ? event.action : '';
      if (!requestId || requestId.length > 80 || !action || action.length > 80) {
        return this.#send(peer, { type: 'media.response', requestId, ok: false, error: { code: 'BAD_MEDIA_REQUEST', message: 'Requisição de mídia inválida.' } });
      }
      if (!this.#media?.enabled) {
        return this.#send(peer, { type: 'media.response', requestId, ok: false, error: { code: 'MEDIA_DISABLED', message: 'O SFU não está disponível no host.' } });
      }
      try {
        const data = await this.#media.handleRequest(peer.session, action, event.data);
        this.#send(peer, { type: 'media.response', requestId, ok: true, data });
      } catch (error: any) {
        this.#logger.media('Falha em sinalização de mídia', {
          serverId: peer.session.serverId,
          user: peer.session.displayName,
          action,
          error: error instanceof Error ? error.message : String(error)
        });
        this.#send(peer, {
          type: 'media.response', requestId, ok: false,
          error: { code: typeof error?.code === 'string' ? error.code : 'MEDIA_ERROR', message: error instanceof Error ? error.message : 'Falha de mídia.' }
        });
      }
      return;
    }

    if (event.type === 'chat.send') {
      if (!hasPermission(peer.session.role, 'chat.send')) {
        return this.#send(peer, { type: 'error', code: 'FORBIDDEN', message: 'Sem permissão para enviar mensagens.' });
      }
      const channel = typeof event.channelId === 'string' ? this.#db.getChannel(event.channelId) : undefined;
      if (!channel || channel.serverId !== peer.session.serverId || channel.type !== 'text') {
        return this.#send(peer, { type: 'error', code: 'BAD_CHANNEL', message: 'Canal de texto inválido.' });
      }
      const content = typeof event.content === 'string' ? event.content.trim() : '';
      if (!content || content.length > MAX_MESSAGE_CHARS) {
        return this.#send(peer, { type: 'error', code: 'BAD_MESSAGE', message: `Mensagem deve ter entre 1 e ${MAX_MESSAGE_CHARS} caracteres.` });
      }
      const replyToId = typeof event.replyToId === 'string' && event.replyToId.trim() ? event.replyToId.trim() : undefined;
      if (replyToId) {
        const replyTarget = this.#db.getMessage(replyToId);
        if (!replyTarget || replyTarget.serverId !== peer.session.serverId || replyTarget.channelId !== channel.id) {
          return this.#send(peer, { type: 'error', code: 'BAD_REPLY', message: 'Mensagem respondida não pertence a este canal.' });
        }
      }
      const message = this.#db.addMessage({
        serverId: peer.session.serverId,
        channelId: channel.id,
        authorName: peer.session.displayName,
        authorRole: peer.session.role,
        content,
        kind: 'user',
        replyToId
      });
      this.#broadcast(peer.session.serverId, { type: 'chat.message', message });
      return;
    }

    if (event.type === 'typing') {
      const channel = typeof event.channelId === 'string' ? this.#db.getChannel(event.channelId) : undefined;
      if (!channel || channel.serverId !== peer.session.serverId || channel.type !== 'text') return;
      this.#broadcast(peer.session.serverId, {
        type: 'typing',
        channelId: channel.id,
        displayName: peer.session.displayName,
        active: Boolean(event.active)
      }, peer.session.token);
      return;
    }

    if (event.type === 'presence.request') {
      this.#send(peer, { type: 'presence', members: this.#sessions.listPresence(peer.session.serverId) });
      return;
    }

    if (event.type === 'ping') {
      this.#send(peer, { type: 'pong', sentAt: event.sentAt, serverAt: Date.now() });
      return;
    }

    this.#send(peer, { type: 'error', code: 'UNKNOWN_EVENT', message: 'Evento desconhecido.' });
  }

  #consumeRate(peer: Peer): boolean {
    const now = Date.now();
    if (now - peer.rateWindowStart >= 1000) {
      peer.rateWindowStart = now;
      peer.rateCount = 0;
    }
    peer.rateCount += 1;
    return peer.rateCount <= 60;
  }

  #broadcastPresence(serverId: string): void {
    this.#broadcast(serverId, { type: 'presence', members: this.#sessions.listPresence(serverId) });
  }

  #broadcast(serverId: string, payload: unknown, excludeToken?: string): void {
    for (const peer of this.#peers.values()) {
      if (peer.session.token === excludeToken || peer.closed || peer.session.serverId !== serverId) continue;
      this.#send(peer, payload);
    }
  }

  #send(peer: Peer, payload: unknown): void {
    if (peer.closed || peer.socket.destroyed) return;
    this.#sendFrame(peer.socket, 0x1, Buffer.from(JSON.stringify(payload), 'utf8'));
  }

  #sendFrame(socket: Duplex, opcode: number, payload: Buffer): void {
    if (socket.writableLength > 2 * 1024 * 1024) { socket.destroy(); return; }
    const length = payload.length;
    let header: Buffer;
    if (length < 126) {
      header = Buffer.from([0x80 | opcode, length]);
    } else if (length <= 0xffff) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }
    socket.write(Buffer.concat([header, payload]));
  }

  #closeWithCode(peer: Peer, code: number, reason: string): void {
    const reasonBuffer = Buffer.from(reason, 'utf8').subarray(0, 123);
    const payload = Buffer.alloc(2 + reasonBuffer.length);
    payload.writeUInt16BE(code, 0);
    reasonBuffer.copy(payload, 2);
    this.#sendFrame(peer.socket, 0x8, payload);
    peer.socket.end();
  }

  #closePeer(peer: Peer, reason: string): void {
    if (peer.closed) return;
    peer.closed = true;
    const mapped = this.#peers.get(peer.key);
    if (mapped === peer) this.#peers.delete(peer.key);
    const hasSibling = [...this.#peers.values()].some(item => !item.closed && item.session.token === peer.session.token);
    if (hasSibling) return;
    this.#sessions.markDisconnected(peer.session.token);
    void this.#media?.disconnectSession(peer.session.token);
    this.#broadcastPresence(peer.session.serverId);
    this.#broadcast(peer.session.serverId, {
      type: 'system', level: 'muted', text: `${peer.session.displayName} desconectou.`, at: new Date().toISOString()
    }, peer.session.token);
    this.#logger.network('WebSocket desconectado', { serverId: peer.session.serverId, user: peer.session.displayName, reason });
  }

  #reject(socket: Duplex, status: number, statusText: string): void {
    socket.write(`HTTP/1.1 ${status} ${statusText}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  }
}
