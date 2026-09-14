import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { MAX_MESSAGE_CHARS, hasPermission, normalizeName, validateDisplayName, type ChannelType, type Role } from '../../shared/src/domain.ts';
import type { AppDatabase } from './database.ts';
import { bearerToken, HttpError, readJson, sendJson } from './http-utils.ts';
import type { Logger } from './logger.ts';
import { contentDispositionAttachment, contentDispositionInline, type FileService } from './files.ts';
import { detectNetworkAddresses } from './network.ts';
import { SessionError, type SessionManager } from './sessions.ts';
import type { WebSocketHub } from './websocket.ts';
import type { MediaBackend } from './media-contract.ts';
import { SecurityError, hashServerPassword, validateServerPassword, verifyServerPassword } from './security.ts';

interface RouteDeps {
  db: AppDatabase;
  sessions: SessionManager;
  hub: WebSocketHub;
  logger: Logger;
  files: FileService;
  media: MediaBackend;
  secureTransport: boolean;
  port: number;
}

export async function handleApi(req: IncomingMessage, res: ServerResponse, deps: RouteDeps): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const method = req.method ?? 'GET';
  if (!url.pathname.startsWith('/api/')) return false;

  try {
    if (method === 'GET' && url.pathname === '/api/health') {
      sendJson(res, 200, {
        ok: true,
        app: 'verdant-lan',
        version: '0.5.0-phase8-security',
        phases: deps.media.enabled ? [0, 1, 2, 3, 4, 5, 6, 7, 8] : [0, 1, 2, 3, 8],
        secureTransport: deps.secureTransport,
        media: { enabled: deps.media.enabled, port: deps.media.mediaPort, listenAddresses: deps.media.listenAddresses },
        now: new Date().toISOString()
      });
      return true;
    }

    if (method === 'GET' && url.pathname === '/api/bootstrap') {
      sendJson(res, 200, {
        version: '0.5.0-phase8-security',
        phases: deps.media.enabled ? [0, 1, 2, 3, 4, 5, 6, 7, 8] : [0, 1, 2, 3, 8],
        servers: deps.db.listServers(),
        addresses: detectNetworkAddresses().map(item => ({ ...item, port: deps.port })),
        secureTransport: deps.secureTransport,
        mediaSecureContextRequired: true,
        media: { enabled: deps.media.enabled, port: deps.media.mediaPort, listenAddresses: deps.media.listenAddresses },
        participantLimit: 6
      });
      return true;
    }

    const uploadMatch = url.pathname.match(/^\/api\/channels\/([^/]+)\/files$/);
    if (method === 'POST' && uploadMatch) {
      const channelId = decodeURIComponent(uploadMatch[1]);
      const channel = deps.db.getChannel(channelId);
      if (!channel || channel.type !== 'text') throw new HttpError(404, 'Canal de texto não encontrado.');
      const session = requireSession(req, deps.sessions, channel.serverId);
      if (!hasPermission(session.role, 'chat.send')) throw new HttpError(403, 'Sem permissão para enviar arquivos.');
      const rawName = url.searchParams.get('name');
      if (!rawName) throw new HttpError(400, 'Nome do arquivo ausente.');
      const uploadId = url.searchParams.get('uploadId')?.trim() || undefined;
      if (uploadId && !/^[a-zA-Z0-9_-]{8,100}$/.test(uploadId)) throw new HttpError(400, 'Identificador de upload inválido.');
      const replyToId = url.searchParams.get('replyToId')?.trim() || undefined;
      if (replyToId) {
        const replyTarget = deps.db.getMessage(replyToId);
        if (!replyTarget || replyTarget.serverId !== channel.serverId || replyTarget.channelId !== channel.id) {
          throw new HttpError(400, 'Mensagem respondida não pertence a este canal.');
        }
      }

      if (uploadId) {
        const existing = deps.db.getFileByClientUploadId(channel.serverId, uploadId);
        if (existing) {
          if (existing.channelId !== channel.id || existing.uploaderName !== session.displayName) {
            throw new HttpError(409, 'Identificador de upload já utilizado por outra operação.');
          }
          const existingMessage = deps.db.getMessageByFileId(existing.id);
          if (existingMessage) {
            req.resume();
            sendJson(res, 200, {
              file: { id: existing.id, originalName: existing.originalName, size: existing.size, mime: existing.mime, sha256: existing.sha256 },
              message: existingMessage, reused: true
            });
            return true;
          }
        }
      }

      const file = await deps.files.saveUpload(req, {
        serverId: channel.serverId,
        channelId: channel.id,
        uploaderName: session.displayName,
        originalName: rawName,
        clientUploadId: uploadId
      });
      const message = deps.db.addMessage({
        serverId: channel.serverId, channelId: channel.id, authorName: session.displayName,
        authorRole: session.role, content: '', kind: 'user', fileId: file.id, replyToId
      });
      deps.hub.broadcastChatMessage(channel.serverId, message);
      deps.logger.info('Arquivo recebido', { serverId: channel.serverId, channelId, user: session.displayName, size: file.size, mime: file.mime, uploadId });
      sendJson(res, 201, { file: { id: file.id, originalName: file.originalName, size: file.size, mime: file.mime, sha256: file.sha256 }, message });
      return true;
    }

    const grantMatch = url.pathname.match(/^\/api\/files\/([^/]+)\/grant$/);
    if (method === 'POST' && grantMatch) {
      const fileId = decodeURIComponent(grantMatch[1]);
      const file = deps.files.getFile(fileId);
      if (!file) throw new HttpError(404, 'Arquivo não encontrado.');
      requireSession(req, deps.sessions, file.serverId);
      const key = deps.files.createDownloadGrant(file.id, file.serverId);
      sendJson(res, 200, { url: `/api/files/${encodeURIComponent(file.id)}/download?key=${encodeURIComponent(key)}`, expiresInSeconds: 60 });
      return true;
    }

    const previewGrantMatch = url.pathname.match(/^\/api\/files\/([^/]+)\/preview-grant$/);
    if (method === 'POST' && previewGrantMatch) {
      const fileId = decodeURIComponent(previewGrantMatch[1]);
      const file = deps.files.getFile(fileId);
      if (!file) throw new HttpError(404, 'Arquivo não encontrado.');
      requireSession(req, deps.sessions, file.serverId);
      const key = deps.files.createPreviewGrant(file.id, file.serverId);
      sendJson(res, 200, { url: `/api/files/${encodeURIComponent(file.id)}/preview?key=${encodeURIComponent(key)}`, expiresInSeconds: 60 });
      return true;
    }

    const previewMatch = url.pathname.match(/^\/api\/files\/([^/]+)\/preview$/);
    if (method === 'GET' && previewMatch) {
      const fileId = decodeURIComponent(previewMatch[1]);
      const resolved = deps.files.resolvePreview(fileId, url.searchParams.get('key'));
      const stat = fs.statSync(resolved.path);
      const commonHeaders = {
        'content-type': resolved.file.mime,
        'content-disposition': contentDispositionInline(resolved.file.originalName),
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self'",
        'accept-ranges': 'bytes'
      } as const;
      const range = parseSingleByteRange(req.headers.range, stat.size);
      if (range === null && req.headers.range) {
        res.writeHead(416, { ...commonHeaders, 'content-range': `bytes */${stat.size}` });
        res.end();
        return true;
      }
      if (range) {
        const length = range.end - range.start + 1;
        res.writeHead(206, {
          ...commonHeaders,
          'content-length': length,
          'content-range': `bytes ${range.start}-${range.end}/${stat.size}`
        });
        fs.createReadStream(resolved.path, { start: range.start, end: range.end }).pipe(res);
      } else {
        res.writeHead(200, { ...commonHeaders, 'content-length': stat.size });
        fs.createReadStream(resolved.path).pipe(res);
      }
      return true;
    }

    const downloadMatch = url.pathname.match(/^\/api\/files\/([^/]+)\/download$/);
    if (method === 'GET' && downloadMatch) {
      const fileId = decodeURIComponent(downloadMatch[1]);
      const resolved = deps.files.resolveDownload(fileId, url.searchParams.get('key'));
      const stat = fs.statSync(resolved.path);
      res.writeHead(200, {
        'content-type': resolved.file.mime,
        'content-length': stat.size,
        'content-disposition': contentDispositionAttachment(resolved.file.originalName),
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff'
      });
      fs.createReadStream(resolved.path).pipe(res);
      return true;
    }

    if (method === 'POST' && url.pathname === '/api/servers') {
      const body = asObject(await readJson(req));
      const serverName = validateSimpleName(body.name, 'Nome do servidor', 64);
      const owner = validateDisplayName(body.ownerName);
      if (!owner.ok) throw new HttpError(400, owner.error);
      const description = typeof body.description === 'string' ? body.description.trim().slice(0, 280) : '';
      const password = validateServerPassword(body.password);
      const server = deps.db.createServer(serverName, description, password ? hashServerPassword(password) : undefined);
      const session = deps.sessions.createOwnerSession(server.id, owner.value);
      deps.logger.info('Servidor criado', { serverId: server.id, name: server.name, owner: session.displayName });
      sendJson(res, 201, {
        server,
        channels: deps.db.listChannels(server.id),
        session: publicSession(session, true)
      });
      return true;
    }

    const serverMatch = url.pathname.match(/^\/api\/servers\/([^/]+)$/);
    if (method === 'DELETE' && serverMatch) {
      const serverId = decodeURIComponent(serverMatch[1]);
      const server = deps.db.getServer(serverId);
      if (!server) throw new HttpError(404, 'Servidor não encontrado.');
      const session = requireSession(req, deps.sessions, serverId);
      if (session.role !== 'owner') throw new HttpError(403, 'Somente o Dono pode excluir o servidor.');

      const files = deps.db.listFilesByServer(serverId);
      const tokens = deps.sessions.tokensForServer(serverId);
      for (const token of tokens) {
        try { await deps.media.disconnectSession(token); } catch {}
      }
      if (!deps.db.deleteServer(serverId)) throw new HttpError(404, 'Servidor não encontrado.');
      deps.files.removeStoredFiles(files);
      deps.hub.closeServer(serverId);
      deps.sessions.invalidateServer(serverId);
      deps.logger.info('Servidor excluído pelo Dono', { serverId, name: server.name, owner: session.displayName });
      sendJson(res, 200, { ok: true });
      return true;
    }

    const inviteMatch = url.pathname.match(/^\/api\/invites\/([A-Za-z0-9]+)$/);
    if (method === 'GET' && inviteMatch) {
      const server = deps.db.getServerByInvite(inviteMatch[1]);
      if (!server) throw new HttpError(404, 'Convite não encontrado.');
      sendJson(res, 200, { server: { id: server.id, name: server.name, description: server.description, inviteCode: server.inviteCode, passwordProtected: server.passwordProtected } });
      return true;
    }

    const joinMatch = url.pathname.match(/^\/api\/servers\/([^/]+)\/join$/);
    if (method === 'POST' && joinMatch) {
      const serverId = decodeURIComponent(joinMatch[1]);
      const body = asObject(await readJson(req));
      const storedPassword = deps.db.getServerPasswordHash(serverId);
      if (storedPassword && !deps.sessions.canResume(serverId, body.name, body.resumeToken)) {
        const supplied = validateServerPassword(body.password, false);
        if (!verifyServerPassword(supplied, storedPassword)) throw new HttpError(401, 'Senha do servidor incorreta.');
      }
      const session = deps.sessions.join(serverId, body.name, body.resumeToken);
      sendJson(res, 200, {
        session: publicSession(session, true),
        server: deps.db.getServer(serverId),
        channels: deps.db.listChannels(serverId)
      });
      return true;
    }

    const channelsListMatch = url.pathname.match(/^\/api\/servers\/([^/]+)\/channels$/);
    if (method === 'GET' && channelsListMatch) {
      const serverId = decodeURIComponent(channelsListMatch[1]);
      if (!deps.db.getServer(serverId)) throw new HttpError(404, 'Servidor não encontrado.');
      sendJson(res, 200, { channels: deps.db.listChannels(serverId) });
      return true;
    }

    if (method === 'POST' && channelsListMatch) {
      const serverId = decodeURIComponent(channelsListMatch[1]);
      const session = requireSession(req, deps.sessions, serverId);
      if (!hasPermission(session.role, 'channels.create')) throw new HttpError(403, 'Sem permissão para criar canais.');
      const body = asObject(await readJson(req));
      const type = body.type === 'voice' ? 'voice' : body.type === 'text' ? 'text' : undefined;
      if (!type) throw new HttpError(400, 'Tipo de canal inválido.');
      const name = validateChannelName(body.name, type);
      const channel = deps.db.createChannel(serverId, name, type);
      deps.hub.broadcastServerState(serverId);
      sendJson(res, 201, { channel });
      return true;
    }

    const channelMatch = url.pathname.match(/^\/api\/channels\/([^/]+)$/);
    if (channelMatch && (method === 'PATCH' || method === 'DELETE')) {
      const channelId = decodeURIComponent(channelMatch[1]);
      const channel = deps.db.getChannel(channelId);
      if (!channel) throw new HttpError(404, 'Canal não encontrado.');
      const session = requireSession(req, deps.sessions, channel.serverId);

      if (method === 'DELETE') {
        if (session.role !== 'owner') throw new HttpError(403, 'Somente o Dono pode excluir canais nesta versão.');
        if (channel.type === 'voice' && deps.media.enabled) {
          const snapshot = await deps.media.handleRequest(session, 'voice.list', {});
          if (Array.isArray(snapshot?.members) && snapshot.members.some((member: any) => member.channelId === channel.id)) {
            throw new HttpError(409, 'Não é possível excluir um canal de voz enquanto houver participantes nele.');
          }
        }
        const all = deps.db.listChannels(channel.serverId).filter(c => c.type === channel.type);
        if (all.length <= 1) throw new HttpError(409, `O servidor precisa manter ao menos um canal de ${channel.type === 'text' ? 'texto' : 'voz'}.`);
        const channelFiles = deps.db.listFilesByChannel(channel.id);
        deps.db.deleteChannel(channel.id);
        deps.files.removeStoredFiles(channelFiles);
        deps.hub.broadcastServerState(channel.serverId);
        sendJson(res, 200, { ok: true });
        return true;
      }

      if (!hasPermission(session.role, 'channels.edit')) throw new HttpError(403, 'Sem permissão para editar canais.');
      const body = asObject(await readJson(req));
      const patch: { name?: string; position?: number } = {};
      if ('name' in body) patch.name = validateChannelName(body.name, channel.type);
      if ('position' in body) {
        if (!Number.isInteger(body.position) || Number(body.position) < 0 || Number(body.position) > 999) throw new HttpError(400, 'Posição inválida.');
        patch.position = Number(body.position);
      }
      const updated = deps.db.updateChannel(channel.id, patch);
      deps.hub.broadcastServerState(channel.serverId);
      sendJson(res, 200, { channel: updated });
      return true;
    }

    const messagesMatch = url.pathname.match(/^\/api\/channels\/([^/]+)\/messages$/);
    if (method === 'GET' && messagesMatch) {
      const channelId = decodeURIComponent(messagesMatch[1]);
      const channel = deps.db.getChannel(channelId);
      if (!channel || channel.type !== 'text') throw new HttpError(404, 'Canal de texto não encontrado.');
      const limit = Number.parseInt(url.searchParams.get('limit') ?? '50', 10);
      const before = url.searchParams.get('before') ?? undefined;
      sendJson(res, 200, { messages: deps.db.listMessages(channelId, Number.isFinite(limit) ? limit : 50, before) });
      return true;
    }

    const messageMatch = url.pathname.match(/^\/api\/messages\/([^/]+)$/);
    if (method === 'PATCH' && messageMatch) {
      const messageId = decodeURIComponent(messageMatch[1]);
      const message = deps.db.getMessage(messageId);
      if (!message) throw new HttpError(404, 'Mensagem não encontrada.');
      const session = requireSession(req, deps.sessions, message.serverId);
      if (message.kind !== 'user' || normalizeName(session.displayName) !== normalizeName(message.authorName)) {
        throw new HttpError(403, 'Você só pode editar suas próprias mensagens.');
      }

      const body = asObject(await readJson(req));
      const content = typeof body.content === 'string' ? body.content.trim() : '';
      if (content.length > MAX_MESSAGE_CHARS) {
        throw new HttpError(400, `Mensagem pode ter no máximo ${MAX_MESSAGE_CHARS} caracteres.`);
      }
      if (!message.attachment && !content) {
        throw new HttpError(400, 'Uma mensagem sem anexo não pode ficar vazia.');
      }

      const initialCaption = body.initialCaption === true
        && Boolean(message.attachment)
        && !message.content
        && !message.editedAt
        && Boolean(content);
      const updated = deps.db.updateMessageContent(messageId, content, !initialCaption);
      if (!updated) throw new HttpError(404, 'Mensagem não encontrada.');
      deps.hub.broadcastMessageEdited(message.serverId, updated);
      deps.logger.info(initialCaption ? 'Legenda inicial aplicada ao anexo' : 'Mensagem editada pelo autor', {
        serverId: message.serverId,
        channelId: message.channelId,
        messageId,
        user: session.displayName
      });
      sendJson(res, 200, { message: updated });
      return true;
    }

    if (method === 'DELETE' && messageMatch) {
      const messageId = decodeURIComponent(messageMatch[1]);
      const message = deps.db.getMessage(messageId);
      if (!message) throw new HttpError(404, 'Mensagem não encontrada.');
      const session = requireSession(req, deps.sessions, message.serverId);
      if (session.role !== 'owner') throw new HttpError(403, 'Somente o Dono pode apagar mensagens.');
      const result = deps.db.deleteMessage(messageId);
      if (!result.deleted) throw new HttpError(404, 'Mensagem não encontrada.');
      if (result.file) deps.files.removeStoredFile(result.file);
      deps.hub.broadcastMessageDeleted(message.serverId, message.channelId, message.id);
      deps.logger.info('Mensagem apagada pelo Dono', { serverId: message.serverId, channelId: message.channelId, messageId, owner: session.displayName });
      sendJson(res, 200, { ok: true });
      return true;
    }

    const fileSearchMatch = url.pathname.match(/^\/api\/servers\/([^/]+)\/files\/search$/);
    if (method === 'GET' && fileSearchMatch) {
      const serverId = decodeURIComponent(fileSearchMatch[1]);
      requireSession(req, deps.sessions, serverId);
      if (!deps.db.getServer(serverId)) throw new HttpError(404, 'Servidor não encontrado.');
      const query = url.searchParams.get('q') ?? '';
      const files = deps.db.searchFiles(serverId, query, 50).map(file => ({
        id: file.id,
        serverId: file.serverId,
        channelId: file.channelId,
        channelName: file.channelName,
        uploaderName: file.uploaderName,
        originalName: file.originalName,
        size: file.size,
        mime: file.mime,
        sha256: file.sha256,
        createdAt: file.createdAt,
        excerpt: file.excerpt ?? ''
      }));
      sendJson(res, 200, { files });
      return true;
    }

    const profilesMatch = url.pathname.match(/^\/api\/servers\/([^/]+)\/profiles$/);
    if (method === 'GET' && profilesMatch) {
      const serverId = decodeURIComponent(profilesMatch[1]);
      requireSession(req, deps.sessions, serverId);
      if (!deps.db.getServer(serverId)) throw new HttpError(404, 'Servidor não encontrado.');
      sendJson(res, 200, { profiles: deps.db.listMemberProfiles(serverId) });
      return true;
    }

    const profileMatch = url.pathname.match(/^\/api\/servers\/([^/]+)\/profile$/);
    if (method === 'PATCH' && profileMatch) {
      const serverId = decodeURIComponent(profileMatch[1]);
      const session = requireSession(req, deps.sessions, serverId);
      const body = asObject(await readJson(req, 700 * 1024));
      const avatarDataUrl = validateAvatarDataUrl(body.avatarDataUrl);
      const profile = deps.db.updateMemberAvatar(
        serverId,
        normalizeName(session.displayName),
        session.displayName,
        avatarDataUrl
      );
      deps.hub.broadcastServerState(serverId);
      deps.logger.info(avatarDataUrl ? 'Foto de perfil atualizada' : 'Foto de perfil removida', {
        serverId,
        user: session.displayName
      });
      sendJson(res, 200, { profile });
      return true;
    }

    const rolesMatch = url.pathname.match(/^\/api\/servers\/([^/]+)\/roles$/);
    if (method === 'PATCH' && rolesMatch) {
      const serverId = decodeURIComponent(rolesMatch[1]);
      const actor = requireSession(req, deps.sessions, serverId);
      if (!hasPermission(actor.role, 'roles.assign')) throw new HttpError(403, 'Somente o dono pode atribuir cargos nesta fase.');
      const body = asObject(await readJson(req));
      const parsed = validateDisplayName(body.name);
      if (!parsed.ok) throw new HttpError(400, parsed.error);
      const role: Role | undefined = body.role === 'moderator' || body.role === 'member' ? body.role : undefined;
      if (!role) throw new HttpError(400, 'Cargo inválido. O cargo Dono não pode ser transferido nesta fase.');
      deps.sessions.setRole(serverId, parsed.normalized, parsed.value, role);
      deps.hub.broadcastServerState(serverId);
      deps.hub.broadcastPresence(serverId);
      sendJson(res, 200, { ok: true, member: { displayName: parsed.value, role } });
      return true;
    }

    if (method === 'GET' && rolesMatch) {
      const serverId = decodeURIComponent(rolesMatch[1]);
      requireSession(req, deps.sessions, serverId);
      sendJson(res, 200, { members: deps.db.listRoleBindings(serverId) });
      return true;
    }

    const presenceMatch = url.pathname.match(/^\/api\/servers\/([^/]+)\/presence$/);
    if (method === 'GET' && presenceMatch) {
      const serverId = decodeURIComponent(presenceMatch[1]);
      requireSession(req, deps.sessions, serverId);
      sendJson(res, 200, { members: deps.sessions.listPresence(serverId) });
      return true;
    }

    sendJson(res, 404, { error: 'Endpoint não encontrado.' });
    return true;
  } catch (error) {
    if (error instanceof SessionError || error instanceof HttpError || error instanceof SecurityError) {
      sendJson(res, error.status, { error: error.message });
      return true;
    }
    const message = error instanceof Error ? error.message : String(error);
    deps.logger.error('Erro de API', { method, path: url.pathname, error: message });
    sendJson(res, 500, { error: 'Erro interno do servidor.' });
    return true;
  }
}

