import type { Bootstrap, ChannelInfo, IndexedFileInfo, MemberProfileInfo, MessageInfo, ServerInfo, SessionInfo } from './types.js';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function request<T>(url: string, options: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);
  const method = String(options.method ?? 'GET').toUpperCase();
  const attempts = method === 'GET' ? 2 : 1;
  let response: Response | undefined;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      response = await fetch(url, { ...options, headers, cache: method === 'GET' ? 'no-store' : options.cache });
      break;
    } catch (error) {
      if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, 240));
    }
  }

  if (!response) {
    throw new ApiError(0, 'Não foi possível falar com o host Verdant. A conexão pode ter oscilado; aguarde a reconexão e tente novamente.');
  }

  let payload: any = {};
  try { payload = await response.json(); } catch { /* empty */ }
  if (!response.ok) throw new ApiError(response.status, typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`);
  return payload as T;
}



export function uploadFile(
  channelId: string,
  token: string,
  file: File,
  onProgress: (loaded: number, total: number) => void,
  replyToId?: string
): Promise<{ file: { id: string; originalName: string; size: number; mime: string; sha256: string }; message: MessageInfo }> {
  const uploadId = typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const sendAttempt = (attempt: number): Promise<any> => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const query = new URLSearchParams({ name: file.name, uploadId });
    if (replyToId) query.set('replyToId', replyToId);
    xhr.open('POST', `/api/channels/${encodeURIComponent(channelId)}/files?${query}`);
    xhr.setRequestHeader('authorization', `Bearer ${token}`);
    xhr.timeout = 10 * 60 * 1000;

    let settled = false;
    const fail = (error: ApiError) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    xhr.upload.addEventListener('progress', event => {
      if (event.lengthComputable) onProgress(event.loaded, event.total);
      else onProgress(event.loaded, file.size);
    });
    xhr.addEventListener('load', () => {
      if (settled) return;
      let payload: any = {};
      try { payload = JSON.parse(xhr.responseText || '{}'); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        settled = true;
        resolve(payload);
      } else {
        fail(new ApiError(xhr.status, typeof payload.error === 'string' ? payload.error : `HTTP ${xhr.status}`));
      }
    });
    xhr.addEventListener('timeout', () => fail(new ApiError(0, 'O upload ficou tempo demais sem concluir. Nenhuma página precisa ser recarregada; tente novamente.')));
    xhr.addEventListener('abort', () => fail(new ApiError(0, 'Upload cancelado.')));
    xhr.addEventListener('error', () => fail(new ApiError(0, 'A conexão oscilou durante o upload. O Verdant vai conferir a tentativa antes de criar outra cópia.')));
    xhr.send(file);
  });

  return sendAttempt(0).catch(async error => {
    // Uma única nova tentativa usa o MESMO uploadId. O host trata esse ID como
    // idempotente: se o primeiro envio chegou ao disco mas a resposta se perdeu,
    // ele devolve a mesma mensagem em vez de criar anexos infinitos.
    if (!(error instanceof ApiError) || error.status !== 0) throw error;
    await new Promise(resolve => setTimeout(resolve, 700));
    return await sendAttempt(1);
  });
}


export const api = {
  bootstrap: () => request<Bootstrap>('/api/bootstrap'),

  createServer: (name: string, ownerName: string, description = '', password = '') =>
    request<{ server: ServerInfo; channels: ChannelInfo[]; session: SessionInfo }>('/api/servers', {
      method: 'POST', body: JSON.stringify({ name, ownerName, description, password })
    }),

  resolveInvite: (code: string) =>
    request<{ server: Pick<ServerInfo, 'id' | 'name' | 'description' | 'inviteCode'> }>(`/api/invites/${encodeURIComponent(code)}`),

  joinServer: (serverId: string, name: string, resumeToken?: string, password = '') =>
    request<{ server: ServerInfo; channels: ChannelInfo[]; session: SessionInfo }>(`/api/servers/${encodeURIComponent(serverId)}/join`, {
      method: 'POST', body: JSON.stringify({ name, resumeToken, password })
    }),

  channels: (serverId: string) =>
    request<{ channels: ChannelInfo[] }>(`/api/servers/${encodeURIComponent(serverId)}/channels`),

  deleteServer: (serverId: string, token: string) =>
    request<{ ok: true }>(`/api/servers/${encodeURIComponent(serverId)}`, { method: 'DELETE' }, token),

  createChannel: (serverId: string, token: string, name: string, type: 'text' | 'voice') =>
    request<{ channel: ChannelInfo }>(`/api/servers/${encodeURIComponent(serverId)}/channels`, {
      method: 'POST', body: JSON.stringify({ name, type })
    }, token),

  deleteChannel: (channelId: string, token: string) =>
    request<{ ok: true }>(`/api/channels/${encodeURIComponent(channelId)}`, { method: 'DELETE' }, token),

  deleteMessage: (messageId: string, token: string) =>
    request<{ ok: true }>(`/api/messages/${encodeURIComponent(messageId)}`, { method: 'DELETE' }, token),

  editMessage: (messageId: string, token: string, content: string, initialCaption = false) =>
    request<{ message: MessageInfo }>(`/api/messages/${encodeURIComponent(messageId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ content, initialCaption })
    }, token),

  messages: (channelId: string, before?: string) => {
    const query = new URLSearchParams({ limit: '50' });
    if (before) query.set('before', before);
    return request<{ messages: MessageInfo[] }>(`/api/channels/${encodeURIComponent(channelId)}/messages?${query}`);
  },

  downloadGrant: (fileId: string, token: string) =>
    request<{ url: string; expiresInSeconds: number }>(`/api/files/${encodeURIComponent(fileId)}/grant`, { method: 'POST' }, token),

  previewGrant: (fileId: string, token: string) =>
    request<{ url: string; expiresInSeconds: number }>(`/api/files/${encodeURIComponent(fileId)}/preview-grant`, { method: 'POST' }, token),

  searchFiles: (serverId: string, token: string, query = '') => {
    const qs = new URLSearchParams();
    if (query.trim()) qs.set('q', query.trim());
    return request<{ files: IndexedFileInfo[] }>(`/api/servers/${encodeURIComponent(serverId)}/files/search?${qs}`, {}, token);
  },

  profiles: (serverId: string, token: string) =>
    request<{ profiles: MemberProfileInfo[] }>(`/api/servers/${encodeURIComponent(serverId)}/profiles`, {}, token),

  updateProfile: (serverId: string, token: string, avatarDataUrl: string | null) =>
    request<{ profile: MemberProfileInfo }>(`/api/servers/${encodeURIComponent(serverId)}/profile`, {
      method: 'PATCH',
      body: JSON.stringify({ avatarDataUrl })
    }, token),

  setRole: (serverId: string, token: string, name: string, role: 'moderator' | 'member') =>
    request<{ ok: true }>(`/api/servers/${encodeURIComponent(serverId)}/roles`, {
      method: 'PATCH', body: JSON.stringify({ name, role })
    }, token)
};
