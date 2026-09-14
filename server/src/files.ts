import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { MAX_FILE_BYTES } from '../../shared/src/domain.ts';
import type { AppDatabase, FileRow } from './database.ts';
import { HttpError } from './http-utils.ts';

interface FileGrant {
  fileId: string;
  serverId: string;
  purpose: 'download' | 'preview';
  expiresAt: number;
}

export class FileService {
  #db: AppDatabase;
  #uploadsDir: string;
  #grants = new Map<string, FileGrant>();

  constructor(db: AppDatabase, uploadsDir: string) {
    this.#db = db;
    this.#uploadsDir = uploadsDir;
    fs.mkdirSync(uploadsDir, { recursive: true });
    this.#backfillTextIndex();
  }

  async saveUpload(req: IncomingMessage, input: {
    serverId: string;
    channelId: string;
    uploaderName: string;
    originalName: string;
    clientUploadId?: string;
  }): Promise<FileRow> {
    const contentLength = parseContentLength(req.headers['content-length']);
    if (contentLength !== undefined && contentLength > MAX_FILE_BYTES) {
      throw new HttpError(413, 'Arquivo acima do limite de 500 MB.');
    }
    if (contentLength !== undefined) this.#assertDiskSpace(contentLength);

    const originalName = sanitizeOriginalName(input.originalName);
    const storedName = `${randomUUID()}.blob`;
    const tempName = `${storedName}.part`;
    const tempPath = path.join(this.#uploadsDir, tempName);
    const finalPath = path.join(this.#uploadsDir, storedName);
    const output = fs.createWriteStream(tempPath, { flags: 'wx', mode: 0o600 });
    const hash = createHash('sha256');
    const sniffChunks: Buffer[] = [];
    let sniffBytes = 0;
    let total = 0;
    let outputError: Error | undefined;
    output.once('error', error => { outputError = error; });

    try {
      for await (const part of req) {
        if (outputError) throw outputError;
        const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
        total += chunk.length;
        if (total > MAX_FILE_BYTES) throw new HttpError(413, 'Arquivo acima do limite de 500 MB.');
        hash.update(chunk);
        if (sniffBytes < 512) {
          const slice = chunk.subarray(0, Math.min(chunk.length, 512 - sniffBytes));
          sniffChunks.push(Buffer.from(slice));
          sniffBytes += slice.length;
        }
        if (!output.write(chunk)) await onceDrain(output);
      }
      await finishStream(output);
      if (contentLength !== undefined && total !== contentLength) {
        throw new HttpError(400, 'Upload incompleto: tamanho recebido não corresponde ao informado.');
      }
      fs.renameSync(tempPath, finalPath);
      const sniff = Buffer.concat(sniffChunks);
      const mime = sniffMime(sniff, originalName);
      try {
        const file = this.#db.createFile({
          serverId: input.serverId,
          channelId: input.channelId,
          uploaderName: input.uploaderName,
          originalName,
          storedName,
          size: total,
          mime,
          sha256: hash.digest('hex'),
          clientUploadId: input.clientUploadId
        });
        this.#indexTextFile(file, finalPath);
        return file;
      } catch (error) {
        fs.rmSync(finalPath, { force: true });
        throw error;
      }
    } catch (error) {
      output.destroy();
      fs.rmSync(tempPath, { force: true });
      fs.rmSync(finalPath, { force: true });
      throw error;
    }
  }

  getFile(id: string): FileRow | undefined {
    return this.#db.getFile(id);
  }

  createDownloadGrant(fileId: string, serverId: string): string {
    return this.#createGrant(fileId, serverId, 'download');
  }

  createPreviewGrant(fileId: string, serverId: string): string {
    return this.#createGrant(fileId, serverId, 'preview');
  }

  resolveDownload(fileId: string, key: string | null): { file: FileRow; path: string } {
    return this.#resolveGrant(fileId, key, 'download');
  }

  resolvePreview(fileId: string, key: string | null): { file: FileRow; path: string } {
    const resolved = this.#resolveGrant(fileId, key, 'preview');
    if (!isPreviewableMime(resolved.file.mime)) throw new HttpError(415, 'Este tipo de arquivo não possui pré-visualização segura.');
    return resolved;
  }