function parseSingleByteRange(value: string | undefined, size: number): { start: number; end: number } | null | undefined {
  if (!value) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match) return null;
  const startText = match[1] ?? '';
  const endText = match[2] ?? '';
  if (!startText && !endText) return null;
  let start: number;
  let end: number;
  if (!startText) {
    const suffix = Number(endText);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = Math.max(0, size - 1);
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null;
    if (start < 0 || end < start || start >= size) return null;
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

function asObject(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Corpo da requisição inválido.');
  return value as Record<string, any>;
}

function validateSimpleName(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string') throw new HttpError(400, `${label} inválido.`);
  const cleaned = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!cleaned || cleaned.length > max) throw new HttpError(400, `${label} deve ter entre 1 e ${max} caracteres.`);
  return cleaned;
}

function validateChannelName(value: unknown, type: ChannelType): string {
  const name = validateSimpleName(value, 'Nome do canal', 48);
  if (type === 'text') return name.toLocaleLowerCase('pt-BR').replace(/\s+/g, '-');
  return name;
}

const MAX_AVATAR_BYTES = 384 * 1024;

function validateAvatarDataUrl(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value !== 'string') throw new HttpError(400, 'Foto de perfil inválida.');
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) throw new HttpError(400, 'Use uma imagem PNG, JPEG ou WebP.');
  let bytes: Buffer;
  try {
    bytes = Buffer.from(match[2], 'base64');
  } catch {
    throw new HttpError(400, 'Foto de perfil inválida.');
  }
  if (!bytes.length || bytes.length > MAX_AVATAR_BYTES) {
    throw new HttpError(413, `A foto de perfil processada pode ter no máximo ${Math.round(MAX_AVATAR_BYTES / 1024)} KB.`);
  }
  const mime = match[1];
  const png = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp = bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  if ((mime === 'png' && !png) || (mime === 'jpeg' && !jpeg) || (mime === 'webp' && !webp)) {
    throw new HttpError(400, 'O conteúdo da foto não corresponde ao formato informado.');
  }
  return value;
}

function requireSession(req: IncomingMessage, sessions: SessionManager, serverId: string) {
  const session = sessions.get(bearerToken(req));
  if (!session || session.serverId !== serverId) throw new HttpError(401, 'Sessão inválida ou expirada.');
  return session;
}

function publicSession(session: ReturnType<SessionManager['join']>, includeToken = false) {
  return {
    ...(includeToken ? { token: session.token } : {}),
    serverId: session.serverId,
    displayName: session.displayName,
    role: session.role
  };
}
