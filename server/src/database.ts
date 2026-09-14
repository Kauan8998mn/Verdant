import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { ChannelType, Role } from '../../shared/src/domain.ts';

export interface ServerRow {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  inviteCode: string;
  passwordProtected: boolean;
}

export interface ChannelRow {
  id: string;
  serverId: string;
  name: string;
  type: ChannelType;
  position: number;
}

export interface FileRow {
  id: string;
  serverId: string;
  channelId: string;
  uploaderName: string;
  originalName: string;
  storedName: string;
  size: number;
  mime: string;
  sha256: string;
  clientUploadId?: string;
  createdAt: string;
}

export interface MemberProfileRow {
  serverId: string;
  normalizedName: string;
  displayName: string;
  avatarDataUrl?: string | null;
  updatedAt: string;
}

export interface MessageRow {
  id: string;
  serverId: string;
  channelId: string;
  authorName: string;
  authorRole: Role;
  content: string;
  createdAt: string;
  editedAt?: string;
  kind: 'user' | 'system';
  attachment?: Pick<FileRow, 'id' | 'originalName' | 'size' | 'mime' | 'sha256'>;
  replyTo?: {
    id: string;
    authorName: string;
    content: string;
    attachmentName?: string;
  };
}

export class AppDatabase {
  #db: DatabaseSync;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    const dbPath = path.join(dataDir, 'verdant.sqlite');
    this.#db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true, timeout: 3000 });
    this.#db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    this.#migrate();
  }

  #migrate(): void {
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        invite_code TEXT NOT NULL UNIQUE,
        password_hash TEXT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('text','voice')),
        position INTEGER NOT NULL,
        UNIQUE(server_id, type, name)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS role_bindings (
        server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        normalized_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('owner','moderator','member')),
        display_name TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(server_id, normalized_name)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS member_profiles (
        server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        normalized_name TEXT NOT NULL,
        display_name TEXT NOT NULL,
        avatar_data_url TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(server_id, normalized_name)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        uploader_name TEXT NOT NULL,
        original_name TEXT NOT NULL,
        stored_name TEXT NOT NULL UNIQUE,
        size INTEGER NOT NULL CHECK(size >= 0),
        mime TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        client_upload_id TEXT,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        author_name TEXT NOT NULL,
        author_role TEXT NOT NULL CHECK(author_role IN ('owner','moderator','member')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('user','system'))
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_channels_server_position ON channels(server_id, position);
      CREATE INDEX IF NOT EXISTS idx_messages_channel_created ON messages(channel_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_files_channel_created ON files(channel_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS file_text_index (
        file_id TEXT PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
        server_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        content TEXT NOT NULL,
        indexed_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_file_text_server ON file_text_index(server_id);
      CREATE INDEX IF NOT EXISTS idx_file_text_channel ON file_text_index(channel_id);
    `);

    const serverColumns = this.#db.prepare(`PRAGMA table_info(servers)`).all() as Array<{ name: string }>;
    if (!serverColumns.some(column => column.name === 'password_hash')) {
      this.#db.exec(`ALTER TABLE servers ADD COLUMN password_hash TEXT`);
    }

    const fileColumns = this.#db.prepare(`PRAGMA table_info(files)`).all() as Array<{ name: string }>;
    if (!fileColumns.some(column => column.name === 'client_upload_id')) {
      this.#db.exec(`ALTER TABLE files ADD COLUMN client_upload_id TEXT`);
    }
    this.#db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_files_server_client_upload ON files(server_id, client_upload_id) WHERE client_upload_id IS NOT NULL`);

    const messageColumns = this.#db.prepare(`PRAGMA table_info(messages)`).all() as Array<{ name: string }>;
    if (!messageColumns.some(column => column.name === 'file_id')) {
      this.#db.exec(`ALTER TABLE messages ADD COLUMN file_id TEXT REFERENCES files(id)`);
    }
    const currentMessageColumns = this.#db.prepare(`PRAGMA table_info(messages)`).all() as Array<{ name: string }>;
    if (!currentMessageColumns.some(column => column.name === 'edited_at')) {
      this.#db.exec(`ALTER TABLE messages ADD COLUMN edited_at TEXT`);
    }
    if (!currentMessageColumns.some(column => column.name === 'reply_to_id')) {
      this.#db.exec(`ALTER TABLE messages ADD COLUMN reply_to_id TEXT REFERENCES messages(id) ON DELETE SET NULL`);
    }
  }

  listServers(): ServerRow[] {
    return this.#db.prepare(`SELECT id, name, description, created_at AS createdAt, invite_code AS inviteCode, password_hash IS NOT NULL AS passwordProtected FROM servers ORDER BY created_at ASC`).all() as unknown as ServerRow[];
  }

  getServer(id: string): ServerRow | undefined {
    return this.#db.prepare(`SELECT id, name, description, created_at AS createdAt, invite_code AS inviteCode, password_hash IS NOT NULL AS passwordProtected FROM servers WHERE id = ?`).get(id) as unknown as ServerRow | undefined;
  }

  createServer(name: string, description = '', passwordHash?: string): ServerRow {
    const row: ServerRow = { id: randomUUID(), name, description, createdAt: new Date().toISOString(), inviteCode: this.#newInviteCode(), passwordProtected: Boolean(passwordHash) };
    this.#db.prepare(`INSERT INTO servers(id,name,description,created_at,invite_code,password_hash) VALUES(?,?,?,?,?,?)`).run(row.id, row.name, row.description, row.createdAt, row.inviteCode, passwordHash ?? null);
    this.createChannel(row.id, 'geral', 'text', 0);
    this.createChannel(row.id, 'Geral', 'voice', 1);
    return row;
  }

  deleteServer(serverId: string): boolean {
    const result = this.#db.prepare(`DELETE FROM servers WHERE id = ?`).run(serverId);
    return Number(result.changes) > 0;
  }

  getServerByInvite(code: string): ServerRow | undefined {
    return this.#db.prepare(`SELECT id, name, description, created_at AS createdAt, invite_code AS inviteCode, password_hash IS NOT NULL AS passwordProtected FROM servers WHERE invite_code = ?`).get(code.toUpperCase()) as unknown as ServerRow | undefined;
  }

  getServerPasswordHash(serverId: string): string | undefined {
    const row = this.#db.prepare(`SELECT password_hash AS passwordHash FROM servers WHERE id = ?`).get(serverId) as { passwordHash?: string | null } | undefined;
    return row?.passwordHash ?? undefined;
  }

  #newInviteCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let attempt = 0; attempt < 20; attempt += 1) {
      let code = '';
      const bytes = randomBytes(6);
      for (const byte of bytes) code += alphabet[byte % alphabet.length];
      const exists = this.#db.prepare(`SELECT 1 AS ok FROM servers WHERE invite_code = ?`).get(code);
      if (!exists) return code;
    }
    throw new Error('Não foi possível gerar código de convite único.');
  }

  listChannels(serverId: string): ChannelRow[] {
    return this.#db.prepare(`
      SELECT id, server_id AS serverId, name, type, position
      FROM channels WHERE server_id = ? ORDER BY position ASC, name ASC
    `).all(serverId) as ChannelRow[];
  }

  getChannel(channelId: string): ChannelRow | undefined {
    return this.#db.prepare(`SELECT id, server_id AS serverId, name, type, position FROM channels WHERE id = ?`).get(channelId) as ChannelRow | undefined;
  }

  createChannel(serverId: string, name: string, type: ChannelType, position?: number): ChannelRow {
    const current = this.listChannels(serverId);
    const row: ChannelRow = {
      id: randomUUID(), serverId, name, type,
      position: position ?? (current.length ? Math.max(...current.map(c => c.position)) + 1 : 0)
    };
    this.#db.prepare(`INSERT INTO channels(id,server_id,name,type,position) VALUES(?,?,?,?,?)`).run(row.id, row.serverId, row.name, row.type, row.position);
    return row;
  }

  updateChannel(channelId: string, patch: { name?: string; position?: number }): ChannelRow | undefined {
    const current = this.getChannel(channelId);
    if (!current) return undefined;
    const name = patch.name ?? current.name;
    const position = Number.isInteger(patch.position) ? Number(patch.position) : current.position;
    this.#db.prepare(`UPDATE channels SET name = ?, position = ? WHERE id = ?`).run(name, position, channelId);
    return this.getChannel(channelId);
  }

  deleteChannel(channelId: string): boolean {
    const result = this.#db.prepare(`DELETE FROM channels WHERE id = ?`).run(channelId);
    return Number(result.changes) > 0;
  }

  listRoleBindings(serverId: string): Array<{ normalizedName: string; displayName: string; role: Role }> {
    return this.#db.prepare(`
      SELECT normalized_name AS normalizedName, display_name AS displayName, role
      FROM role_bindings WHERE server_id = ? ORDER BY display_name ASC
    `).all(serverId) as Array<{ normalizedName: string; displayName: string; role: Role }>;
  }

  getRole(serverId: string, normalizedName: string): Role | undefined {
    const row = this.#db.prepare(`SELECT role FROM role_bindings WHERE server_id = ? AND normalized_name = ?`).get(serverId, normalizedName) as { role: Role } | undefined;
    return row?.role;
  }

  bindRole(serverId: string, normalizedName: string, displayName: string, role: Role): void {
    this.#db.prepare(`
      INSERT INTO role_bindings(server_id, normalized_name, role, display_name, updated_at)
      VALUES(?,?,?,?,?)
      ON CONFLICT(server_id, normalized_name)
      DO UPDATE SET role = excluded.role, display_name = excluded.display_name, updated_at = excluded.updated_at
    `).run(serverId, normalizedName, role, displayName, new Date().toISOString());
  }

  touchMemberProfile(serverId: string, normalizedName: string, displayName: string): MemberProfileRow {
    const now = new Date().toISOString();
    this.#db.prepare(`
      INSERT INTO member_profiles(server_id, normalized_name, display_name, avatar_data_url, updated_at)
      VALUES(?,?,?,?,?)
      ON CONFLICT(server_id, normalized_name)
      DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at
    `).run(serverId, normalizedName, displayName, null, now);
    return this.getMemberProfile(serverId, normalizedName)!;
  }

  getMemberProfile(serverId: string, normalizedName: string): MemberProfileRow | undefined {
    return this.#db.prepare(`
      SELECT server_id AS serverId, normalized_name AS normalizedName, display_name AS displayName,
             avatar_data_url AS avatarDataUrl, updated_at AS updatedAt
      FROM member_profiles
      WHERE server_id = ? AND normalized_name = ?
    `).get(serverId, normalizedName) as MemberProfileRow | undefined;
  }

  listMemberProfiles(serverId: string): MemberProfileRow[] {
    return this.#db.prepare(`
      SELECT server_id AS serverId, normalized_name AS normalizedName, display_name AS displayName,
             avatar_data_url AS avatarDataUrl, updated_at AS updatedAt
      FROM member_profiles
      WHERE server_id = ?
      ORDER BY display_name COLLATE NOCASE ASC
    `).all(serverId) as MemberProfileRow[];
  }

  updateMemberAvatar(serverId: string, normalizedName: string, displayName: string, avatarDataUrl?: string): MemberProfileRow {
    const now = new Date().toISOString();
    this.#db.prepare(`
      INSERT INTO member_profiles(server_id, normalized_name, display_name, avatar_data_url, updated_at)
      VALUES(?,?,?,?,?)
      ON CONFLICT(server_id, normalized_name)
      DO UPDATE SET display_name = excluded.display_name,
                    avatar_data_url = excluded.avatar_data_url,
                    updated_at = excluded.updated_at
    `).run(serverId, normalizedName, displayName, avatarDataUrl ?? null, now);
    return this.getMemberProfile(serverId, normalizedName)!;
  }

  createFile(input: Omit<FileRow, 'id' | 'createdAt'>): FileRow {
    const row: FileRow = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    this.#db.prepare(`
      INSERT INTO files(id,server_id,channel_id,uploader_name,original_name,stored_name,size,mime,sha256,client_upload_id,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)
    `).run(row.id, row.serverId, row.channelId, row.uploaderName, row.originalName, row.storedName, row.size, row.mime, row.sha256, row.clientUploadId ?? null, row.createdAt);
    return row;
  }

  getFile(id: string): FileRow | undefined {
    return this.#db.prepare(`
      SELECT id, server_id AS serverId, channel_id AS channelId, uploader_name AS uploaderName,
             original_name AS originalName, stored_name AS storedName, size, mime, sha256, created_at AS createdAt
      FROM files WHERE id = ?
    `).get(id) as FileRow | undefined;
  }

  getFileByClientUploadId(serverId: string, clientUploadId: string): FileRow | undefined {
    return this.#db.prepare(`
      SELECT id, server_id AS serverId, channel_id AS channelId, uploader_name AS uploaderName,
             original_name AS originalName, stored_name AS storedName, size, mime, sha256,
             client_upload_id AS clientUploadId, created_at AS createdAt
      FROM files WHERE server_id = ? AND client_upload_id = ?
    `).get(serverId, clientUploadId) as FileRow | undefined;
  }

  listFilesByServer(serverId: string): FileRow[] {
    return this.#db.prepare(`
      SELECT id, server_id AS serverId, channel_id AS channelId, uploader_name AS uploaderName,
             original_name AS originalName, stored_name AS storedName, size, mime, sha256, created_at AS createdAt
      FROM files WHERE server_id = ?
    `).all(serverId) as FileRow[];
  }

  listFilesByChannel(channelId: string): FileRow[] {
    return this.#db.prepare(`
      SELECT id, server_id AS serverId, channel_id AS channelId, uploader_name AS uploaderName,
             original_name AS originalName, stored_name AS storedName, size, mime, sha256, created_at AS createdAt
      FROM files WHERE channel_id = ?
    `).all(channelId) as FileRow[];
  }


  listAllFiles(): FileRow[] {
    return this.#db.prepare(`
      SELECT id, server_id AS serverId, channel_id AS channelId, uploader_name AS uploaderName,
             original_name AS originalName, stored_name AS storedName, size, mime, sha256, created_at AS createdAt
      FROM files ORDER BY created_at DESC
    `).all() as FileRow[];
  }

  hasTextIndex(fileId: string): boolean {
    return Boolean(this.#db.prepare(`SELECT 1 AS ok FROM file_text_index WHERE file_id = ?`).get(fileId));
  }

  indexTextFile(fileId: string, serverId: string, channelId: string, content: string): void {
    this.#db.prepare(`
      INSERT INTO file_text_index(file_id, server_id, channel_id, content, indexed_at)
      VALUES(?,?,?,?,?)
      ON CONFLICT(file_id) DO UPDATE SET content = excluded.content, indexed_at = excluded.indexed_at
    `).run(fileId, serverId, channelId, content, new Date().toISOString());
  }

  searchFiles(serverId: string, query = '', limit = 40): Array<FileRow & { channelName: string; excerpt?: string }> {
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const q = query.trim().toLocaleLowerCase('pt-BR');
    const like = `%${q}%`;
    const rows = this.#db.prepare(`
      SELECT f.id, f.server_id AS serverId, f.channel_id AS channelId, f.uploader_name AS uploaderName,
             f.original_name AS originalName, f.stored_name AS storedName, f.size, f.mime, f.sha256,
             f.created_at AS createdAt, c.name AS channelName,
             CASE
               WHEN t.content IS NULL THEN ''
               WHEN ? = '' THEN substr(t.content, 1, 240)
               ELSE substr(t.content, max(1, instr(lower(t.content), ?) - 90), 320)
             END AS excerpt
      FROM files f
      JOIN channels c ON c.id = f.channel_id
      LEFT JOIN file_text_index t ON t.file_id = f.id
      WHERE f.server_id = ?
        AND (? = '' OR lower(f.original_name) LIKE ? OR lower(coalesce(t.content, '')) LIKE ?)
      ORDER BY f.created_at DESC
      LIMIT ?
    `).all(q, q, serverId, q, like, like, safeLimit) as Array<FileRow & { channelName: string; excerpt?: string }>;
    return rows;
  }

  deleteFile(id: string): boolean {
    const result = this.#db.prepare(`DELETE FROM files WHERE id = ?`).run(id);
    return Number(result.changes) > 0;
  }

  addMessage(
    input: Omit<MessageRow, 'id' | 'createdAt' | 'editedAt' | 'attachment' | 'replyTo'> & { fileId?: string; replyToId?: string }
  ): MessageRow {
    const { fileId, replyToId, ...messageInput } = input;
    const row: MessageRow = { ...messageInput, id: randomUUID(), createdAt: new Date().toISOString() };
    this.#db.prepare(`
      INSERT INTO messages(id,server_id,channel_id,author_name,author_role,content,created_at,kind,file_id,reply_to_id)
      VALUES(?,?,?,?,?,?,?,?,?,?)
    `).run(
      row.id, row.serverId, row.channelId, row.authorName, row.authorRole, row.content, row.createdAt, row.kind,
      fileId ?? null, replyToId ?? null
    );
    return this.getMessage(row.id) ?? row;
  }

  getMessage(messageId: string): (MessageRow & { fileId?: string }) | undefined {
    const raw = this.#db.prepare(`
      SELECT m.id, m.server_id AS serverId, m.channel_id AS channelId, m.author_name AS authorName,
             m.author_role AS authorRole, m.content, m.created_at AS createdAt, m.edited_at AS editedAt, m.kind,
             m.file_id AS fileId, m.reply_to_id AS replyToId,
             f.original_name AS fileOriginalName, f.size AS fileSize, f.mime AS fileMime, f.sha256 AS fileSha256,
             r.author_name AS replyAuthorName, r.content AS replyContent, rf.original_name AS replyFileName
      FROM messages m
      LEFT JOIN files f ON f.id = m.file_id
      LEFT JOIN messages r ON r.id = m.reply_to_id
      LEFT JOIN files rf ON rf.id = r.file_id
      WHERE m.id = ?
    `).get(messageId) as any;
    if (!raw) return undefined;
    return this.#messageFromRaw(raw, true);
  }

  getMessageByFileId(fileId: string): MessageRow | undefined {
    const raw = this.#db.prepare(`
      SELECT m.id, m.server_id AS serverId, m.channel_id AS channelId, m.author_name AS authorName,
             m.author_role AS authorRole, m.content, m.created_at AS createdAt, m.edited_at AS editedAt, m.kind,
             f.id AS fileId, f.original_name AS fileOriginalName, f.size AS fileSize,
             f.mime AS fileMime, f.sha256 AS fileSha256, m.reply_to_id AS replyToId,
             r.author_name AS replyAuthorName, r.content AS replyContent, rf.original_name AS replyFileName
      FROM messages m
      JOIN files f ON f.id = m.file_id
      LEFT JOIN messages r ON r.id = m.reply_to_id
      LEFT JOIN files rf ON rf.id = r.file_id
      WHERE m.file_id = ? LIMIT 1
    `).get(fileId) as any;
    return raw ? this.#messageFromRaw(raw) : undefined;
  }

  updateMessageContent(messageId: string, content: string, markEdited = true): MessageRow | undefined {
    const editedAt = markEdited ? new Date().toISOString() : null;
    const result = markEdited
      ? this.#db.prepare(`UPDATE messages SET content = ?, edited_at = ? WHERE id = ?`).run(content, editedAt, messageId)
      : this.#db.prepare(`UPDATE messages SET content = ? WHERE id = ?`).run(content, messageId);
    if (Number(result.changes) < 1) return undefined;
    return this.getMessage(messageId);
  }

  deleteMessage(messageId: string): { deleted: boolean; file?: FileRow } {
    const message = this.getMessage(messageId);
    if (!message) return { deleted: false };
    const file = message.fileId ? this.getFile(message.fileId) : undefined;
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      this.#db.prepare(`DELETE FROM messages WHERE id = ?`).run(messageId);
      if (message.fileId) this.#db.prepare(`DELETE FROM files WHERE id = ?`).run(message.fileId);
      this.#db.exec('COMMIT');
      return { deleted: true, file };
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  listMessages(channelId: string, limit = 50, before?: string): MessageRow[] {
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const sql = `
      SELECT m.id, m.server_id AS serverId, m.channel_id AS channelId, m.author_name AS authorName,
             m.author_role AS authorRole, m.content, m.created_at AS createdAt, m.edited_at AS editedAt, m.kind,
             f.id AS fileId, f.original_name AS fileOriginalName, f.size AS fileSize,
             f.mime AS fileMime, f.sha256 AS fileSha256, m.reply_to_id AS replyToId,
             r.author_name AS replyAuthorName, r.content AS replyContent, rf.original_name AS replyFileName
      FROM messages m
      LEFT JOIN files f ON f.id = m.file_id
      LEFT JOIN messages r ON r.id = m.reply_to_id
      LEFT JOIN files rf ON rf.id = r.file_id
      WHERE m.channel_id = ? ${before ? 'AND m.created_at < ?' : ''}
      ORDER BY m.created_at DESC LIMIT ?
    `;
    const rows = before
      ? this.#db.prepare(sql).all(channelId, before, safeLimit)
      : this.#db.prepare(sql).all(channelId, safeLimit);
    return (rows as Array<any>).reverse().map(raw => this.#messageFromRaw(raw));
  }

  #messageFromRaw(raw: any, includeFileId = false): MessageRow & { fileId?: string } {
    return {
      id: raw.id,
      serverId: raw.serverId,
      channelId: raw.channelId,
      authorName: raw.authorName,
      authorRole: raw.authorRole,
      content: raw.content,
      createdAt: raw.createdAt,
      ...(raw.editedAt ? { editedAt: raw.editedAt } : {}),
      kind: raw.kind,
      ...(includeFileId && raw.fileId ? { fileId: raw.fileId } : {}),
      ...(raw.fileId ? {
        attachment: {
          id: raw.fileId,
          originalName: raw.fileOriginalName,
          size: raw.fileSize,
          mime: raw.fileMime,
          sha256: raw.fileSha256
        }
      } : {}),
      ...(raw.replyToId && raw.replyAuthorName ? {
        replyTo: {
          id: raw.replyToId,
          authorName: raw.replyAuthorName,
          content: raw.replyContent ?? '',
          ...(raw.replyFileName ? { attachmentName: raw.replyFileName } : {})
        }
      } : {})
    };
  }

  close(): void { this.#db.close(); }
}