  removeStoredFile(file: FileRow): void {
    if (!/^[0-9a-f-]{36}\.blob$/i.test(file.storedName)) return;
    const filePath = path.resolve(this.#uploadsDir, file.storedName);
    const root = path.resolve(this.#uploadsDir);
    if (!filePath.startsWith(`${root}${path.sep}`)) return;
    fs.rmSync(filePath, { force: true });
    for (const [key, grant] of this.#grants) if (grant.fileId === file.id) this.#grants.delete(key);
  }

  removeStoredFiles(files: FileRow[]): void {
    for (const file of files) this.removeStoredFile(file);
  }


  #createGrant(fileId: string, serverId: string, purpose: FileGrant['purpose']): string {
    const file = this.#db.getFile(fileId);
    if (!file || file.serverId !== serverId) throw new HttpError(404, 'Arquivo não encontrado.');
    this.#cleanupGrants();
    const key = randomBytes(24).toString('base64url');
    this.#grants.set(key, { fileId, serverId, purpose, expiresAt: Date.now() + 60_000 });
    return key;
  }

  #resolveGrant(fileId: string, key: string | null, purpose: FileGrant['purpose']): { file: FileRow; path: string } {
    this.#cleanupGrants();
    if (!key) throw new HttpError(401, 'Link temporário inválido.');
    const grant = this.#grants.get(key);
    if (!grant || grant.fileId !== fileId || grant.purpose !== purpose || grant.expiresAt <= Date.now()) {
      if (grant) this.#grants.delete(key);
      throw new HttpError(401, 'Link temporário expirado ou inválido.');
    }
    // Download é uso único; preview pode precisar de múltiplas leituras/ranges
    // (PDF, áudio e vídeo) durante a janela curta de 60 segundos.
    if (purpose === 'download') this.#grants.delete(key);
    const file = this.#db.getFile(fileId);
    if (!file || file.serverId !== grant.serverId) throw new HttpError(404, 'Arquivo não encontrado.');
    if (!/^[0-9a-f-]{36}\.blob$/i.test(file.storedName)) throw new HttpError(500, 'Metadado de arquivo inválido.');
    const filePath = path.resolve(this.#uploadsDir, file.storedName);
    const root = path.resolve(this.#uploadsDir);
    if (!filePath.startsWith(`${root}${path.sep}`)) throw new HttpError(500, 'Caminho de arquivo inválido.');
    if (!fs.existsSync(filePath)) throw new HttpError(404, 'Arquivo não encontrado no armazenamento do host.');
    return { file, path: filePath };
  }

  #indexTextFile(file: FileRow, filePath: string): void {
    if (!file.mime.toLowerCase().startsWith('text/plain') || file.size > 2 * 1024 * 1024) return;
    try {
      const text = fs.readFileSync(filePath, 'utf8').replace(/\u0000/g, '').slice(0, 1_500_000);
      this.#db.indexTextFile(file.id, file.serverId, file.channelId, text);
    } catch {
      // Falha de indexação nunca deve invalidar o upload já concluído.
    }
  }

  #backfillTextIndex(): void {
    for (const file of this.#db.listAllFiles()) {
      if (!file.mime.toLowerCase().startsWith('text/plain') || file.size > 2 * 1024 * 1024 || this.#db.hasTextIndex(file.id)) continue;
      if (!/^[0-9a-f-]{36}\.blob$/i.test(file.storedName)) continue;
      const filePath = path.resolve(this.#uploadsDir, file.storedName);
      if (fs.existsSync(filePath)) this.#indexTextFile(file, filePath);
    }
  }

  #cleanupGrants(): void {
    const now = Date.now();
    for (const [key, grant] of this.#grants) if (grant.expiresAt <= now) this.#grants.delete(key);
  }

  #assertDiskSpace(bytes: number): void {
    try {
      const stats = fs.statfsSync(this.#uploadsDir);
      const available = Number(stats.bavail) * Number(stats.bsize);
      const reserve = 64 * 1024 * 1024;
      if (available < bytes + reserve) throw new HttpError(507, 'Espaço insuficiente no host para receber o arquivo.');
    } catch (error) {
      if (error instanceof HttpError) throw error;
      // Alguns sistemas não expõem statfs de forma utilizável. O limite de streaming continua ativo.
    }
  }
}

export function contentDispositionAttachment(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || 'arquivo';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function sanitizeOriginalName(value: string): string {
  const normalized = String(value ?? '').normalize('NFKC').replace(/\\/g, '/');
  const base = path.posix.basename(normalized).replace(/[\u0000-\u001F\u007F]/g, '').trim();
  const safe = base.slice(0, 180).trim();
  return safe || 'arquivo';
}

function parseContentLength(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new HttpError(400, 'Content-Length inválido.');
  return parsed;
}

function sniffMime(buffer: Buffer, filename: string): string {
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && [0x03, 0x05, 0x07].includes(buffer[2] ?? -1) && [0x04, 0x06, 0x08].includes(buffer[3] ?? -1)) return 'application/zip';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a') return 'image/gif';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') return 'video/mp4';
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))) return 'video/webm';
  if (buffer.subarray(0, 4).toString('ascii') === 'OggS') return 'audio/ogg';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WAVE') return 'audio/wav';
  if (buffer.subarray(0, 3).toString('ascii') === 'ID3' || (buffer.length >= 2 && buffer[0] === 0xff && ((buffer[1] ?? 0) & 0xe0) === 0xe0)) return 'audio/mpeg';

  const ext = path.extname(filename).toLowerCase();
  if (ext === '.txt' && looksLikeText(buffer)) return 'text/plain; charset=utf-8';
  if (looksLikeText(buffer)) return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

function looksLikeText(buffer: Buffer): boolean {
  if (!buffer.length) return true;
  let controls = 0;
  for (const byte of buffer) {
    if (byte === 0) return false;
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) controls += 1;
  }
  return controls / buffer.length < 0.02;
}

function onceDrain(stream: fs.WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    const onDrain = () => { cleanup(); resolve(); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const cleanup = () => { stream.off('drain', onDrain); stream.off('error', onError); };
    stream.once('drain', onDrain);
    stream.once('error', onError);
  });
}

function finishStream(stream: fs.WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    const onFinish = () => { cleanup(); resolve(); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const cleanup = () => { stream.off('finish', onFinish); stream.off('error', onError); };
    stream.once('finish', onFinish);
    stream.once('error', onError);
    stream.end();
  });
}

export function contentDispositionInline(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || 'arquivo';
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function isPreviewableMime(mime: string): boolean {
  const normalized = mime.toLowerCase().split(';', 1)[0]?.trim() ?? '';
  return normalized.startsWith('image/')
    || normalized === 'text/plain'
    || normalized === 'application/pdf'
    || normalized.startsWith('audio/')
    || normalized.startsWith('video/');
}
