export type Role = 'owner' | 'moderator' | 'member';
export type ChannelType = 'text' | 'voice';

export const MAX_PARTICIPANTS = 6;
export const MAX_MESSAGE_CHARS = 4000;
export const MAX_WS_PAYLOAD_BYTES = 64 * 1024;
export const MAX_FILE_BYTES = 500 * 1024 * 1024;

export function normalizeName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
}

export function validateDisplayName(value: unknown): { ok: true; value: string; normalized: string } | { ok: false; error: string } {
  if (typeof value !== 'string') return { ok: false, error: 'Nome inválido.' };
  const cleaned = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (cleaned.length < 1) return { ok: false, error: 'Informe um nome.' };
  if (cleaned.length > 32) return { ok: false, error: 'O nome pode ter no máximo 32 caracteres.' };
  if (/^[\p{C}]+$/u.test(cleaned)) return { ok: false, error: 'Nome inválido.' };
  return { ok: true, value: cleaned, normalized: normalizeName(cleaned) };
}

export const rolePermissions: Record<Role, Set<string>> = {
  owner: new Set([
    'server.manage', 'server.delete', 'channels.create', 'channels.edit', 'channels.delete',
    'roles.assign', 'roles.manage', 'members.kick', 'members.adminMute', 'streams.manage',
    'server.password', 'chat.send', 'voice.join', 'screen.share'
  ]),
  moderator: new Set([
    'channels.create', 'channels.edit', 'members.kick', 'members.adminMute',
    'streams.manage', 'chat.send', 'voice.join', 'screen.share'
  ]),
  member: new Set(['chat.send', 'voice.join', 'screen.share'])
};

export function hasPermission(role: Role, permission: string): boolean {
  return rolePermissions[role]?.has(permission) ?? false;
}
